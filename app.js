// app.js — fully integrated with Speaker Profile, Realism Mode, HQ Mode
// - Moderate laptop compensation selected by user (Option 1)
// - Keeps previous stability fixes, limiter, safer gain mapping, recorder safety, animation control

let audioCtx = null;
let nodes = {};
let isRunning = false;
let mediaRecorder = null;
let recordedChunks = [];
let bladeRotation = 0;

// animation frame ids so we can cancel when stopping
let meterFrameId = null;
let windFrameId = null;

const els = {
  distance: document.getElementById('distance'),
  rpm: document.getElementById('rpm'),
  blades: document.getElementById('blades'),
  bladeLength: document.getElementById('bladeLength'),
  hubHeight: document.getElementById('hubHeight'),
  wind: document.getElementById('wind'),
  windDir: document.getElementById('windDir'),
  turbines: document.getElementById('turbines'),
  airAbsorb: document.getElementById('airAbsorb'),
  groundEffect: document.getElementById('groundEffect'),
  startBtn: document.getElementById('startBtn'),
  stopBtn: document.getElementById('stopBtn'),
  recordBtn: document.getElementById('recordBtn'),
  bpfReadout: document.getElementById('bpfReadout'),
  splReadout: document.getElementById('splReadout'),
  meterCanvas: document.getElementById('meter'),
  windDirCanvas: document.getElementById('windDirCanvas'),

  // text value spans
  distanceVal: document.getElementById('distanceVal'),
  rpmVal: document.getElementById('rpmVal'),
  bladesVal: document.getElementById('bladesVal'),
  bladeLengthVal: document.getElementById('bladeLengthVal'),
  hubHeightVal: document.getElementById('hubHeightVal'),
  windVal: document.getElementById('windVal'),
  turbinesVal: document.getElementById('turbinesVal'),

  // new controls (may be added to HTML per earlier suggestion)
  speakerProfile: document.getElementById('speakerProfile'),
  realism: document.getElementById('realism'),
  hq: document.getElementById('hq'),
};

function safeText(el, txt) { if (el) el.textContent = txt; }

function updateLabels() {
  if (!els.distance || !els.rpm || !els.blades || !els.bladeLength || !els.hubHeight || !els.wind || !els.turbines) return;

  safeText(els.distanceVal, els.distance.value);
  safeText(els.rpmVal, els.rpm.value);
  safeText(els.bladesVal, els.blades.value);
  safeText(els.bladeLengthVal, els.bladeLength.value);
  safeText(els.hubHeightVal, els.hubHeight.value);
  safeText(els.windVal, els.wind.value);
  safeText(els.turbinesVal, els.turbines.value);

  const rpm = parseFloat(els.rpm.value);
  const blades = parseInt(els.blades.value, 10);
  const bpf = (blades * rpm) / 60;
  if (els.bpfReadout) els.bpfReadout.textContent = `${bpf.toFixed(2)} Hz`;

  // SPL readout - baseline at 50m
  const BASELINE_SPL_50M = 68; // dB(A) at 50m reference
  const d = Math.max(1, parseFloat(els.distance.value));
  const refDistance = 50;
  const relDb = 20 * Math.log10(refDistance / d);
  const turbines = Math.max(1, parseInt(els.turbines.value, 10));
  const multiTurbineDb = 10 * Math.log10(turbines);
  const absoluteSpl = BASELINE_SPL_50M + relDb + multiTurbineDb;
  if (els.splReadout) els.splReadout.textContent = `${absoluteSpl.toFixed(1)} dB(A)`;

  if (isRunning) applyParams();
}

function createNoiseBuffer(ctx, seconds = 8) {
  const length = Math.floor(seconds * ctx.sampleRate);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    // pink-ish shaping by reducing amplitude at higher indices: gentle
    data[i] = (Math.random() * 2 - 1) * 0.5;
  }
  return buffer;
}

