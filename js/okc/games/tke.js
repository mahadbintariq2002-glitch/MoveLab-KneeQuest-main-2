// games/tke.js — OKC Game 4: Terminal Knee Extension → "Lock the Slot".
// Short-arc quad control: from a shallow "cocked" bend, drive the knee to FULL
// LOCK (the patient's calibrated 0°) and hold — then release only partway (not a
// deep bend) before re-cocking for the next rep. Trains the terminal few degrees
// of extension, usually the weakest range after knee injury/surgery — distinct
// from Quad Press (which holds from any depth) by requiring a fresh short-arc
// "cock" before every lock, and by using a small range instead of a big press.
import { HoldDecay, Steady, starsFor } from "../rehab.js";

const DIFFS = {
  gentle:   { cockOff:20, lockTol:7, holdSecs:3, reps:5 },
  steady:   { cockOff:28, lockTol:5, holdSecs:4, reps:6 },
  champion: { cockOff:35, lockTol:3, holdSecs:5, reps:8 },
};

class LockSlot {
  constructor(ctx){
    this.W=ctx.W; this.H=ctx.H; this.audio=ctx.audio; this.onEvent=ctx.onEvent||(()=>{});
    this.d = DIFFS[ctx.difficulty]||DIFFS.gentle;
    this.extRef = ctx.extRef || 178;          // patient's calibrated full-extension angle (0° reference)
    this.lockAngle = this.extRef - this.d.lockTol;   // at/above this = "locked"
    this.cockAngle = this.extRef - this.d.cockOff;   // at/below this = "cocked" (armed)
    this.holdSecs = ctx.holdSecs || this.d.holdSecs;
    this.hold=new HoldDecay({holdSecs:this.holdSecs, decay:1.1});
    this.steady=new Steady(16,5);
    this.score=0; this.qSum=0; this.qN=0; this.reps=0; this.repsTarget=ctx.repsTarget||this.d.reps;
    this.phase="cock"; this.pos=0; this.glow=0; this.gearRot=0; this.clunk=0; this.t=0;
    this.parts=[]; this.pops=[]; this.done=false; this.result=null;
    this.angle=null; this.angleDisp=null; this.conf=0; this.fb={text:"",color:"#9aa6d4"};
  }
  resize(W,H){ this.W=W; this.H=H; }

  update(dt, m, now){
    if(this.done) return; this.t+=dt; this.gearRot += dt*(0.6+this.glow*3);
    const angle=m.kneeAngle, tracked=m.tracked && angle!=null;
    this.angle=tracked?angle:null; this.conf=m.conf||0;
    this.angleDisp = tracked ? (m.kneeAngleDisp!=null?m.kneeAngleDisp:angle) : null;

    // pos: 0 at the cocked depth .. 1 at full lock (extRef)
    if(tracked) this.pos = Math.max(0,Math.min(1,(angle-this.cockAngle)/(this.extRef-this.cockAngle)));

    const inLock = tracked && angle >= this.lockAngle;
    const armed = tracked && angle <= this.cockAngle;
    if(tracked) this.steady.push(angle);
    const steadiness = (this.phase==="lock" && inLock) ? this.steady.value() : 0;

    if(this.phase==="cock"){
      if(armed) this.phase="lock";
    } else {
      const r=this.hold.update(inLock, dt, now/1000);
      if(inLock){ this.score += dt*12*(0.5+0.5*steadiness); this.qSum+=steadiness; this.qN++; }
      if(r.justRep){
        this.reps++; this.score+=70; this.clunk=1; this._burst(); this.pop("🔩 LOCKED!"); this.audio&&this.audio.reward();
        this.onEvent({type:"rep",reps:this.reps});
        if(this.reps>=this.repsTarget){ this._finish(); return; }
        this.phase="cock"; this.hold.reset();
      }
    }
    this.glow += (((this.phase==="lock"&&inLock)?1:0)-this.glow)*Math.min(1,dt*8);
    this.clunk = Math.max(0, this.clunk-dt*2.2);

    if(!tracked) this.fb={text:"📷 Show your whole leg to the camera",color:"#ffb84d"};
    else if(this.phase==="cock") this.fb={text:`Bend slightly to the cocked position ↓ (~${this.d.cockOff}°)`,color:"#37e1ff"};
    else if(!inLock) this.fb={text:"Drive your knee straight — lock it! →",color:"#37e1ff"};
    else this.fb = steadiness>0.6 ? {text:"Locked — hold it steady! 🔩",color:"#8affc0"} : {text:"Hold the lock…",color:"#ffb84d"};

    this._step(dt);
  }
  _finish(){ this.done=true; const q=this.qN? this.qSum/this.qN : 0;
    this.result={ completed:true, stars:starsFor(q), score:Math.round(this.score), reps:this.reps, quality:+(q*100).toFixed(0) };
    this._burst(); this.clunk=1;
    this.onEvent({type:"end",...this.result}); }
  status(){ return { progress:this.hold.p, score:Math.round(this.score), reps:this.reps, repsTarget:this.repsTarget, feedback:this.fb, done:this.done, result:this.result }; }

