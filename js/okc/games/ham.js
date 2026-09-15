// games/ham.js — OKC Game 6: Hamstring Curl → "Reel It In".
// A fishing reel: from a straight-leg start, CURL the heel toward the buttocks
// against resistance on a timed count (the hamstring's concentric work), hold the
// curl briefly, then let the leg back out to straight under control (the
// hamstring's eccentric work) on a slower timed count. Structurally this is Tempo
// Lift's proven paced state machine, mirrored: the "work" phase here is FLEXION
// (curling in) instead of extension, which is what makes it an accurate hamstring
// exercise rather than a repeat of the quad-focused games.
import { starsFor } from "../rehab.js";

// flexTarget = degrees of flexion (from extRef) the curl must reach.
// curlSecs/releaseSecs = prescribed seconds for the curl-in / let-out. band = allowed
// fractional drift (0..1 of the ROM) from the ideal pace before it's flagged off-tempo.
// Timings match Tempo Lift's — same KOA grade 2-3 population, same moderate pacing.
const DIFFS = {
  gentle:   { flexTarget:45, curlSecs:4.5, holdSecs:1.5, releaseSecs:4.5, band:0.28, reps:3 },
  steady:   { flexTarget:60, curlSecs:4,   holdSecs:1.5, releaseSecs:5,   band:0.22, reps:4 },
  champion: { flexTarget:75, curlSecs:3.5, holdSecs:2,   releaseSecs:6,   band:0.16, reps:5 },
};

class ReelIn {
  constructor(ctx){
    this.W=ctx.W; this.H=ctx.H; this.audio=ctx.audio; this.onEvent=ctx.onEvent||(()=>{});
    this.d = DIFFS[ctx.difficulty]||DIFFS.gentle;
    this.extRef = ctx.extRef || 178;                 // patient's calibrated full-extension angle (0° reference) — the straight start
    this.targetAngle = this.extRef - this.d.flexTarget;  // fully-curled position
    const pace = ctx.paceMult || 1;                  // >1 = slower ghost, <1 = faster
    this.curlSecs=this.d.curlSecs*pace; this.holdSecs=this.d.holdSecs*pace; this.releaseSecs=this.d.releaseSecs*pace; this.band=this.d.band;
    this.score=0; this.qSum=0; this.qN=0; this.reps=0; this.repsTarget=ctx.repsTarget||this.d.reps;
    this.phase="start"; this.phaseT=0; this.curlSum=0; this.curlN=0; this.relSum=0; this.relN=0;
    this.pos=0; this.idealPos=0; this.inBand=true; this.t=0; this.reelRot=0;
    this.ripple=0; this.parts=[]; this.pops=[]; this.done=false; this.result=null;
    this.angle=null; this.angleDisp=null; this.conf=0; this.fb={text:"",color:"#9aa6d4"};
  }
  resize(W,H){ this.W=W; this.H=H; }