function setupAudio() {
  // create a fresh audio context each start
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // HQ mode affects noise buffer length and some filter Q-values
  const HQ = !!(els.hq && els.hq.checked);
  const noiseSeconds = HQ ? 12 : 8;
  const noiseBuffer = createNoiseBuffer(audioCtx, noiseSeconds);

  const noise = audioCtx.createBufferSource();
  noise.buffer = noiseBuffer;
  noise.loop = true;

  // Tonal shaping filter (bandpass) to approximate blade tonal content
  const bandpass = audioCtx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.value = 400;
  bandpass.Q.value = HQ ? 1.2 : 0.8;

  // High frequency roll-off (air absorption)
  const lpf = audioCtx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = 18000;

  // Ground effect shelf
  const groundShelf = audioCtx.createBiquadFilter();
  groundShelf.type = 'lowshelf';
  groundShelf.frequency.value = 120;
  groundShelf.gain.value = -3;

  // EQ compensation for speaker profiles: low shelf + high shelf
  const eqLow = audioCtx.createBiquadFilter();
  eqLow.type = 'lowshelf';
  eqLow.frequency.value = 120;
  eqLow.gain.value = 0; // will be set by applyParams()

  const eqHigh = audioCtx.createBiquadFilter();
  eqHigh.type = 'highshelf';
  eqHigh.frequency.value = 3000;
  eqHigh.gain.value = 0; // will be set by applyParams()

  // baseGain: primary tone/gain control before final output gain
  const baseGain = audioCtx.createGain();
  baseGain.gain.value = 0.8;

  // final output gain (safe range)
  const gain = audioCtx.createGain();
  gain.gain.value = 0.0;

  // LFO for slow modulation of baseGain (adds movement)
  const lfo = audioCtx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 1.0;

  const lfoDepth = audioCtx.createGain();
  lfoDepth.gain.value = 0.12;

  // Realism nodes (thump / whump)
  const realismLFO = audioCtx.createOscillator();
  realismLFO.type = 'sine';
  realismLFO.frequency.value = 1.0; // will be set to bpf-ish in applyParams
  const realismDepth = audioCtx.createGain();
  realismDepth.gain.value = 0.0; // default off

  // Analyzer for meter
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;

  // Soft limiter / compressor
  const compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.value = -6;
  compressor.knee.value = 20;
  compressor.ratio.value = 8;
  compressor.attack.value = 0.002;
  compressor.release.value = 0.25;

  // Graph:
  // noise -> bandpass -> lpf -> groundShelf -> baseGain -> gain -> compressor -> eqLow -> eqHigh -> analyser -> destination
  noise.connect(bandpass);
  bandpass.connect(lpf);
  lpf.connect(groundShelf);
  groundShelf.connect(baseGain);

  // realism modulation will modulate baseGain.gain (via gain node)
  realismLFO.connect(realismDepth);
  realismDepth.connect(baseGain.gain);

  // global LFO also modulates baseGain.gain (adds subtle movement)
  lfo.connect(lfoDepth);
  lfoDepth.connect(baseGain.gain);

  baseGain.connect(gain);
  gain.connect(compressor);
  compressor.connect(eqLow);
  eqLow.connect(eqHigh);
  eqHigh.connect(analyser);
  analyser.connect(audioCtx.destination);

  // If user wants to record later, we'll connect baseGain to MediaStreamDestination when recording (temporary)

  // store nodes
  nodes = {
    noise, bandpass, lpf, groundShelf,
    eqLow, eqHigh,
    baseGain, gain,
    lfo, lfoDepth,
    realismLFO, realismDepth,
    analyser, compressor
  };
}

