// audio.js — AudioManager: procedural music + SFX via WebAudio (no external assets).
export const Audio = {
  ctx:null, master:null, musicGain:null, muted:false, _musicTimer:null, _step:0,

  init(){
    if(this.ctx) return;
    try{
      this.ctx = new (window.AudioContext||window.webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.gain.value = this.muted?0:0.9; this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0.22; this.musicGain.connect(this.master);
    }catch(e){}
  },
  resume(){ if(this.ctx && this.ctx.state==="suspended") this.ctx.resume(); },
  setMuted(m){ this.muted=m; if(this.master) this.master.gain.value = m?0:0.9; },

  // ── SFX ──
  _blip(freq, dur, type="triangle", vol=0.3, glideTo=null){
    if(!this.ctx||this.muted) return; const t=this.ctx.currentTime;
    const o=this.ctx.createOscillator(), g=this.ctx.createGain();
    o.type=type; o.frequency.setValueAtTime(freq,t); if(glideTo)o.frequency.exponentialRampToValueAtTime(glideTo,t+dur);
    g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(vol,t+0.01); g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t+dur+0.02);
  },
  tap(){ this._blip(520,0.08,"square",0.18); },
  hit(){ this._blip(880,0.12,"triangle",0.22,1400); },
  fail(){ this._blip(220,0.25,"sawtooth",0.2,120); },
  reward(){ [660,880,1320].forEach((f,i)=>setTimeout(()=>this._blip(f,0.18,"triangle",0.25),i*90)); },
  charge(){ this._blip(300,0.3,"sine",0.15,900); },
  nova(){ if(!this.ctx||this.muted)return; const t=this.ctx.currentTime;
    const o=this.ctx.createOscillator(),g=this.ctx.createGain(); o.type="sawtooth";
    o.frequency.setValueAtTime(120,t); o.frequency.exponentialRampToValueAtTime(1600,t+0.5);
    g.gain.setValueAtTime(0.35,t); g.gain.exponentialRampToValueAtTime(0.0001,t+0.7); o.connect(g); g.connect(this.master); o.start(t); o.stop(t+0.75); },
  victory(){ [523,659,784,1047].forEach((f,i)=>setTimeout(()=>this._blip(f,0.3,"triangle",0.28),i*130)); },

  // ── ambient music: slow pentatonic arpeggio + pad ──
  startMusic(){
    if(!this.ctx||this._musicTimer) return;
    const scale=[261.63,293.66,329.63,392.00,440.00,523.25]; // C pentatonic-ish
    // soft pad
    const pad=this.ctx.createOscillator(), pg=this.ctx.createGain(), pf=this.ctx.createBiquadFilter();
    pad.type="sine"; pad.frequency.value=130.81; pf.type="lowpass"; pf.frequency.value=600; pg.gain.value=0.06;
    pad.connect(pf); pf.connect(pg); pg.connect(this.musicGain); pad.start(); this._pad=pad;
    const tick=()=>{ if(!this.ctx) return; const f=scale[(this._step*3)%scale.length]*(this._step%8<4?1:1.5);
      const t=this.ctx.currentTime, o=this.ctx.createOscillator(), g=this.ctx.createGain();
      o.type="triangle"; o.frequency.value=f; g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.12,t+0.05);
      g.gain.exponentialRampToValueAtTime(0.0001,t+0.9); o.connect(g); g.connect(this.musicGain); o.start(t); o.stop(t+1);
      this._step++; };
    this._musicTimer=setInterval(tick, 460);
  },
  stopMusic(){ if(this._musicTimer){ clearInterval(this._musicTimer); this._musicTimer=null; } if(this._pad){ try{this._pad.stop();}catch(e){} this._pad=null; } },
};