  update(dt, m, now){
    if(this.done) return; this.t+=dt;
    const angle=m.kneeAngle, tracked=m.tracked && angle!=null;
    this.angle=tracked?angle:null; this.conf=m.conf||0;
    this.angleDisp = tracked ? (m.kneeAngleDisp!=null?m.kneeAngleDisp:angle) : null;
    // pos: 0 = straight (start) .. 1 = fully curled (targetAngle)
    if(tracked) this.pos = Math.max(0,Math.min(1,(this.extRef-angle)/(this.extRef-this.targetAngle)));

    if(this.phase==="start"){
      this.idealPos=0;
      if(tracked && this.pos<=0.08){ this.phase="curl"; this.phaseT=0; this.curlSum=0; this.curlN=0; }
    } else if(this.phase==="curl"){
      this.phaseT+=dt; this.idealPos=Math.min(1,this.phaseT/this.curlSecs);
      if(tracked){ this.inBand=Math.abs(this.pos-this.idealPos)<=this.band; this.curlSum+=this.inBand?1:0; this.curlN++; }
      this.reelRot += dt*3;
      if(tracked && this.pos>=0.95){ this.phase="hold"; this.phaseT=0; }
    } else if(this.phase==="hold"){
      this.phaseT+=dt; this.idealPos=1;
      this.inBand = tracked && this.pos>=0.95-this.band;
      if(!this.inBand) this.phaseT=Math.max(0,this.phaseT-dt*1.5);
      if(this.phaseT>=this.holdSecs){ this.phase="release"; this.phaseT=0; this.relSum=0; this.relN=0; }
    } else { // "release"
      this.phaseT+=dt; this.idealPos=Math.max(0,1-this.phaseT/this.releaseSecs);
      if(tracked){ this.inBand=Math.abs(this.pos-this.idealPos)<=this.band; this.relSum+=this.inBand?1:0; this.relN++; }
      this.reelRot -= dt*1.5;
      if(tracked && this.pos<=0.05){
        const curlQ=this.curlN?this.curlSum/this.curlN:0, relQ=this.relN?this.relSum/this.relN:0, q=(curlQ+relQ)/2;
        this.qSum+=q; this.qN++; this.reps++; this.score+=Math.round(60+40*q);
        this._catch(); this.pop(q>=0.75?"🐟 Caught!":"+rep"); this.audio&&this.audio.reward();
        this.onEvent({type:"rep",reps:this.reps});
        if(this.reps>=this.repsTarget){ this._finish(); return; }
        this.phase="start"; this.phaseT=0;
      }
    }

    if(!tracked) this.fb={text:"📷 Show your whole leg to the camera",color:"#ffb84d"};
    else if(this.phase==="start") this.fb={text:"Start with your leg straight — curl when ready",color:"#9aa6d4"};
    else if(this.phase==="curl") this.fb = (this.pos<this.idealPos-this.band) ? {text:"🐢 Curl in a little faster",color:"#ffb84d"}
      : (this.pos>this.idealPos+this.band) ? {text:"⚡ Ease off — slow the reel",color:"#ffb84d"} : {text:"Reeling it in — nice pace →",color:"#8affc0"};
    else if(this.phase==="hold") this.fb = this.inBand? {text:"Hold the curl…",color:"#8affc0"} : {text:"Stay curled at the top!",color:"#ff9ec7"};
    else this.fb = (this.pos>this.idealPos+this.band) ? {text:"🐢 Let the line out faster",color:"#ffb84d"}
      : (this.pos<this.idealPos-this.band) ? {text:"⚡ Ease off — control the release",color:"#ffb84d"} : {text:"Smooth and controlled ↓",color:"#8affc0"};

    this._step(dt);
  }
  _finish(){ this.done=true; const q=this.qN? this.qSum/this.qN : 0;
    this.result={ completed:true, stars:starsFor(q), score:Math.round(this.score), reps:this.reps, quality:+(q*100).toFixed(0) };
    this.onEvent({type:"end",...this.result}); }
  status(){ let progress=0;
    if(this.phase==="curl") progress=Math.min(1,this.phaseT/this.curlSecs);
    else if(this.phase==="hold") progress=Math.min(1,this.phaseT/this.holdSecs);
    else if(this.phase==="release") progress=Math.min(1,this.phaseT/this.releaseSecs);
    return { progress, score:Math.round(this.score), reps:this.reps, repsTarget:this.repsTarget, feedback:this.fb, done:this.done, result:this.result }; }

