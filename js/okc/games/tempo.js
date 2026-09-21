// games/tempo.js — OKC Game 5: Resisted Knee Extension → "Tempo Lift".
// A weight-stack cable machine: from a bent start, extend against resistance on a
// TIMED concentric count, hold briefly locked out, then lower under control on a
// (usually longer) TIMED eccentric count. Unlike the other games — which gate on
// POSITION alone — this one is paced: a ghost pin moves at the prescribed tempo and
// the patient's own pin must track it, rewarding controlled speed, not just range,
// which is the actual clinical point of a tempo protocol (no momentum, real time
// under tension, eccentric control).
import { HoldDecay, starsFor } from "../rehab.js";

// flexOff = the bent starting depth (degrees of flexion from extRef).
// upSecs/downSecs = prescribed seconds for the lift / lower. band = allowed
// fractional drift (0..1 of the ROM) from the ideal pace before it's flagged off-tempo.
// Kept moderate throughout — this app's population includes KOA grade 2-3 patients,
// who need a shallower start and a slower, more forgiving pace than a general
// strengthening protocol would use.
const DIFFS = {
  gentle:   { flexOff:45, upSecs:4.5, holdSecs:1.5, downSecs:4.5, band:0.28, reps:3 },
  steady:   { flexOff:60, upSecs:4,   holdSecs:1.5, downSecs:5,   band:0.22, reps:4 },
  champion: { flexOff:75, upSecs:3.5, holdSecs:2,   downSecs:6,   band:0.16, reps:5 },
};

class TempoLift {
  constructor(ctx){
    this.W=ctx.W; this.H=ctx.H; this.audio=ctx.audio; this.onEvent=ctx.onEvent||(()=>{});
    this.d = DIFFS[ctx.difficulty]||DIFFS.gentle;
    this.extRef = ctx.extRef || 178;                    // patient's calibrated full-extension angle (0° reference)
    this.startAngle = this.extRef - this.d.flexOff;      // bent starting position
    this.ghost = ctx.ghost !== false;                     // false = free-pace mode: no ghost, no pace scoring
    const pace = ctx.paceMult || 1;                       // >1 = slower ghost dot, <1 = faster
    this.upSecs=this.d.upSecs*pace; this.holdSecs=this.d.holdSecs*pace; this.downSecs=this.d.downSecs*pace; this.band=this.d.band;
    this.score=0; this.qSum=0; this.qN=0; this.reps=0; this.repsTarget=ctx.repsTarget||this.d.reps;
    this.phase="start"; this.phaseT=0; this.upSum=0; this.upN=0; this.downSum=0; this.downN=0;
    this.pos=0; this.idealPos=0; this.inBand=true; this.t=0; this.gearRot=0;
    this.parts=[]; this.pops=[]; this.done=false; this.result=null;
    this.angle=null; this.angleDisp=null; this.conf=0; this.fb={text:"",color:"#9aa6d4"};
  }
  resize(W,H){ this.W=W; this.H=H; }