  // ── render: an industrial slide-bolt — cock (bend), drive to lock (straighten),
  // hold; gears spin, sparks fly, a lamp lights on the panel each successful lock. ──
  render(g, now){
    const W=this.W,H=this.H, trackY=H*0.55, x0=W*0.16, x1=W*0.8, trackW=x1-x0;
    const lockActive=this.phase==="lock";

    const bgg=g.createLinearGradient(0,0,0,H); bgg.addColorStop(0,"#1b2230"); bgg.addColorStop(1,"#0c0f16");
    g.fillStyle=bgg; g.fillRect(0,0,W,H);
    g.strokeStyle="#242c3d"; g.lineWidth=1;
    for(let gx=(W%40);gx<W;gx+=40){ g.beginPath(); g.moveTo(gx,0); g.lineTo(gx,H); g.stroke(); }
    for(let gy=(H%40);gy<H;gy+=40){ g.beginPath(); g.moveTo(0,gy); g.lineTo(W,gy); g.stroke(); }
    this._hazard(g,0,0,W,8); this._hazard(g,0,H-8,W,8);

    if(this.clunk>0){ g.fillStyle=`rgba(255,255,255,${0.45*this.clunk})`; g.fillRect(0,0,W,H); }
    if(this.glow>0.02){ const ag=g.createRadialGradient(x1,trackY,10,x1,trackY,Math.max(W,H)*0.55);
      ag.addColorStop(0,`rgba(138,255,192,${0.16*this.glow})`); ag.addColorStop(1,"rgba(138,255,192,0)"); g.fillStyle=ag; g.fillRect(0,0,W,H); }

    // track
    g.strokeStyle="#3a4560"; g.lineWidth=18; g.lineCap="round"; g.beginPath(); g.moveTo(x0,trackY); g.lineTo(x1,trackY); g.stroke();
    g.strokeStyle="#1c2333"; g.lineWidth=9; g.beginPath(); g.moveTo(x0,trackY); g.lineTo(x1,trackY); g.stroke();

    // cock zone
    const cockZoneW=trackW*0.24, cockActive=this.phase==="cock";
    g.fillStyle= cockActive ? `rgba(55,225,255,${0.16+0.1*this._pulse()})` : "rgba(55,225,255,0.07)";
    g.fillRect(x0, trackY-19, cockZoneW, 38);
    g.strokeStyle="#37e1ff"; g.lineWidth=2; g.setLineDash([5,5]); g.strokeRect(x0,trackY-19,cockZoneW,38); g.setLineDash([]);
    g.fillStyle= cockActive?"#37e1ff":"#7a86ad"; g.font="bold 12px sans-serif"; g.textAlign="left"; g.fillText("COCK", x0, trackY-28);

    // lock zone
    const lockZoneW=trackW*0.16, lockZoneX=x1-lockZoneW;
    g.fillStyle= lockActive ? `rgba(138,255,192,${0.18+0.16*this._pulse()})` : "rgba(138,255,192,0.07)";
    g.fillRect(lockZoneX, trackY-19, lockZoneW, 38);
    g.strokeStyle= lockActive?"#8affc0":"#5a6a90"; g.lineWidth=2+(lockActive?this._pulse()*2:0);
    g.strokeRect(lockZoneX,trackY-19,lockZoneW,38);
    g.fillStyle= lockActive?"#8affc0":"#7a86ad"; g.textAlign="right"; g.fillText("LOCK", x1, trackY-28);

    // gears flanking the lock zone
    this._gear(g, x1+30, trackY-30, 16, this.gearRot);
    this._gear(g, x1+30, trackY+30, 11, -this.gearRot*1.5);

    // sliding bolt
    const bx = x0 + this.pos*trackW;
    g.strokeStyle="#ffb84d66"; g.lineWidth=4; g.beginPath(); g.moveTo(x0,trackY); g.lineTo(bx,trackY); g.stroke();
    g.save(); g.translate(bx,trackY);
    g.fillStyle="#e7ecf5"; g.fillRect(-24,-9,32,18); g.strokeStyle="#1c2333"; g.lineWidth=2; g.strokeRect(-24,-9,32,18);
    g.fillStyle= lockActive&&this.pos>0.9 ? "#8affc0" : "#ffb84d"; g.beginPath(); g.arc(11,0,13,0,7); g.fill(); g.strokeStyle="#1c2333"; g.stroke();
    g.restore();

    // hold ring in the lock zone
    if(lockActive){ g.beginPath(); g.arc(lockZoneX+lockZoneW/2, trackY, 32, -Math.PI/2, -Math.PI/2+this.hold.p*2*Math.PI);
      g.strokeStyle="#ffe08a"; g.lineWidth=6; g.lineCap="round"; g.stroke(); }

    for(const p of this.parts){ g.globalAlpha=Math.max(0,p.life); g.fillStyle=p.c; g.beginPath(); g.arc(p.x,p.y,3,0,7); g.fill(); } g.globalAlpha=1;

    // lamp panel — one indicator per rep
    { const pw=Math.min(30,(W*0.85)/this.repsTarget);
      for(let i=0;i<this.repsTarget;i++){ const lx=W*0.5-(this.repsTarget-1)*pw/2+i*pw, ly=H*0.16, lit=i<this.reps;
        if(lit){ const gg=g.createRadialGradient(lx,ly,1,lx,ly,pw); gg.addColorStop(0,"rgba(138,255,192,0.55)"); gg.addColorStop(1,"rgba(138,255,192,0)");
          g.fillStyle=gg; g.beginPath(); g.arc(lx,ly,pw,0,7); g.fill(); }
        g.beginPath(); g.arc(lx,ly,pw*0.26,0,7); g.fillStyle= lit ? "#8affc0" : "#333d52"; g.fill();
        g.strokeStyle="#10151f"; g.lineWidth=2; g.stroke(); } }

    // live readout
    const flexFromZero = this.angle==null? null : Math.max(0,Math.round(this.extRef-this.angle));
    g.textAlign="center"; g.font="900 30px sans-serif"; g.fillStyle="#eef2ff";
    g.fillText(flexFromZero==null?"— °":flexFromZero+"° bent", W*0.5, H*0.28);
    g.font="bold 13px sans-serif";
    if(this.angle==null){ g.fillStyle="#ffb84d"; g.fillText("no knee detected", W*0.5, H*0.28+20); }
    else { g.fillStyle=lockActive?"#8affc0":"#37e1ff"; g.fillText(cockActive?`bend to ~${this.d.cockOff}° first`:"drive to lock (0°)", W*0.5, H*0.28+20); }
    g.font="11px sans-serif"; g.fillStyle="#9aa6d4"; g.fillText(`confidence ${Math.round(this.conf*100)}%  ·  hold ${this.holdSecs}s`, W*0.5, H*0.28+38);

    for(const p of this.pops){ g.globalAlpha=Math.max(0,p.life); g.fillStyle="#ffe08a"; g.font="900 22px sans-serif"; g.textAlign="center"; g.fillText(p.t,p.x,p.y); } g.globalAlpha=1;
  }
  _pulse(){ return (Math.sin(this.t*4)+1)/2; }
  _hazard(g,x,y,w,h){ const n=Math.ceil(w/20); for(let i=0;i<n;i++){ g.fillStyle= i%2===0?"#e8b93a":"#141414"; g.fillRect(x+i*20,y,20,h); } }
  _gear(g,x,y,r,rot){ g.save(); g.translate(x,y); g.rotate(rot); g.fillStyle="#4a5670";
    for(let i=0;i<8;i++){ g.save(); g.rotate(i*Math.PI/4); g.fillRect(-2,-r-6,4,9); g.restore(); }
    g.beginPath(); g.arc(0,0,r,0,7); g.fill(); g.fillStyle="#1c2333"; g.beginPath(); g.arc(0,0,r*0.42,0,7); g.fill(); g.restore(); }
  _burst(){ const x=this.W*0.8-this.W*0.16*0.5, y=this.H*0.55;
    for(let i=0;i<20;i++){ const a=Math.random()*7,s=Math.random()*5+1; this.parts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:1,c:Math.random()<0.5?"#ffe08a":"#8affc0"}); } }
  pop(t){ this.pops.push({x:this.W*0.5,y:this.H*0.4,t,life:1}); }
  _step(dt){ for(const p of this.parts){ p.x+=p.vx; p.y+=p.vy; p.vy+=0.1; p.life-=dt*1.5; } this.parts=this.parts.filter(p=>p.life>0);
    for(const p of this.pops){ p.y-=26*dt; p.life-=dt*1.1; } this.pops=this.pops.filter(p=>p.life>0); }
}

export default {
  id:"tke", name:"Lock the Slot", emoji:"🔩", exercise:"Terminal Knee Extension", camera:"Sagittal (side-on)",
  howto:"Sit with your leg supported. <b>Bend slightly</b> to the cocked position, then <b>drive your knee straight</b> to lock it and <b>hold</b> — release only partway before the next lock.",
  calib:"extension", diffs:Object.keys(DIFFS),
  // mouse-preview: pointer height → knee angle over a short arc near extension
  mouseMetrics(p){ const angle=178-p*45; return { tracked:true, conf:1, flex:178-angle, kneeFlex:178-angle, kneeAngle:angle, kneeAngleDisp:angle, hipAngle:150, ankle:{x:.5,y:p}, side:"L" }; },
  make(ctx){ return new LockSlot(ctx); },
};