  // ── render: a fishing line from a rod tip (upper-left) out to open water; a
  // ghost float shows the prescribed pace, the patient's own float/fish must track
  // it as the reel — spun by their curl — draws it in. ──
  render(g, now){
    const W=this.W,H=this.H, waterY=H*0.62, rodX=W*0.1, rodY=H*0.28, farX=W*0.86;
    const skyg=g.createLinearGradient(0,0,0,waterY); skyg.addColorStop(0,"#1b2a44"); skyg.addColorStop(1,"#2e4a63");
    g.fillStyle=skyg; g.fillRect(0,0,W,waterY);
    const sunX=W*0.78,sunY=H*0.14,sunR=Math.min(W,H)*0.045; const sg=g.createRadialGradient(sunX,sunY,2,sunX,sunY,sunR*3);
    sg.addColorStop(0,"rgba(255,224,138,0.5)"); sg.addColorStop(1,"rgba(255,224,138,0)"); g.fillStyle=sg; g.beginPath(); g.arc(sunX,sunY,sunR*3,0,7); g.fill();
    g.fillStyle="#ffe9b0"; g.beginPath(); g.arc(sunX,sunY,sunR,0,7); g.fill();

    const waterg=g.createLinearGradient(0,waterY,0,H); waterg.addColorStop(0,"#1d4a63"); waterg.addColorStop(1,"#0d2635");
    g.fillStyle=waterg; g.fillRect(0,waterY,W,H-waterY);
    this.ripple+=0.02; g.strokeStyle="#ffffff22"; g.lineWidth=1.5;
    for(let i=0;i<5;i++){ const ry=waterY+18+i*((H-waterY-18)/5); g.beginPath();
      for(let x=0;x<=W;x+=14){ const y=ry+Math.sin(x*0.04+this.ripple*2+i)*3; if(x===0)g.moveTo(x,y); else g.lineTo(x,y); } g.stroke(); }

    // rod + reel
    g.strokeStyle="#6b4a2a"; g.lineWidth=6; g.lineCap="round"; g.beginPath(); g.moveTo(rodX-30,rodY+70); g.lineTo(rodX,rodY); g.stroke();
    this._reel(g, rodX-14, rodY+52, 18, this.reelRot);

    // line from rod tip to the float, and the taut water-level segment out to the far anchor
    const fx = rodX + this.pos*(farX-rodX), fy = waterY+14;
    g.strokeStyle="#dfe6ff99"; g.lineWidth=1.5; g.beginPath(); g.moveTo(rodX,rodY); g.lineTo(fx,fy); g.stroke();
    g.strokeStyle="#dfe6ff44"; g.setLineDash([4,5]); g.beginPath(); g.moveTo(fx,fy); g.lineTo(farX,fy); g.stroke(); g.setLineDash([]);

    // ghost float (prescribed pace)
    const gx = rodX + this.idealPos*(farX-rodX), pulse=(Math.sin(this.t*4)+1)/2;
    g.globalAlpha=0.5+0.15*pulse; g.fillStyle="#dfe6ff"; g.beginPath(); g.arc(gx,fy,12,0,7); g.fill(); g.globalAlpha=1;
    g.strokeStyle="#ffffff77"; g.lineWidth=2; g.setLineDash([3,4]); g.beginPath(); g.arc(gx,fy,12,0,7); g.stroke(); g.setLineDash([]);

    // the fish/float the patient is actually reeling
    const col = this.phase==="start" ? "#9aa6d4" : (this.inBand ? "#8affc0" : "#ffb84d");
    if(this.phase!=="start"){ const gg=g.createRadialGradient(fx,fy,4,fx,fy,50); gg.addColorStop(0,`${col}55`); gg.addColorStop(1,`${col}00`); g.fillStyle=gg; g.beginPath(); g.arc(fx,fy,50,0,7); g.fill(); }
    this._fish(g, fx, fy, col, now);
    if(this.phase!=="start" && !this.inBand){ const behind=(this.phase==="release") ? (this.pos>this.idealPos) : (this.pos<this.idealPos);
      g.fillStyle="#ffb84d"; g.font="bold 18px sans-serif"; g.textAlign="center"; g.fillText(behind?"▲ faster":"▼ ease off", fx, fy-34); }

    g.fillStyle="#cfe0ee"; g.font="bold 12px sans-serif"; g.textAlign="left"; g.fillText("STRAIGHT", farX-6, fy+26);
    g.textAlign="right"; g.fillText("CURLED", rodX+30, fy+26);

    const label = this.phase==="start" ? "READY" : this.phase==="curl" ? "CURL IN ↩" : this.phase==="hold" ? "HOLD" : "LET OUT ↪";
    const target = this.phase==="curl" ? this.curlSecs : this.phase==="hold" ? this.holdSecs : this.phase==="release" ? this.releaseSecs : null;
    g.textAlign="left"; g.font="900 26px sans-serif"; g.fillStyle="#eef2ff"; g.fillText(label, 20, H*0.11);
    if(target!=null){ g.font="bold 14px sans-serif"; g.fillStyle="#cfe0ee"; g.fillText(`${Math.min(this.phaseT,target).toFixed(1)}s / ${target}s`, 20, H*0.11+22); }
    g.font="11px sans-serif"; g.fillStyle="#cfe0ee"; g.textAlign="right"; g.fillText(`confidence ${Math.round(this.conf*100)}%`, W-20, H*0.11);

    { const pw=Math.min(30,(W*0.85)/this.repsTarget);
      for(let i=0;i<this.repsTarget;i++){ const lx=W*0.5-(this.repsTarget-1)*pw/2+i*pw, ly=H*0.965;
        g.font=Math.max(12,pw*0.62)+"px sans-serif"; g.textAlign="center"; g.fillStyle= i<this.reps?"#ffe08a":"#ffffff44";
        g.fillText(i<this.reps?"🐟":"○", lx, ly); } }

    for(const p of this.parts){ g.globalAlpha=Math.max(0,p.life); g.fillStyle=p.c; g.beginPath(); g.arc(p.x,p.y,3,0,7); g.fill(); } g.globalAlpha=1;
    for(const p of this.pops){ g.globalAlpha=Math.max(0,p.life); g.fillStyle="#ffe08a"; g.font="900 20px sans-serif"; g.textAlign="center"; g.fillText(p.t,p.x,p.y); } g.globalAlpha=1;
  }
  _reel(g,x,y,r,rot){ g.save(); g.translate(x,y); g.rotate(rot); g.fillStyle="#8a94b8";
    for(let i=0;i<6;i++){ g.save(); g.rotate(i*Math.PI/3); g.fillRect(-1.5,-r-4,3,7); g.restore(); }
    g.beginPath(); g.arc(0,0,r,0,7); g.fill(); g.fillStyle="#1c2333"; g.beginPath(); g.arc(0,0,r*0.4,0,7); g.fill(); g.restore(); }
  _fish(g,x,y,col,now){ const wag=Math.sin(now/120)*0.35;
    g.save(); g.translate(x,y); g.fillStyle=col;
    g.beginPath(); g.ellipse(0,0,16,9,0,0,7); g.fill();
    g.save(); g.rotate(wag); g.beginPath(); g.moveTo(-14,0); g.lineTo(-26,-9); g.lineTo(-26,9); g.closePath(); g.fill(); g.restore();
    g.fillStyle="#0d2635"; g.beginPath(); g.arc(8,-1,2,0,7); g.fill();
    g.restore(); }
  _catch(){ const x=this.W*0.1+this.pos*(this.W*0.86-this.W*0.1), y=this.H*0.62+14;
    for(let i=0;i<20;i++){ const a=Math.random()*7,s=Math.random()*5+1; this.parts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-2,life:1,c:Math.random()<0.5?"#dfe6ff":"#8affc0"}); } }
  pop(t){ this.pops.push({x:this.W*0.5,y:this.H*0.35,t,life:1}); }
  _step(dt){ for(const p of this.parts){ p.x+=p.vx; p.y+=p.vy; p.vy+=0.15; p.life-=dt*1.5; } this.parts=this.parts.filter(p=>p.life>0);
    for(const p of this.pops){ p.y-=26*dt; p.life-=dt*1.1; } this.pops=this.pops.filter(p=>p.life>0); }
}

export default {
  id:"ham", name:"Reel It In", emoji:"🎣", exercise:"Hamstring Curl", camera:"Sagittal (side-on)",
  howto:"Lie face-down or stand with resistance on your ankle. Start with your leg <b>straight</b>, <b>curl your heel in</b> on the beat, <b>hold</b> briefly, then <b>let it back out slowly</b> — track the ghost float's pace.",
  calib:"extension", usesHold:false, usesPace:true, diffs:Object.keys(DIFFS),
  // mouse-preview: pointer height → knee angle over a generous flexion arc
  mouseMetrics(p){ const angle=178-p*90; return { tracked:true, conf:1, flex:178-angle, kneeFlex:178-angle, kneeAngle:angle, kneeAngleDisp:angle, hipAngle:150, ankle:{x:.5,y:p}, side:"L" }; },
  make(ctx){ return new ReelIn(ctx); },
};
