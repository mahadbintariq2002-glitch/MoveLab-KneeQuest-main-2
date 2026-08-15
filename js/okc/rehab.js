// rehab.js — reusable rehabilitation-logic primitives shared by OKC games.
// Deterministic, DOM-free → unit-testable.

// Steadiness (0..1) from the variance of a signal over a short rolling window.
export class Steady{
  constructor(win=20, tol=8){ this.win=win; this.tol=tol; this.buf=[]; }
  push(v){ this.buf.push(v); if(this.buf.length>this.win) this.buf.shift(); }
  value(){ if(this.buf.length<3) return 1; const m=this.buf.reduce((a,b)=>a+b,0)/this.buf.length;
    const sd=Math.sqrt(this.buf.reduce((a,b)=>a+(b-m)*(b-m),0)/this.buf.length);
    return Math.max(0, Math.min(1, 1 - sd/this.tol)); }
  reset(){ this.buf.length=0; }
}

// Hold-with-decay: fills while "inZone", decays when not. One rep = reach 1.0.
export class HoldDecay{
  constructor({holdSecs=10, decay=0.6, grace=0.35}={}){ this.cfg={holdSecs,decay,grace}; this.reset(); }
  configure(p){ Object.assign(this.cfg,p); }
  reset(){ this.p=0; this.reps=0; this._out=0; this._last=null; this.justRep=false; return this; }
  update(inZone, dt, tSec){
    this.justRep=false;
    const fill=1/this.cfg.holdSecs;                 // progress per second while holding
    if(inZone){ this.p += dt*fill; this._last=tSec; }
    else if(this._last==null || (tSec-this._last)>this.cfg.grace){ this.p -= dt*fill*this.cfg.decay; } // decay at a fraction of fill speed
    if(this.p>=1){ this.p=0; this.reps++; this.justRep=true; }
    this.p=Math.max(0,Math.min(1,this.p));
    return { progress:this.p, reps:this.reps, justRep:this.justRep };
  }
}

// Rep counter with hysteresis on a scalar crossing high→low→high (for curls/ROM).
export class RepCycle{
  constructor({hi, lo}){ this.hi=hi; this.lo=lo; this.reps=0; this.phase="mid"; this.justRep=false; }
  update(v){ this.justRep=false;
    if(this.phase!=="hi" && v>=this.hi){ if(this.phase==="lo"){ this.reps++; this.justRep=true; } this.phase="hi"; }
    else if(this.phase!=="lo" && v<=this.lo){ this.phase="lo"; }
    return { reps:this.reps, justRep:this.justRep, phase:this.phase }; }
  reset(){ this.reps=0; this.phase="mid"; }
}

// Star rating from a 0..1 quality score.
export function starsFor(q){ return q>=0.85?3 : q>=0.6?2 : 1; }
