// games/quad.js — OKC Game 1: Quad Isometrics → "Quad Press".
// Straighten the knee toward FULL EXTENSION and HOLD. The charge fills ONLY when
// the knee angle is near 180° (extended); flexing can never fill it.
// Proper rep cycle: EXTEND+hold → rep → must RELAX (bend back) before the next.
import { HoldDecay, Steady, starsFor } from "../rehab.js";

// tol = degrees below the patient's calibrated full extension still counted as "extended".
// The bar fills ONLY when kneeAngle >= extRef - tol, so even ~10° of flexion won't fill it.
const DIFFS = {
  gentle:   { tol:6, holdSecs:6,  reps:3, decay:0.8 },
  steady:   { tol:4, holdSecs:9,  reps:4, decay:1.1 },
  champion: { tol:3, holdSecs:12, reps:5, decay:1.5 },
};

class QuadPress {
  constructor(ctx){
    this.W=ctx.W; this.H=ctx.H; this.audio=ctx.audio; this.onEvent=ctx.onEvent||(()=>{});
    this.d = DIFFS[ctx.difficulty]||DIFFS.gentle;
    this.holdSecs = ctx.holdSecs || this.d.holdSecs;
    this.extRef = ctx.extRef || 178;                 // patient's calibrated full-extension angle
    this.extAngle = this.extRef - this.d.tol;        // fill only at/above this
    this.relaxAngle = this.extRef - 32;              // must bend back below this to arm next rep
    this.hold=new HoldDecay({holdSecs:this.holdSecs, decay:this.d.decay});
    this.steady=new Steady(20, 6);
    this.score=0; this.qSum=0; this.qN=0; this.reps=0; this.repsTarget=this.d.reps;
    this.phase="extend"; this.roller=0.2; this.glow=0; this.zonePulse=0; this.rot=0; this.t=0;
    this.parts=[]; this.stream=[]; this.pops=[]; this.done=false; this.result=null;
    this.angle=null; this.angleDisp=null; this.inZone=false; this.conf=0; this.fb={text:"",color:"#9aa6d4"};
  }
  resize(W,H){ this.W=W; this.H=H; }

  update(dt, m, now){
    if(this.done) return; this.t+=dt; this.rot+=dt*(this.glow*3);
    const angle = m.kneeAngle;                          // 180 = full extension (absolute, precise for logic)
    const tracked = m.tracked && angle!=null; this.angle=tracked?angle:null; this.conf=m.conf||0;
    this.angleDisp = tracked ? (m.kneeAngleDisp!=null?m.kneeAngleDisp:angle) : null;   // steady number for display
    const inZone = tracked && angle >= this.extAngle; // ONLY within tol of full extension
    this.inZone=inZone;
    if(tracked) this.steady.push(angle);
    const steadiness = inZone ? this.steady.value() : 0;

    if(this.phase==="extend"){
      const r=this.hold.update(inZone, dt, now/1000);
      if(inZone){ this.score += dt*12*(0.5+0.5*steadiness); this.qSum+=steadiness; this.qN++; this._emitStream(); }
      if(r.justRep){ this.reps++; this.score+=60; this._burst(); this.pop("+60 ✨"); this.audio&&this.audio.reward(); this.onEvent({type:"rep",reps:this.reps});
        if(this.reps>=this.repsTarget){ this._finish(); return; }
        this.phase="relax"; this.hold.reset(); }
    } else { this.hold.p=0; if(tracked && angle <= this.relaxAngle){ this.phase="extend"; } }

    // roller: straighter (higher angle) presses up into the zone; bending drops it
    const target = tracked ? Math.max(0,Math.min(1,(angle-90)/90)) : 0.2;
    this.roller += (target-this.roller)*Math.min(1,dt*10);
    this.glow += (((this.phase==="extend"&&inZone)?1:0)-this.glow)*Math.min(1,dt*8);
    this.zonePulse=(Math.sin(this.t*3)+1)/2;

    if(!tracked) this.fb={text:"📷 Show your whole leg to the camera",color:"#ffb84d"};
    else if(this.phase==="relax") this.fb={text:"Relax — bend your knee back to reset",color:"#ff9ec7"};
    else if(!inZone) this.fb={text:"Straighten your knee fully →",color:"#37e1ff"};
    else this.fb = steadiness>0.6 ? {text:"Perfect — hold it! 💪",color:"#8affc0"} : {text:"Hold steady…",color:"#ffb84d"};

    this._step(dt);
  }
  _finish(){ this.done=true; const q=this.qN? this.qSum/this.qN : 0;
    this.result={ completed:true, stars:starsFor(q), score:Math.round(this.score), reps:this.reps, quality:+(q*100).toFixed(0) };
    this.onEvent({type:"end",...this.result}); }
  status(){ return { progress:this.hold.p, score:Math.round(this.score), reps:this.reps, repsTarget:this.repsTarget, feedback:this.fb, done:this.done, result:this.result }; }