  update(dt, m, now){
    if(this.done) return; this.t+=dt; this.gearRot+=dt*0.6;
    const angle=m.kneeAngle, tracked=m.tracked && angle!=null;
    this.angle=tracked?angle:null; this.conf=m.conf||0;
    this.angleDisp = tracked ? (m.kneeAngleDisp!=null?m.kneeAngleDisp:angle) : null;
    if(tracked) this.pos = Math.max(0,Math.min(1,(angle-this.startAngle)/(this.extRef-this.startAngle)));

    if(this.phase==="start"){
      this.idealPos=0;
      if(tracked && this.pos<=0.08){ this.phase="up"; this.phaseT=0; this.upSum=0; this.upN=0; }
    } else if(this.phase==="up"){
      this.phaseT+=dt; this.idealPos=Math.min(1,this.phaseT/this.upSecs);
      if(tracked){ this.inBand=!this.ghost || Math.abs(this.pos-this.idealPos)<=this.band; this.upSum+=this.inBand?1:0; this.upN++; }
      if(tracked && this.pos>=0.95){ this.phase="hold"; this.phaseT=0; }
    } else if(this.phase==="hold"){
      this.phaseT+=dt; this.idealPos=1;
      this.inBand = tracked && this.pos>=0.95-this.band;
      if(!this.inBand) this.phaseT=Math.max(0,this.phaseT-dt*1.5);   // slipping off lock eats into the hold
      if(this.phaseT>=this.holdSecs){ this.phase="down"; this.phaseT=0; this.downSum=0; this.downN=0; }
    } else { // "down"
      this.phaseT+=dt; this.idealPos=Math.max(0,1-this.phaseT/this.downSecs);
      if(tracked){ this.inBand=!this.ghost || Math.abs(this.pos-this.idealPos)<=this.band; this.downSum+=this.inBand?1:0; this.downN++; }
      if(tracked && this.pos<=0.05){
        const upQ=this.upN?this.upSum/this.upN:0, downQ=this.downN?this.downSum/this.downN:0, q=(upQ+downQ)/2;
        this.qSum+=q; this.qN++; this.reps++; this.score+=Math.round(60+40*q);
        this._burst(); this.pop(q>=0.75?"🎯 On tempo!":"+rep"); this.audio&&this.audio.reward();
        this.onEvent({type:"rep",reps:this.reps});
        if(this.reps>=this.repsTarget){ this._finish(); return; }
        this.phase="start"; this.phaseT=0;
      }
    }

    if(!tracked) this.fb={text:"📷 Show your whole leg to the camera",color:"#ffb84d"};
    else if(this.phase==="start") this.fb={text:"Start bent — extend when ready",color:"#9aa6d4"};
    else if(!this.ghost && this.phase==="up") this.fb={text:"Extend at your own pace →",color:"#8affc0"};
    else if(!this.ghost && this.phase==="down") this.fb={text:"Lower slowly and under control ↓",color:"#8affc0"};
    else if(this.phase==="up") this.fb = (this.pos<this.idealPos-this.band) ? {text:"🐢 Push a little faster",color:"#ffb84d"}
      : (this.pos>this.idealPos+this.band) ? {text:"⚡ Ease off — slow down",color:"#ffb84d"} : {text:"On pace — keep extending →",color:"#8affc0"};
    else if(this.phase==="hold") this.fb = this.inBand? {text:"Hold the lock…",color:"#8affc0"} : {text:"Stay locked out at the top!",color:"#ff9ec7"};
    else this.fb = (this.pos>this.idealPos+this.band) ? {text:"🐢 Lower a little faster",color:"#ffb84d"}
      : (this.pos<this.idealPos-this.band) ? {text:"⚡ Ease off — control the drop",color:"#ffb84d"} : {text:"Smooth and controlled ↓",color:"#8affc0"};

    this._step(dt);
  }
  _finish(){ this.done=true; const q=this.qN? this.qSum/this.qN : 0;
    this.result={ completed:true, stars:starsFor(q), score:Math.round(this.score), reps:this.reps, quality:+(q*100).toFixed(0) };
    this.onEvent({type:"end",...this.result}); }
  status(){ let progress=0;
    if(!this.ghost && this.phase==="up") progress=this.pos;
    else if(!this.ghost && this.phase==="down") progress=1-this.pos;
    else if(this.phase==="up") progress=Math.min(1,this.phaseT/this.upSecs);
    else if(this.phase==="hold") progress=Math.min(1,this.phaseT/this.holdSecs);
    else if(this.phase==="down") progress=Math.min(1,this.phaseT/this.downSecs);
    return { progress, score:Math.round(this.score), reps:this.reps, repsTarget:this.repsTarget, feedback:this.fb, done:this.done, result:this.result }; }