function applyParams() {
  if (!nodes || !nodes.bandpass || !audioCtx) return;

  const rpm = parseFloat(els.rpm.value);
  const blades = parseInt(els.blades.value, 10);
  const bladeLength = parseFloat(els.bladeLength.value);
  const wind = parseFloat(els.wind.value);
  const d = Math.max(1, parseFloat(els.distance.value));
  const windDir = els.windDir ? els.windDir.value : 'neutral';
  const hubHeight = parseFloat(els.hubHeight.value);
  const turbines = Math.max(1, parseInt(els.turbines.value, 10));
  const HQ = !!(els.hq && els.hq.checked);
  const realismOn = !!(els.realism && els.realism.checked);
  const speakerProfile = els.speakerProfile ? els.speakerProfile.value : 'laptop';

  // BPF (blade passage frequency)
  const bpf = (blades * rpm) / 60;
  if (els.bpfReadout) els.bpfReadout.textContent = `${bpf.toFixed(2)} Hz`;

  // Tip / tonal frequency mapping — tuned, not double-scaling by blade length
  const tipFreq = Math.max(80, 200 + wind * 12 + bpf * 2);
  nodes.bandpass.frequency.setTargetAtTime(tipFreq, audioCtx.currentTime, 0.05);
  nodes.bandpass.Q.setTargetAtTime(HQ ? 1.2 + wind * 0.03 : 0.8 + wind * 0.02, audioCtx.currentTime, 0.05);

  // LFO speeds
  nodes.lfo.frequency.setTargetAtTime(Math.max(0.2, bpf / 2), audioCtx.currentTime, 0.05);
  nodes.lfoDepth.gain.setTargetAtTime(0.08 + wind * 0.01, audioCtx.currentTime, 0.1);

  // Realism mode: use blade-pass frequency (or fraction) for "whump" modulation
  if (realismOn) {
    // subtle amplitude modulation in low-mid band
    nodes.realismLFO.frequency.setTargetAtTime(Math.max(0.5, bpf * 0.9), audioCtx.currentTime, 0.05);
    nodes.realismDepth.gain.setTargetAtTime(Math.min(0.22, 0.06 + wind * 0.01 + (bladeLength / 120) * 0.05), audioCtx.currentTime, 0.1);
  } else {
    nodes.realismDepth.gain.setTargetAtTime(0.0, audioCtx.currentTime, 0.05);
  }

  // Direction and distance mapping
  let dirGainFactor = 1.0;
  let dirCutoffBoost = 0;
  if (windDir === 'toward') { dirGainFactor = 1.2; dirCutoffBoost = 2500; }
  else if (windDir === 'away') { dirGainFactor = 0.7; dirCutoffBoost = -2500; }

  // Distance -> amplitude (1 / sqrt(distance)) scaled to safe maximum
  const refDistance = 50;
  const gainDistanceFactor = Math.min(1.0, Math.sqrt(refDistance / d));
  const turbinesGainFactor = Math.sqrt(turbines);
  const rawFinalGain = gainDistanceFactor * dirGainFactor * turbinesGainFactor;

  // Speaker profile affects allowed maximum (laptop speakers are fragile)
  let maxAllowedGain = 0.85;
  if (speakerProfile === 'laptop') maxAllowedGain = 0.7;   // extra safety for laptops
  else if (speakerProfile === 'external') maxAllowedGain = 0.9;
  else if (speakerProfile === 'flat') maxAllowedGain = 1.0;

  const finalGain = Math.min(maxAllowedGain, rawFinalGain);
  nodes.gain.gain.setTargetAtTime(Math.min(0.95, finalGain), audioCtx.currentTime, 0.05);

  // Air absorption: lowpass cutoff decreases with distance
  const airAbsorbOn = els.airAbsorb ? els.airAbsorb.checked : true;
  const cutoff = airAbsorbOn ? Math.max(1000, 18000 / (1 + d / 200)) : 18000;
  nodes.lpf.frequency.setTargetAtTime(Math.max(200, cutoff + dirCutoffBoost), audioCtx.currentTime, 0.1);

  // Ground effect shelf
  const groundOn = els.groundEffect ? els.groundEffect.checked : true;
  let groundGain = groundOn ? -3 : 0;
  const heightRatio = Math.min(1, hubHeight / 150);
  groundGain *= (1 - 0.2 * heightRatio);
  nodes.groundShelf.gain.setTargetAtTime(groundGain, audioCtx.currentTime, 0.1);

  // Speaker profile EQ compensation (Moderate / Option 1 chosen by user)
  // Option 1 - Moderate: +5 dB low, -3 dB high (safe, subtle)
  if (speakerProfile === 'laptop') {
    nodes.eqLow.gain.setTargetAtTime(5.0, audioCtx.currentTime, 0.1);   // boost bass a little
    nodes.eqHigh.gain.setTargetAtTime(-3.0, audioCtx.currentTime, 0.1); // reduce harsh highs
  } else if (speakerProfile === 'external') {
    nodes.eqLow.gain.setTargetAtTime(2.0, audioCtx.currentTime, 0.1);
    nodes.eqHigh.gain.setTargetAtTime(-1.0, audioCtx.currentTime, 0.1);
  } else { // flat/headphones
    nodes.eqLow.gain.setTargetAtTime(0.0, audioCtx.currentTime, 0.1);
    nodes.eqHigh.gain.setTargetAtTime(0.0, audioCtx.currentTime, 0.1);
  }
}

function startAudio() {
  if (isRunning) return;
  try {
    setupAudio();
  } catch (err) {
    console.error('Audio setup failed:', err);
    return;
  }

  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(e => console.error("Error resuming audio context:", e));
  }

  try {
    nodes.noise.start();
    nodes.lfo.start();
    nodes.realismLFO.start();
  } catch (err) {
    console.warn('Start failed or oscillators already running (fresh context expected):', err);
  }

  isRunning = true;
  if (els.startBtn) els.startBtn.disabled = true;
  if (els.stopBtn) els.stopBtn.disabled = false;
  if (els.recordBtn) els.recordBtn.disabled = false;

  applyParams();
  drawMeter();
  drawWindIndicator();
}

