let audioCtx;
let nodes = {};
let isRunning = false;
let mediaRecorder;
let recordedChunks = [];
let bladeRotation = 0;

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
  
  // Text value spans
  distanceVal: document.getElementById('distanceVal'),
  rpmVal: document.getElementById('rpmVal'),
  bladesVal: document.getElementById('bladesVal'),
  bladeLengthVal: document.getElementById('bladeLengthVal'),
  hubHeightVal: document.getElementById('hubHeightVal'),
  windVal: document.getElementById('windVal'),
  turbinesVal: document.getElementById('turbinesVal'),
};

function updateLabels() {
  // Robust check to ensure all necessary elements exist before accessing .value
  if (!els.distance || !els.rpm || !els.blades || !els.bladeLength || !els.hubHeight || !els.wind || !els.turbines) return;

  els.distanceVal.textContent = els.distance.value;
  els.rpmVal.textContent = els.rpm.value;
  els.bladesVal.textContent = els.blades.value;
  els.bladeLengthVal.textContent = els.bladeLength.value;
  els.hubHeightVal.textContent = els.hubHeight.value;
  els.windVal.textContent = els.wind.value;
  els.turbinesVal.textContent = els.turbines.value;

  const rpm = parseFloat(els.rpm.value);
  const blades = parseInt(els.blades.value);
  const bladeLength = parseFloat(els.bladeLength.value);
  const sizeFactor = 50 / bladeLength;
  const bpf = ((blades * rpm) / 60) * sizeFactor;
  els.bpfReadout.textContent = `${bpf.toFixed(2)} Hz`;

  const d = Math.max(1, parseFloat(els.distance.value));
  
  // Acoustic Calibration based on real-world data: L_ref = 68 dB(A) at 50m
  const BASELINE_SPL_50M = 68; 
  const refDistance = 50; 
  
  // relDb: distance drop from 50m (always negative or zero)
  const relDb = 20 * Math.log10(refDistance / d);
  
  // multiTurbineDb: sound addition from N turbines (always positive or zero)
  const turbines = parseInt(els.turbines.value); 
  const multiTurbineDb = 10 * Math.log10(turbines); 

  const absoluteSpl = BASELINE_SPL_50M + relDb + multiTurbineDb;
  els.splReadout.textContent = `${absoluteSpl.toFixed(1)} dB(A)`;

  if (isRunning) applyParams();
}