  // ── render ──
  render(g, now){
    const W=this.W,H=this.H, x=W*0.5, top=H*0.24, bot=H*0.78, trackH=bot-top;
    if(this.glow>0.02){ const ag=g.createRadialGradient(x,H*0.5,40,x,H*0.5,Math.max(W,H)*0.6);
      ag.addColorStop(0,`rgba(138,255,192,${0.10*this.glow})`); ag.addColorStop(1,"rgba(138,255,192,0)"); g.fillStyle=ag; g.fillRect(0,0,W,H); }
    g.strokeStyle="#2c3670"; g.lineWidth=16; g.lineCap="round"; g.beginPath(); g.moveTo(x,top); g.lineTo(x,bot); g.stroke();
    for(const p of this.stream){ g.globalAlpha=Math.max(0,p.life)*0.8; g.fillStyle="#8affc0"; g.beginPath(); g.arc(x+p.dx,p.y,p.r,0,7); g.fill(); } g.globalAlpha=1;
    const zoneH=trackH*0.24, zy=top, active=(this.phase==="extend");
    const za=active?(0.22+0.28*this.zonePulse):0.08;
    const zg=g.createLinearGradient(0,zy,0,zy+zoneH); zg.addColorStop(0,`rgba(138,255,192,${za+0.15})`); zg.addColorStop(1,`rgba(138,255,192,${za*0.2})`);
    g.fillStyle=zg; g.fillRect(x-72,zy,144,zoneH);
    g.strokeStyle=active?"#8affc0":"#5a6a90"; g.lineWidth=2+(active?this.zonePulse*2:0); g.setLineDash([7,6]); g.strokeRect(x-72,zy,144,zoneH); g.setLineDash([]);
    g.fillStyle=active?"#8affc0":"#7a86ad"; g.font="bold 13px sans-serif"; g.textAlign="center"; g.fillText("EXTENSION ZONE", x, zy+zoneH+16);
    if(this.glow>0.5 && Math.random()<0.5){ this.parts.push({x:x+(Math.random()-0.5)*140,y:zy+Math.random()*zoneH,vx:(Math.random()-0.5)*2,vy:-Math.random()*2,life:0.6,c:"#ffffff"}); }
    const ry = bot - this.roller*trackH;
    if(this.glow>0.02){ const gg=g.createRadialGradient(x,ry,4,x,ry,95); gg.addColorStop(0,`rgba(138,255,192,${0.55*this.glow})`); gg.addColorStop(1,"rgba(138,255,192,0)"); g.fillStyle=gg; g.beginPath(); g.arc(x,ry,95,0,7); g.fill(); }
    g.fillStyle="#eef2ff"; g.strokeStyle=this.phase==="relax"?"#ff9ec7":"#37e1ff"; g.lineWidth=3;
    g.beginPath(); g.roundRect? g.roundRect(x-48,ry-21,96,42,11) : g.rect(x-48,ry-21,96,42); g.fill(); g.stroke();
    g.save(); g.translate(x,ry); g.rotate(this.rot); g.strokeStyle="#37e1ff"; g.lineWidth=3;
    for(let i=0;i<6;i++){ g.rotate(Math.PI/3); g.beginPath(); g.moveTo(0,0); g.lineTo(0,-13); g.stroke(); } g.fillStyle="#37e1ff"; g.beginPath(); g.arc(0,0,6,0,7); g.fill(); g.restore();
    g.beginPath(); g.arc(x,ry,58,-Math.PI/2,-Math.PI/2+this.hold.p*2*Math.PI); g.strokeStyle="#ffe08a"; g.lineWidth=6; g.lineCap="round"; g.stroke();
    // LIVE readout — knee angle (180 = straight) + zone status
    g.textAlign="center"; g.font="900 30px sans-serif"; g.fillStyle="#eef2ff";
    g.fillText(this.angleDisp==null?"— °":Math.round(this.angleDisp)+"°", x, top-46);
    g.font="bold 13px sans-serif";
    if(this.angle==null){ g.fillStyle="#ffb84d"; g.fillText("no knee detected", x, top-28); }
    else { g.fillStyle=this.inZone?"#8affc0":"#7a86ad"; g.fillText(this.inZone?"● EXTENDED — hold!":"○ straighten to extend (180°)", x, top-28); }
    g.font="11px sans-serif"; g.fillStyle="#9aa6d4"; g.fillText(`confidence ${Math.round(this.conf*100)}%  ·  hold ${this.holdSecs}s`, x, top-12);
    for(let i=0;i<this.repsTarget;i++){ g.fillStyle=i<this.reps?"#ffe08a":"#ffffff33"; g.font="26px sans-serif"; g.fillText(i<this.reps?"★":"☆", x-(this.repsTarget-1)*17 + i*34, bot+42); }
    for(const p of this.parts){ g.globalAlpha=Math.max(0,p.life); g.fillStyle=p.c; g.beginPath(); g.arc(p.x,p.y,3,0,7); g.fill(); } g.globalAlpha=1;
    for(const p of this.pops){ g.globalAlpha=Math.max(0,p.life); g.fillStyle="#ffe08a"; g.font="bold 20px sans-serif"; g.fillText(p.t,p.x,p.y); } g.globalAlpha=1;
  }
  _emitStream(){ if(Math.random()<0.5) this.stream.push({dx:(Math.random()-0.5)*30, y:this.H*0.78, r:2+Math.random()*3, life:1}); }
  _burst(){ const x=this.W*0.5, y=this.H*0.24+20; for(let i=0;i<18;i++){ const a=Math.random()*7,s=Math.random()*4+1; this.parts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:1,c:Math.random()<0.5?"#ffe08a":"#8affc0"}); } }
  pop(t){ this.pops.push({x:this.W*0.5,y:this.H*0.24+40,t,life:1}); }
  _step(dt){ for(const p of this.parts){ p.x+=p.vx; p.y+=p.vy; p.vy+=0.08; p.life-=dt*1.5; } this.parts=this.parts.filter(p=>p.life>0);
    for(const p of this.pops){ p.y-=28*dt; p.life-=dt*1.1; } this.pops=this.pops.filter(p=>p.life>0);
    const topY=this.H*0.24+ (this.H*0.78-this.H*0.24)*(1-this.roller);
    for(const p of this.stream){ p.y-=180*dt; p.life-=dt*1.4; } this.stream=this.stream.filter(p=>p.life>0 && p.y>topY); }
}

export default {
  id:"quad", name:"Quad Press", emoji:"💪", exercise:"Quad Isometrics", camera:"Sagittal (side-on)",
  howto:"Sit or lie side-on. <b>Straighten your knee fully</b> (toward 180°) to press the roller into the green zone and <b>hold steady</b> — then <b>relax (bend back)</b> before the next rep. Flexing does not charge.",
  calib:"extension", diffs:Object.keys(DIFFS),
  make(ctx){ return new QuadPress(ctx); },
};