function stopAudio() {
  if (!isRunning) return;

  try { if (nodes.noise) nodes.noise.stop(); } catch (e) {}
  try { if (nodes.lfo) nodes.lfo.stop(); } catch (e) {}
  try { if (nodes.realismLFO) nodes.realismLFO.stop(); } catch (e) {}
  try { if (audioCtx) audioCtx.close(); } catch (e) { console.warn(e); }

  // cancel animations
  if (meterFrameId) cancelAnimationFrame(meterFrameId);
  meterFrameId = null;
  if (windFrameId) cancelAnimationFrame(windFrameId);
  windFrameId = null;

  // clear meter canvas
  if (els.meterCanvas) {
    const ctx = els.meterCanvas.getContext('2d');
    ctx.clearRect(0, 0, els.meterCanvas.width, els.meterCanvas.height);
  }

  isRunning = false;
  if (els.startBtn) els.startBtn.disabled = false;
  if (els.stopBtn) els.stopBtn.disabled = true;
  if (els.recordBtn) els.recordBtn.disabled = true;

  // release references
  nodes = {};
  audioCtx = null;
}

// meter visualization
function drawMeter() {
  if (!isRunning || !nodes || !nodes.analyser || !els.meterCanvas) {
    meterFrameId = null;
    return;
  }

  const canvas = els.meterCanvas;
  const ctx = canvas.getContext('2d');
  const bufferLength = nodes.analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  nodes.analyser.getByteTimeDomainData(dataArray);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#161b22';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#58a6ff';
  ctx.beginPath();
  const sliceWidth = canvas.width / bufferLength;
  let x = 0;
  for (let i = 0; i < bufferLength; i++) {
    const v = dataArray[i] / 128.0;
    const y = v * canvas.height / 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    x += sliceWidth;
  }
  ctx.stroke();

  meterFrameId = requestAnimationFrame(drawMeter);
}