function createNoiseBuffer(ctx, seconds = 2) {
  const buffer = ctx.createBuffer(1, seconds * ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
  return buffer;
}

function setupAudio() {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  const noiseBuffer = createNoiseBuffer(audioCtx, 4);
  const noise = audioCtx.createBufferSource();
  noise.buffer = noiseBuffer;
  noise.loop = true;

  const bandpass = audioCtx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.value = 400;
  bandpass.Q.value = 0.7;

  const lpf = audioCtx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = 18000;

  const groundShelf = audioCtx.createBiquadFilter();
  groundShelf.type = 'lowshelf';
  groundShelf.frequency.value = 120;
  groundShelf.gain.value = -3;

  const gain = audioCtx.createGain();
  gain.gain.value = 0.0;

  const lfo = audioCtx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 1.0;

  const lfoDepth = audioCtx.createGain();
  lfoDepth.gain.value = 0.25;

  const baseGain = audioCtx.createGain();
  baseGain.gain.value = 3.0; // Volume boost for laptop speakers

  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;

  noise.connect(bandpass);
  bandpass.connect(lpf);
  lpf.connect(groundShelf);
  groundShelf.connect(baseGain);
  baseGain.connect(gain);
  gain.connect(analyser);
  analyser.connect(audioCtx.destination);

  lfo.connect(lfoDepth);
  lfoDepth.connect(baseGain.gain);

  nodes = { noise, bandpass, lpf, groundShelf, baseGain, gain, lfo, lfoDepth, analyser };
}

function applyParams() {
  if (!nodes.bandpass) return;

  const rpm = parseFloat(els.rpm.value);
  const blades = parseInt(els.blades.value);
  const bladeLength = parseFloat(els.bladeLength.value);
  const wind = parseFloat(els.wind.value);
  const d = Math.max(1, parseFloat(els.distance.value));
  const windDir = els.windDir.value;
  const hubHeight = parseFloat(els.hubHeight.value);
  const turbines = parseInt(els.turbines.value);

  const sizeFactor = 50 / bladeLength;
  const bpf = ((blades * rpm) / 60) * sizeFactor;

  const tipSpeedHz = (100 + wind * 10) * sizeFactor;
  nodes.bandpass.frequency.setTargetAtTime(tipSpeedHz, audioCtx.currentTime, 0.05);
  nodes.bandpass.Q.setTargetAtTime(1.0 + wind * 0.05, audioCtx.currentTime, 0.05);

  nodes.lfo.frequency.setTargetAtTime(Math.max(0.2, bpf), audioCtx.currentTime, 0.05);
  nodes.lfoDepth.gain.setTargetAtTime(0.2 + wind * 0.01, audioCtx.currentTime, 0.1);

  let dirGainFactor = 1.0;
  let dirCutoffBoost = 0;
  if (windDir === 'toward') { dirGainFactor = 1.3; dirCutoffBoost = 4000; }
  else if (windDir === 'away') { dirGainFactor = 0.6; dirCutoffBoost = -4000; }

  const refDistance = 50; 
  let gainVal = Math.min(1.0, refDistance / d);
  
  const turbinesGainFactor = Math.sqrt(turbines);
  
  nodes.gain.gain.setTargetAtTime(gainVal * dirGainFactor * turbinesGainFactor, audioCtx.currentTime, 0.05);

  const airAbsorbOn = els.airAbsorb.checked;
  const cutoff = airAbsorbOn ? Math.max(1000, 18000 / (1 + d / 200)) : 18000;
  nodes.lpf.frequency.setTargetAtTime(Math.max(200, cutoff + dirCutoffBoost), audioCtx.currentTime, 0.1);

  const groundOn = els.groundEffect.checked;
  let groundGain = groundOn ? -4 : 0;
  
  const hubHeight = parseFloat(els.hubHeight.value);
  const heightRatio = Math.min(1, hubHeight / 150); 
  groundGain *= (1 - 0.2 * heightRatio);

  nodes.groundShelf.gain.setTargetAtTime(groundGain, audioCtx.currentTime, 0.1);
}

function startAudio() {
  if (isRunning) return;
  setupAudio();
  
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(e => console.error("Error resuming audio context:", e));
  }
  
  nodes.noise.start();
  nodes.lfo.start();
  isRunning = true;
  els.startBtn.disabled = true;
  els.stopBtn.disabled = false;
  els.recordBtn.disabled = false;
  applyParams();
  drawMeter();
  drawWindIndicator();
}

function stopAudio() {
  if (!isRunning) return;
  try { nodes.noise.stop(); } catch(e) {}
  try { nodes.lfo.stop(); } catch(e) {}
  try { audioCtx.close(); } catch(e) {}
  isRunning = false;
  els.startBtn.disabled = false;
  els.stopBtn.disabled = true;
  els.recordBtn.disabled = true;
}

function drawMeter() {
  if (!isRunning) return; // Only run the meter if audio is playing
  const canvas = els.meterCanvas;
  const ctx = canvas.getContext('2d');
  const bufferLength = nodes.analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  
  if (nodes.analyser) {
    nodes.analyser.getByteTimeDomainData(dataArray);
  }

  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = '#161b22';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#58a6ff';
  ctx.beginPath();
  const sliceWidth = canvas.width / bufferLength;
  let x = 0;
  for (let i = 0; i < bufferLength; i++) {
    const v = dataArray[i] / 128.0;
    const y = v * canvas.height/2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    x += sliceWidth;
  }
  ctx.stroke();
  requestAnimationFrame(drawMeter);
}