  // ── render: a cable weight-stack machine. A translucent ghost pin travels the
  // rail at the prescribed tempo; the patient's own pin must track it — green when
  // on pace, amber with a direction arrow when drifting ahead or behind. ──
  render(g, now){
    const W=this.W,H=this.H, tx=W*0.5, topY=H*0.2, botY=H*0.82, trackH=botY-topY;
    const bgg=g.createLinearGradient(0,0,0,H); bgg.addColorStop(0,"#181c2a"); bgg.addColorStop(1,"#0b0d14");
    g.fillStyle=bgg; g.fillRect(0,0,W,H);
    if(this.inBand && this.phase!=="start"){ const ag=g.createRadialGradient(tx,H*0.5,10,tx,H*0.5,Math.max(W,H)*0.55);
      ag.addColorStop(0,"rgba(138,255,192,0.10)"); ag.addColorStop(1,"rgba(138,255,192,0)"); g.fillStyle=ag; g.fillRect(0,0,W,H); }

    // pulley + frame
    g.strokeStyle="#3a4560"; g.lineWidth=6; g.beginPath(); g.moveTo(tx,topY-40); g.lineTo(tx,botY+56); g.stroke();
    this._gear(g, tx, topY-40, 22, this.gearRot);

    // rail
    g.strokeStyle="#2c3450"; g.lineWidth=14; g.lineCap="round"; g.beginPath(); g.moveTo(tx,topY); g.lineTo(tx,botY); g.stroke();
    g.strokeStyle="#181c2a"; g.lineWidth=7; g.beginPath(); g.moveTo(tx,topY); g.lineTo(tx,botY); g.stroke();

    // cable from pulley down to the patient's pin, and the slack cable to the ankle anchor at the bottom
    const wy = botY - this.pos*trackH;
    g.strokeStyle="#8a94b8"; g.lineWidth=2; g.beginPath(); g.moveTo(tx,topY-40); g.lineTo(tx,wy); g.stroke();
    this._spring(g, tx, botY+56, tx, wy+14, 7, Math.max(6,(wy-(botY+56))/-18));

    // ghost pacer pin (the prescribed tempo)
    const gyPos = botY - this.idealPos*trackH, pulse=(Math.sin(this.t*4)+1)/2;
    if(this.ghost){
      g.globalAlpha=0.5+0.15*pulse; g.fillStyle="#dfe6ff"; g.beginPath(); g.arc(tx,gyPos,15,0,7); g.fill(); g.globalAlpha=1;
      g.strokeStyle="#ffffff77"; g.lineWidth=2; g.setLineDash([3,4]); g.beginPath(); g.arc(tx,gyPos,15,0,7); g.stroke(); g.setLineDash([]);
    }

    // weight-stack pin (patient's actual position)
    const col = this.phase==="start" ? "#9aa6d4" : (this.inBand ? "#8affc0" : "#ffb84d");
    if(this.phase!=="start"){ const gg=g.createRadialGradient(tx,wy,4,tx,wy,54); gg.addColorStop(0,`${col}66`); gg.addColorStop(1,`${col}00`); g.fillStyle=gg; g.beginPath(); g.arc(tx,wy,54,0,7); g.fill(); }
    g.fillStyle="#e7ecf5"; g.beginPath(); g.roundRect? g.roundRect(tx-30,wy-10,60,20,6) : g.rect(tx-30,wy-10,60,20); g.fill();
    g.strokeStyle=col; g.lineWidth=3; g.stroke();
    g.fillStyle=col; g.beginPath(); g.arc(tx,wy,7,0,7); g.fill();
    // off-pace direction arrow
    if(this.ghost && this.phase!=="start" && !this.inBand){ const behind=(this.phase==="down") ? (this.pos>this.idealPos) : (this.pos<this.idealPos);
      g.fillStyle="#ffb84d"; g.font="bold 20px sans-serif"; g.textAlign="center"; g.fillText(behind?"▲ faster":"▼ ease off", tx+50, wy+6); }

    // weight plates stacked below the pin, for gym flavor
    for(let i=0;i<3;i++){ g.fillStyle="#333d52"; g.fillRect(tx-22,wy+16+i*10,44,7); g.strokeStyle="#10141f"; g.strokeRect(tx-22,wy+16+i*10,44,7); }

    // start/lock zone markers
    g.fillStyle="#7a86ad"; g.font="bold 12px sans-serif"; g.textAlign="center";
    g.fillText("BENT START", tx, botY+18);
    g.fillText("LOCK OUT", tx, topY-10);

    // phase + tempo readout
    const label = this.phase==="start" ? "READY" : this.phase==="up" ? "EXTEND ↑" : this.phase==="hold" ? "HOLD" : "LOWER ↓";
    const target = this.phase==="up" ? this.upSecs : this.phase==="hold" ? this.holdSecs : this.phase==="down" ? this.downSecs : null;
    g.textAlign="left"; g.font="900 26px sans-serif"; g.fillStyle="#eef2ff"; g.fillText(label, 20, H*0.11);
    if(target!=null && (this.ghost || this.phase==="hold")){ g.font="bold 14px sans-serif"; g.fillStyle="#9aa6d4"; g.fillText(`${Math.min(this.phaseT,target).toFixed(1)}s / ${target}s`, 20, H*0.11+22); }
    g.font="11px sans-serif"; g.fillStyle="#9aa6d4"; g.textAlign="right"; g.fillText(`confidence ${Math.round(this.conf*100)}%`, W-20, H*0.11);

    { const pw=Math.min(30,(W*0.85)/this.repsTarget);
      for(let i=0;i<this.repsTarget;i++){ const lx=W*0.5-(this.repsTarget-1)*pw/2+i*pw, ly=H*0.965;
        g.font=Math.max(12,pw*0.62)+"px sans-serif"; g.textAlign="center"; g.fillStyle= i<this.reps?"#ffe08a":"#ffffff33";
        g.fillText(i<this.reps?"🏋️":"○", lx, ly); } }

    for(const p of this.parts){ g.globalAlpha=Math.max(0,p.life); g.fillStyle=p.c; g.beginPath(); g.arc(p.x,p.y,3,0,7); g.fill(); } g.globalAlpha=1;
    for(const p of this.pops){ g.globalAlpha=Math.max(0,p.life); g.fillStyle="#ffe08a"; g.font="900 20px sans-serif"; g.textAlign="center"; g.fillText(p.t,p.x,p.y); } g.globalAlpha=1;
  }
  _gear(g,x,y,r,rot){ g.save(); g.translate(x,y); g.rotate(rot); g.fillStyle="#4a5670";
    for(let i=0;i<8;i++){ g.save(); g.rotate(i*Math.PI/4); g.fillRect(-2,-r-6,4,9); g.restore(); }
    g.beginPath(); g.arc(0,0,r,0,7); g.fill(); g.fillStyle="#1c2333"; g.beginPath(); g.arc(0,0,r*0.42,0,7); g.fill(); g.restore(); }
  _spring(g,x0,y0,x1,y1,amp,segs){ segs=Math.max(4,Math.round(segs||8)); const dx=(x1-x0)/segs, dy=(y1-y0)/segs;
    g.strokeStyle="#5a6a90"; g.lineWidth=2; g.beginPath(); g.moveTo(x0,y0);
    for(let i=1;i<segs;i++){ const px=x0+dx*i+(i%2?amp:-amp), py=y0+dy*i; g.lineTo(px,py); }
    g.lineTo(x1,y1); g.stroke(); }
  _burst(){ const x=this.W*0.5, y=this.H*0.2; for(let i=0;i<20;i++){ const a=Math.random()*7,s=Math.random()*5+1; this.parts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:1,c:Math.random()<0.5?"#ffe08a":"#8affc0"}); } }
  pop(t){ this.pops.push({x:this.W*0.5,y:this.H*0.35,t,life:1}); }
  _step(dt){ for(const p of this.parts){ p.x+=p.vx; p.y+=p.vy; p.vy+=0.1; p.life-=dt*1.5; } this.parts=this.parts.filter(p=>p.life>0);
    for(const p of this.pops){ p.y-=26*dt; p.life-=dt*1.1; } this.pops=this.pops.filter(p=>p.life>0); }
}

export default {
  id:"tempo", name:"Tempo Lift", emoji:"⏱️", exercise:"Resisted Knee Extension", camera:"Sagittal (side-on)",
  howto:"Sit with resistance on your shin (band or ankle weight). Start <b>bent</b>, <b>extend on the beat</b> to lock out, <b>hold briefly</b>, then <b>lower under control</b> — match the ghost pin's pace, don't race it.",
  calib:"extension", usesHold:false, usesPace:true, usesGhostToggle:true, diffs:Object.keys(DIFFS),
  // mouse-preview: pointer height → knee angle over a generous arc near extension
  mouseMetrics(p){ const angle=178-p*90; return { tracked:true, conf:1, flex:178-angle, kneeFlex:178-angle, kneeAngle:angle, kneeAngleDisp:angle, hipAngle:150, ankle:{x:.5,y:p}, side:"L" }; },
  make(ctx){ return new TempoLift(ctx); },
};
