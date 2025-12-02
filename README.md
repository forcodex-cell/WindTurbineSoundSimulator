# 🌬️ Wind Turbine Sound Generator  
**Real-time, distance-aware, wind-aware wind turbine audio simulation using Web Audio API**

This project is an interactive turbine sound simulator that models basic acoustic behavior of a modern wind turbine using procedural audio.  
It includes distance loss, blade-pass frequency modeling, wind-direction effects, turbine count scaling, ground effect, and speaker compensation for realistic playback on laptop speakers.

The application runs entirely in the browser with no external dependencies.

---

## 🚀 Features

### **Core Acoustic Model**
- Blade-pass frequency (BPF) tonal components  
- Broadband aerodynamic noise  
- Distance-based attenuation (1/√distance model)  
- Multi-turbine SPL scaling  
- Simple atmospheric absorption  
- Ground effect (low-frequency cancellation)  

### **Real-Time Controls**
- Distance  
- RPM  
- Number of blades  
- Blade length  
- Hub height  
- Wind speed  
- Wind direction (toward/away listener)  
- Number of turbines  
- Atmospheric absorption toggle  
- Ground effect toggle  

### **Advanced Sound Options**
- **Speaker Profile**  
  - Laptop (moderate EQ compensation)  
  - External speakers  
  - Flat / Headphones  
- **Realism Mode**  
  - Adds blade-pass thump/whump modulation  
  - Enhances “turbine presence” on laptop speakers  
- **High Quality Mode**  
  - Longer noise buffers (12s)  
  - Higher-Q filters  
  - Smoother tonal shaping  

### **Visualizations**
- Waveform meter (oscilloscope-style)  
- Wind direction indicator with animated turbine blades  
- Listener & turbine diagram

### **Recording**
- Record 10-second audio directly to `.webm` (browser support required)  
- Safe fallback for browsers without MediaRecorder support

---

## 🛠️ Technology

This project is built with:

- **JavaScript ES6**
- **Web Audio API**
- **HTML5 Canvas**
- **No external libraries**

---

## 📁 Project Structure