function drawWindIndicator() {
  const canvas = els.windDirCanvas;
  if (!canvas) {
    requestAnimationFrame(drawWindIndicator); 
    return;
  }
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  
  // Clear the canvas
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = '#161b22';
  ctx.fillRect(0,0,w,h);

  // Layout positions
  const turbineX = 80;
  const listenerX = w - 80; 
  const groundY = h - 30;

  // VISUAL SCALING
  // We need to check if the hubHeight element is available before using its value
  const userHubHeight = els.hubHeight ? parseFloat(els.hubHeight.value) : 300; 
  const maxHubHeightInput = 300; 
  const maxHubHeightPx = 70; 
  const hubHeightPx = (userHubHeight / maxHubHeightInput) * maxHubHeightPx; 
  const hubY = groundY - hubHeightPx; 
  // END VISUAL SCALING

  // Blade Rotation Update (Only spins when audio is running)
  if (isRunning) {
    const rpm = parseFloat(els.rpm.value);
    bladeRotation += (rpm / 60) * 0.1;
  }

  // 1. TOWER (Triangle base to Hub)
  ctx.fillStyle = '#8b949e';
  ctx.beginPath();
  ctx.moveTo(turbineX, hubY);
  ctx.lineTo(turbineX - 8, groundY);
  ctx.lineTo(turbineX + 8, groundY);
  ctx.fill();

  // 2. HUB
  ctx.fillStyle = '#c9d1d9';
  ctx.beginPath(); 
  ctx.arc(turbineX, hubY, 6, 0, Math.PI*2); 
  ctx.fill();

  // 3. BLADES
  ctx.strokeStyle = '#c9d1d9';
  ctx.lineWidth = 3;
  const bladeCount = els.blades ? parseInt(els.blades.value) : 3; // Fallback
  const bladePx = 35; 
  for (let i=0; i<bladeCount; i++){
    const ang = bladeRotation + i*(Math.PI*2/bladeCount);
    ctx.beginPath();
    ctx.moveTo(turbineX, hubY);
    ctx.lineTo(turbineX + Math.cos(ang)*bladePx, hubY + Math.sin(ang)*bladePx);
    ctx.stroke();
  }

  // 4. LISTENER
  const headY = groundY - 15;
  ctx.strokeStyle = '#8b949e';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(listenerX, headY, 10, 0, Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(listenerX, headY+10); ctx.lineTo(listenerX, groundY); ctx.stroke();
  ctx.beginPath(); ctx.arc(listenerX, headY, 12, Math.PI, 0); ctx.stroke();

  // 5. WIND ARROW 
  const wind = els.wind ? parseFloat(els.wind.value) : 8; // Fallback
  const windDir = els.windDir ? els.windDir.value : 'neutral'; // Fallback
  
  if (windDir !== 'neutral') {
    let arrowColor = windDir === 'toward' ? '#3fb950' : '#f85149';
    const arrowY = hubY;
    const arrowLen = Math.min(100, 40 + wind * 5);
    const centerX = (turbineX + listenerX) / 2;
    
    const startX = centerX - (windDir === 'toward' ? arrowLen/2 : -arrowLen/2);
    const endX   = centerX + (windDir === 'toward' ? arrowLen/2 : -arrowLen/2);

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

  // 6. INFO TEXT
  ctx.fillStyle = '#58a6ff';
  ctx.font = '12px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText(`Hub Height: ${userHubHeight} m`, 10, h - 10);

  // Always schedule the next frame to keep the visualization loop running
  requestAnimationFrame(drawWindIndicator);
}

async function recordTenSeconds() {
  if (!isRunning) return;
  const dest = audioCtx.createMediaStreamDestination();
  nodes.analyser.disconnect();
  nodes.analyser.connect(dest);
  nodes.analyser.connect(audioCtx.destination);
  recordedChunks = [];
  mediaRecorder = new MediaRecorder(dest.stream);
  mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: 'audio/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display='none';
    a.href=url;
    a.download='wind_turbine_10s.webm';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  };
  mediaRecorder.start();
  els.recordBtn.disabled = true;
  setTimeout(() => { mediaRecorder.stop(); els.recordBtn.disabled = false; }, 10000);
}

// Initialize
['input','change'].forEach(evt => {
  if(els.distance) els.distance.addEventListener(evt, updateLabels);
  if(els.rpm) els.rpm.addEventListener(evt, updateLabels);
  if(els.blades) els.blades.addEventListener(evt, updateLabels);
  if(els.bladeLength) els.bladeLength.addEventListener(evt, updateLabels);
  if(els.hubHeight) els.hubHeight.addEventListener(evt, updateLabels);
  if(els.wind) els.wind.addEventListener(evt, updateLabels);
  if(els.windDir) els.windDir.addEventListener(evt, updateLabels);
  if(els.turbines) els.turbines.addEventListener(evt, updateLabels);
  if(els.airAbsorb) els.airAbsorb.addEventListener(evt, updateLabels);
  if(els.groundEffect) els.groundEffect.addEventListener(evt, updateLabels);
});

if (els.startBtn) els.startBtn.addEventListener('click', startAudio);
if (els.stopBtn) els.stopBtn.addEventListener('click', stopAudio);
if (els.recordBtn) els.recordBtn.addEventListener('click', recordTenSeconds);

updateLabels();
drawWindIndicator();