// wind/turbine visualization - animate only when running
function drawWindIndicator() {
  const canvas = els.windDirCanvas;
  if (!canvas) {
    windFrameId = null;
    return;
  }
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#161b22';
  ctx.fillRect(0, 0, w, h);

  const turbineX = 80;
  const listenerX = w - 80;
  const groundY = h - 30;

  const userHubHeight = els.hubHeight ? parseFloat(els.hubHeight.value) : 150;
  const maxHubHeightInput = 300;
  const maxHubHeightPx = 70;
  const hubHeightPx = (userHubHeight / maxHubHeightInput) * maxHubHeightPx;
  const hubY = groundY - hubHeightPx;

  if (isRunning) {
    const rpm = parseFloat(els.rpm.value);
    bladeRotation += (rpm / 60) * 0.12;
  }

  // Tower
  ctx.fillStyle = '#8b949e';
  ctx.beginPath();
  ctx.moveTo(turbineX, hubY);
  ctx.lineTo(turbineX - 8, groundY);
  ctx.lineTo(turbineX + 8, groundY);
  ctx.fill();

  // Hub
  ctx.fillStyle = '#c9d1d9';
  ctx.beginPath();
  ctx.arc(turbineX, hubY, 6, 0, Math.PI * 2);
  ctx.fill();

  // Blades
  ctx.strokeStyle = '#c9d1d9';
  ctx.lineWidth = 3;
  const bladeCount = els.blades ? parseInt(els.blades.value, 10) : 3;
  const bladePx = Math.min(60, Math.max(20, (parseFloat(els.bladeLength.value) || 60) * 0.35));
  for (let i = 0; i < bladeCount; i++) {
    const ang = bladeRotation + i * (Math.PI * 2 / bladeCount);
    ctx.beginPath();
    ctx.moveTo(turbineX, hubY);
    ctx.lineTo(turbineX + Math.cos(ang) * bladePx, hubY + Math.sin(ang) * bladePx);
    ctx.stroke();
  }

  // Listener
  const headY = groundY - 15;
  ctx.strokeStyle = '#8b949e';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(listenerX, headY, 10, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(listenerX, headY + 10); ctx.lineTo(listenerX, groundY); ctx.stroke();
  ctx.beginPath(); ctx.arc(listenerX, headY, 12, Math.PI, 0); ctx.stroke();

  // Wind arrow
  const wind = els.wind ? parseFloat(els.wind.value) : 8;
  const windDir = els.windDir ? els.windDir.value : 'neutral';
  if (windDir !== 'neutral') {
    let arrowColor = windDir === 'toward' ? '#3fb950' : '#f85149';
    const arrowY = hubY;
    const arrowLen = Math.min(120, 40 + wind * 6);
    const centerX = (turbineX + listenerX) / 2;

    const startX = windDir === 'toward' ? turbineX + 20 : listenerX - 20;
    const endX = windDir === 'toward' ? listenerX - 20 : turbineX + 20;

    ctx.strokeStyle = arrowColor;
    ctx.fillStyle = arrowColor;
    ctx.lineWidth = 4;

    ctx.beginPath();
    ctx.moveTo(startX, arrowY);
    ctx.lineTo(endX, arrowY);
    ctx.stroke();

    const headSize = 10;
    const angle = Math.atan2(0, endX - startX);
    ctx.beginPath();
    ctx.moveTo(endX, arrowY);
    ctx.lineTo(endX - headSize * Math.cos(angle - Math.PI / 6), arrowY - headSize * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(endX - headSize * Math.cos(angle + Math.PI / 6), arrowY - headSize * Math.sin(angle + Math.PI / 6));
    ctx.fill();

    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText("WIND", centerX, arrowY - 10);
  }

  ctx.fillStyle = '#58a6ff';
  ctx.font = '12px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText(`Hub Height: ${userHubHeight} m`, 10, h - 10);

  if (isRunning) {
    windFrameId = requestAnimationFrame(drawWindIndicator);
  } else {
    windFrameId = null;
  }
}

// Recording helper — connects baseGain to a MediaStreamDestination temporarily and uses MediaRecorder
async function recordTenSeconds() {
  if (!isRunning || !audioCtx || !nodes.baseGain) return;

  const dest = audioCtx.createMediaStreamDestination();
  try {
    nodes.baseGain.connect(dest);
  } catch (e) {
    console.error('Failed to connect to MediaStreamDestination:', e);
    return;
  }

  recordedChunks = [];
  try {
    mediaRecorder = new MediaRecorder(dest.stream);
  } catch (e) {
    console.warn('MediaRecorder not supported or cannot be constructed:', e);
    try { nodes.baseGain.disconnect(dest); } catch (_) {}
    alert('Recording is not supported in this browser.');
    return;
  }

  mediaRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: recordedChunks.length ? recordedChunks[0].type : 'audio/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = 'wind_turbine_10s.webm';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 150);
    try { nodes.baseGain.disconnect(dest); } catch (ex) {}
  };

  mediaRecorder.start();
  if (els.recordBtn) els.recordBtn.disabled = true;

  setTimeout(() => {
    try { if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop(); }
    catch (e) { console.warn('Stopping mediaRecorder failed', e); }
    if (els.recordBtn) els.recordBtn.disabled = false;
  }, 10000);
}

// Wire up events
// Use 'input' for sliders to reduce duplicate triggers, 'change' for selects/checkboxes
if (els.distance) els.distance.addEventListener('input', updateLabels);
if (els.rpm) els.rpm.addEventListener('input', updateLabels);
if (els.blades) els.blades.addEventListener('input', updateLabels);
if (els.bladeLength) els.bladeLength.addEventListener('input', updateLabels);
if (els.hubHeight) els.hubHeight.addEventListener('input', updateLabels);
if (els.wind) els.wind.addEventListener('input', updateLabels);
if (els.turbines) els.turbines.addEventListener('input', updateLabels);

if (els.windDir) els.windDir.addEventListener('change', updateLabels);
if (els.airAbsorb) els.airAbsorb.addEventListener('change', updateLabels);
if (els.groundEffect) els.groundEffect.addEventListener('change', updateLabels);

if (els.speakerProfile) els.speakerProfile.addEventListener('change', updateLabels);
if (els.realism) els.realism.addEventListener('change', updateLabels);
if (els.hq) els.hq.addEventListener('change', updateLabels);

if (els.startBtn) els.startBtn.addEventListener('click', startAudio);
if (els.stopBtn) els.stopBtn.addEventListener('click', stopAudio);
if (els.recordBtn) els.recordBtn.addEventListener('click', recordTenSeconds);

// initial draw and labels
updateLabels();
drawWindIndicator();
