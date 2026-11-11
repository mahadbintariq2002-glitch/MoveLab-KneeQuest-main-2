// games/balance.js — Static Balance: Weight Shift & Double-Leg Stance → "Steady Scales".
// Patient stands FACING the camera, both feet planted on a firm floor. The camera reads
// where the pelvis (the standard centre-of-mass proxy in quiet standing) sits relative to
// the feet. That drives a balance scale: lean toward the left foot and the left pan sinks.
//
// One rep = a full cycle:  CENTRE (quiet double-leg stance) → LEFT (shift + hold) →
//                          CENTRE (return) → RIGHT (shift + hold).
// Both feet must stay down the whole time (lifting one = single-leg stance, flagged).
//
// Units: "shift" is in half-stance widths (0 = centred, ±1 = pelvis over a foot). For a
// quasi-static stance, load on the left leg ≈ 50% + shift/2 — a POSITION-based estimate of
// weight bearing, not a force reading (no force plate).
import { HoldDecay, Steady, starsFor } from "../rehab.js";

const DIFFS = {
  gentle:   { shiftT:0.35, band:0.12, centreTol:0.16, centreSecs:2,   reps:3 },   // ≈ 68% of weight on the target leg
  steady:   { shiftT:0.50, band:0.11, centreTol:0.13, centreSecs:2.5, reps:4 },   // ≈ 75%
  champion: { shiftT:0.65, band:0.10, centreTol:0.10, centreSecs:3,   reps:5 },   // ≈ 83%
};
const STAGES = ["centre","left","centre","right"];
const FOOT_LIFT = 0.09;      // ankle-height difference (÷ leg length, vs. calibrated) that means a foot has left the floor
const TRUNK_LEAN = 0.30;     // upper-body lean (≈17°) beyond calibrated upright → "shift with your hips" cue
const TILT_K = 0.55;         // radians of beam tilt per half-stance of shift
const ZONE = {centre:"#37e1ff", left:"#ffd166", right:"#ffd166"};

class SteadyScales {
  constructor(ctx){
    this.W=ctx.W; this.H=ctx.H; this.audio=ctx.audio; this.onEvent=ctx.onEvent||(()=>{});
    this.d = DIFFS[ctx.difficulty]||DIFFS.gentle;
    const ref = ctx.balRef || {};                       // patient's calibrated neutral stance
    this.s0 = ref.shift0||0; this.t0 = ref.trunk0||0; this.dy0 = ref.dyN0||0;
    this.holdSecs = ctx.holdSecs || 5;
    this.hold = new HoldDecay({holdSecs:this.d.centreSecs, decay:0.9});
    this.steady = new Steady(30, 0.18);
    this.score=0; this.qSum=0; this.qN=0; this.reps=0; this.repsTarget=ctx.repsTarget||this.d.reps;
    this.si=0; this.arrived=false; this.sv=0; this.svPrev=0; this.vel=0; this.t=0; this.glow=0; this.shake=0;
    this.trail=[]; this.parts=[]; this.pops=[]; this.done=false; this.result=null;
    this.tracked=false; this.stanceOk=true; this.feetDown=true; this.inZone=false; this.conf=0; this.fb={text:"",color:"#9aa6d4"};
  }
  resize(W,H){ this.W=W; this.H=H; }
  get stage(){ return STAGES[this.si]; }
  stageSecs(){ return this.stage==="centre" ? this.d.centreSecs : this.holdSecs; }
  zone(){ const d=this.d, st=this.stage;   // allowed range of shift for the current stage
    if(st==="centre") return [-d.centreTol, d.centreTol];
    if(st==="left")   return [d.shiftT-d.band, d.shiftT+d.band];
    return [-d.shiftT-d.band, -d.shiftT+d.band]; }

  update(dt, m, now){
    if(this.done){ this._step(dt); return; } this.t+=dt;
    const b = m && m.bal, tracked = !!(m && m.tracked && b && b.ok);
    this.tracked=tracked; this.conf=(m&&m.conf)||0;
    this.stanceOk = tracked && b.stanceOk;
    this.feetDown = tracked && Math.abs(b.dyN - this.dy0) <= FOOT_LIFT;
    let s=this.sv, trunk=0;
    if(tracked){ s = b.shift - this.s0; trunk = b.trunkLean - this.t0; }
    this.svPrev=this.sv; this.sv += (s-this.sv)*Math.min(1,dt*10); this.vel += (((this.sv-this.svPrev)/Math.max(dt,1e-3))-this.vel)*Math.min(1,dt*8);

    const ok = tracked && this.stanceOk && this.feetDown;
    const [lo,hi] = this.zone();
    const inZone = ok && s>=lo && s<=hi; this.inZone=inZone;
    if(inZone) this.steady.push(s); else this.steady.reset();   // sway is judged only while inside the target zone, not while moving into it
    const steadiness = inZone ? this.steady.value() : 0;
    const r = this.hold.update(inZone, dt, now/1000);
    if(inZone){ this.arrived=true; this.score += dt*10*(0.5+0.5*steadiness); this.qSum+=steadiness; this.qN++; }
    else if(this.arrived && tracked) this.qN++;    // drifted back out of the zone after reaching it = lost control (0 quality); the initial approach isn't penalised
    this.glow += ((inZone?1:0)-this.glow)*Math.min(1,dt*8);
    if(r.justRep){ this._stageDone(); if(this.done) return; }

    this.trail.push(this.sv); if(this.trail.length>40) this.trail.shift();
    this._feedback(tracked, ok, s, trunk, steadiness, b);
    this._step(dt);
  }
  _stageDone(){
    const st=this.stage; this.score+=25; this._sparkle(st==="right"?1:(st==="left"?-1:0)); this.audio&&this.audio.tap&&this.audio.tap();
    if(st==="right"){
      this.reps++; this.score+=60; this.pop("⚖️ Balanced!"); this.audio&&this.audio.reward&&this.audio.reward();
      this.onEvent({type:"rep",reps:this.reps});
      if(this.reps>=this.repsTarget){ this._finish(); return; }
    }
    this.si=(this.si+1)%STAGES.length; this.hold.configure({holdSecs:this.stageSecs()}); this.hold.reset(); this.steady.reset(); this.arrived=false;
  }
  _feedback(tracked, ok, s, trunk, steadiness, b){
    const st=this.stage, d=this.d, [lo,hi]=this.zone();
    if(!tracked){
      this.fb = !b ? {text:"📷 Stand facing the camera — head to toes in view",color:"#ffb84d"}
        : !b.bodyOk ? {text:"📷 Step back — show your whole body, head to feet",color:"#ffb84d"}
        : !b.frontOk ? {text:"↻ Face the camera",color:"#ff9ec7"}
        : {text:"🧍 Stand up — this game is done standing",color:"#ff9ec7"}; return; }
    if(!this.stanceOk){ this.fb={text:"↔ Feet shoulder-width apart please",color:"#ffb84d"}; return; }
    if(!this.feetDown){ this.fb={text:"⚠ Keep BOTH feet flat on the floor",color:"#ff6f6f"}; return; }
    if(st==="centre"){
      if(this.inZone) this.fb = steadiness>0.6 ? {text:"Even on both feet — hold steady ⚖️",color:"#8affc0"} : {text:"Hold still…",color:"#ffb84d"};
      else this.fb = s>0 ? {text:"Weight is on your left — move back to the middle",color:"#37e1ff"} : {text:"Weight is on your right — move back to the middle",color:"#37e1ff"};
      return; }
    const side = st==="left" ? "LEFT" : "RIGHT", arrow = st==="left" ? "←" : "→", sg = st==="left" ? 1 : -1, ss = s*sg;   // ss>0 = toward the target leg
    if(this.inZone){
      if(Math.abs(trunk)>TRUNK_LEAN) this.fb={text:"Shift with your hips — keep your upper body tall",color:"#ffb84d"};
      else this.fb = steadiness>0.6 ? {text:`Hold it — weight on your ${side.toLowerCase()} leg`,color:"#8affc0"} : {text:"Hold it steady…",color:"#ffb84d"};
    } else if(ss < Math.min(sg*lo, sg*hi)) this.fb={text:`Shift your weight onto your ${side} leg ${arrow}`,color:"#37e1ff"};
    else this.fb={text:"A little less — ease back toward the middle",color:"#ffb84d"};
  }
  _finish(){ this.done=true; const q=this.qN? this.qSum/this.qN : 0;
    this.result={ completed:true, stars:starsFor(q), score:Math.round(this.score), reps:this.reps, quality:+(q*100).toFixed(0) };
    this._sparkle(0); this._sparkle(1); this._sparkle(-1);
    this.onEvent({type:"end",...this.result}); }
  status(){ return { progress:this.hold.p, score:Math.round(this.score), reps:this.reps, repsTarget:this.repsTarget, feedback:this.fb, done:this.done, result:this.result }; }

  // ── render ──
  render(g, now){
    const W=this.W, H=this.H, cx=W*0.5, py=H*0.46, L=Math.min(W*0.30, H*0.27), chain=H*0.13, baseY=H*0.80;
    const st=this.stage, zc=ZONE[st], [lo,hi]=this.zone();
    // workshop backdrop
    const bg=g.createLinearGradient(0,0,0,H); bg.addColorStop(0,"#16222f"); bg.addColorStop(0.7,"#1b2a38"); bg.addColorStop(1,"#101820");
    g.fillStyle=bg; g.fillRect(0,0,W,H);
    const sp=g.createRadialGradient(cx,py,10,cx,py,Math.max(W,H)*0.55); sp.addColorStop(0,`rgba(255,226,160,${0.16+0.10*this.glow})`); sp.addColorStop(1,"rgba(255,226,160,0)");
    g.fillStyle=sp; g.fillRect(0,0,W,H);
    g.strokeStyle="#ffffff0d"; g.lineWidth=1; for(let x=(W%60)/2;x<W;x+=60){ g.beginPath(); g.moveTo(x,0); g.lineTo(x,baseY); g.stroke(); }
    // table / floor
    const fl=g.createLinearGradient(0,baseY,0,H); fl.addColorStop(0,"#3a2a1c"); fl.addColorStop(1,"#1d1510"); g.fillStyle=fl; g.fillRect(0,baseY,W,H-baseY);
    g.fillStyle="#5a4128"; g.fillRect(0,baseY,W,4);

    // beam geometry (screen-left end = the patient's LEFT side, as in a mirror)
    const ang = -Math.max(-0.5,Math.min(0.5,this.sv*TILT_K)), ca=Math.cos(ang), sa=Math.sin(ang);
    const eL={x:cx-L*ca, y:py-L*sa}, eR={x:cx+L*ca, y:py+L*sa};

    // target gates: where each beam end should sit for the current stage (arcs at both ends)
    const a1=-TILT_K*hi, a2=-TILT_K*lo, pulse=0.55+0.25*Math.sin(this.t*4);
    g.lineCap="round"; g.lineWidth=18; g.strokeStyle=this.inZone?"#8affc0":zc; g.globalAlpha=(this.inZone?0.55:0.32)*pulse+0.15;
    g.beginPath(); g.arc(cx,py,L,Math.min(a1,a2),Math.max(a1,a2)); g.stroke();
    g.beginPath(); g.arc(cx,py,L,Math.PI+Math.min(a1,a2),Math.PI+Math.max(a1,a2)); g.stroke(); g.globalAlpha=1;
    // ghost beam at the middle of the target range
    const ga=(a1+a2)/2; g.save(); g.translate(cx,py); g.rotate(ga); g.setLineDash([6,8]); g.strokeStyle="#ffffff66"; g.lineWidth=2; g.beginPath(); g.moveTo(-L,0); g.lineTo(L,0); g.stroke(); g.setLineDash([]); g.restore();

    // post + base
    const pg=g.createLinearGradient(cx-8,0,cx+8,0); pg.addColorStop(0,"#6e7b8a"); pg.addColorStop(0.5,"#b9c4d0"); pg.addColorStop(1,"#5b6775");
    g.fillStyle=pg; g.fillRect(cx-7,py,14,baseY-py);
    g.fillStyle="#46515e"; g.beginPath(); g.moveTo(cx-64,baseY); g.lineTo(cx-34,baseY-22); g.lineTo(cx+34,baseY-22); g.lineTo(cx+64,baseY); g.closePath(); g.fill();
    g.fillStyle="#2e3640"; g.fillRect(cx-70,baseY-4,140,8);

    // beam
    const bm=g.createLinearGradient(0,-8,0,8); bm.addColorStop(0,this.inZone?"#c9ffe3":"#f3d98a"); bm.addColorStop(1,this.inZone?"#4fd69a":"#b98a2e");
    g.save(); g.translate(cx,py); g.rotate(ang); g.fillStyle=bm; g.beginPath(); g.roundRect? g.roundRect(-L-8,-6,2*L+16,12,6) : g.rect(-L-8,-6,2*L+16,12); g.fill();
    g.strokeStyle="#3a2c10"; g.lineWidth=2; g.stroke(); g.restore();

    // pans hanging from the beam ends (they swing a touch with movement)
    const swing=Math.max(-0.3,Math.min(0.3,-this.vel*0.12));
    const coinsN=Math.floor(this.hold.p*8), coinsL = st==="left"?coinsN : st==="centre"?Math.ceil(coinsN/2):0, coinsR = st==="right"?coinsN : st==="centre"?Math.floor(coinsN/2):0;
    this._pan(g,eL,chain,swing,"L",coinsL); this._pan(g,eR,chain,swing,"R",coinsR);

    // pivot hub + hold ring
    g.fillStyle="#e9d9a8"; g.beginPath(); g.arc(cx,py,14,0,7); g.fill(); g.strokeStyle="#3a2c10"; g.lineWidth=3; g.stroke();
    g.beginPath(); g.arc(cx,py,24,-Math.PI/2,-Math.PI/2+this.hold.p*2*Math.PI); g.strokeStyle=this.inZone?"#8affc0":"#ffe08a"; g.lineWidth=6; g.lineCap="round"; g.stroke();

    // stage title + timer
    const title = st==="centre" ? "STAND TALL — WEIGHT EVEN" : st==="left" ? "SHIFT TO YOUR LEFT LEG  ←" : "SHIFT TO YOUR RIGHT LEG  →";
    const ty=Math.min(Math.max(H*0.235, 248), py-L*0.42-14);   // sits below the cue banner (which lives at the top for this game) but above the beam
    g.textAlign="center"; g.font=`900 ${Math.max(15,Math.min(22,W*0.05))}px sans-serif`; g.fillStyle=this.inZone?"#8affc0":"#eef2ff"; g.fillText(title, cx, ty);
    g.font="bold 14px sans-serif"; g.fillStyle="#9aa6d4"; g.fillText(`${(this.hold.p*this.stageSecs()).toFixed(1)}s / ${this.stageSecs()}s`, cx, ty+22);

    this._weightBar(g, W, H, lo, hi, zc);

    // rep coins
    { const pw=Math.min(28,(W*0.85)/this.repsTarget);
      for(let i=0;i<this.repsTarget;i++){ const lx=cx-(this.repsTarget-1)*pw/2+i*pw, ly=H*0.972, lit=i<this.reps;
        g.beginPath(); g.arc(lx,ly,pw*0.3,0,7); g.fillStyle=lit?"#ffd166":"#2a3340"; g.fill(); g.strokeStyle=lit?"#8a5a10":"#46515e"; g.lineWidth=2; g.stroke(); } }

    for(const p of this.parts){ g.globalAlpha=Math.max(0,p.life); g.fillStyle=p.c; g.beginPath(); g.arc(p.x,p.y,3,0,7); g.fill(); } g.globalAlpha=1;
    for(const p of this.pops){ g.globalAlpha=Math.max(0,p.life); g.fillStyle="#ffe08a"; g.font="900 22px sans-serif"; g.textAlign="center"; g.fillText(p.t,p.x,p.y); } g.globalAlpha=1;
  }
  _pan(g, end, chain, swing, label, coins){
    const px=end.x+Math.sin(swing)*chain, py=end.y+Math.cos(swing)*chain, pw=Math.min(this.W,this.H)*0.15;
    g.strokeStyle="#c9b27a"; g.lineWidth=2; g.beginPath(); g.moveTo(end.x,end.y); g.lineTo(px-pw/2,py); g.moveTo(end.x,end.y); g.lineTo(px+pw/2,py); g.stroke();
    const bowl=g.createLinearGradient(0,py,0,py+pw*0.3); bowl.addColorStop(0,"#e8c76a"); bowl.addColorStop(1,"#9a6f1c");
    g.fillStyle=bowl; g.beginPath(); g.ellipse(px,py,pw/2,pw*0.3,0,0,Math.PI); g.closePath(); g.fill(); g.strokeStyle="#5a3f0a"; g.lineWidth=2; g.stroke();
    g.fillStyle="#f7e3a1"; g.beginPath(); g.ellipse(px,py,pw/2,6,0,0,7); g.fill(); g.stroke();
    for(let i=0;i<coins;i++){ const cx2=px+((i%4)-1.5)*10, cy2=py-3-Math.floor(i/4)*5; g.fillStyle="#ffd166"; g.beginPath(); g.ellipse(cx2,cy2,6,3,0,0,7); g.fill(); g.strokeStyle="#8a5a10"; g.lineWidth=1; g.stroke(); }
    g.fillStyle="#3a2c10"; g.font="900 16px sans-serif"; g.textAlign="center"; g.fillText(label, px, py+pw*0.2);
  }
  // horizontal "weight meter": left foot ◄─ ● ─► right foot, zones + a short sway trail
  _weightBar(g, W, H, lo, hi, zc){
    const cx=W*0.5, y=H*0.895, half=Math.min(W*0.36, 330), xOf=sv=>cx-Math.max(-1.1,Math.min(1.1,sv))*half/1.1;
    g.fillStyle="#26303c"; g.beginPath(); g.roundRect? g.roundRect(cx-half-14,y-10,2*half+28,20,10) : g.rect(cx-half-14,y-10,2*half+28,20); g.fill();
    const za=xOf(hi), zb=xOf(lo); g.globalAlpha=0.35+0.25*(0.5+0.5*Math.sin(this.t*4)); g.fillStyle=this.inZone?"#8affc0":zc; g.fillRect(Math.min(za,zb),y-10,Math.abs(zb-za),20); g.globalAlpha=1;
    g.strokeStyle="#ffffff44"; g.lineWidth=1; g.beginPath(); g.moveTo(cx,y-14); g.lineTo(cx,y+14); g.stroke();
    for(let i=0;i<this.trail.length;i++){ g.globalAlpha=(i/this.trail.length)*0.5; g.fillStyle="#ffe08a"; g.beginPath(); g.arc(xOf(this.trail[i]),y,3,0,7); g.fill(); } g.globalAlpha=1;
    const mx=xOf(this.sv); g.fillStyle=this.inZone?"#8affc0":"#ffe08a"; g.beginPath(); g.arc(mx,y,11,0,7); g.fill(); g.strokeStyle="#1a1f27"; g.lineWidth=3; g.stroke();
    g.fillStyle="#dfe6ff"; g.font="bold 13px sans-serif"; g.textAlign="center"; g.fillText("LEFT FOOT", cx-half-6, y+30); g.fillText("RIGHT FOOT", cx+half+6, y+30);
    const wl=Math.round(100*Math.max(0,Math.min(1,0.5+0.5*this.sv)));
    g.font="900 20px sans-serif"; g.fillStyle=this.tracked?"#eef2ff":"#7a86ad";
    g.fillText(this.tracked?`≈ L ${wl}%  ·  R ${100-wl}%`:"— no body tracked —", cx, y-26);
    g.font="11px sans-serif"; g.fillStyle="#9aa6d4"; g.fillText(`estimated from pelvis position · confidence ${Math.round(this.conf*100)}%`, cx, y-44);
  }
  _sparkle(dir){ const cx=this.W*0.5+dir*Math.min(this.W*0.3,this.H*0.27)*0.9, cy=this.H*0.58;
    for(let i=0;i<22;i++){ const a=Math.random()*7, sp=Math.random()*4+1; this.parts.push({x:cx,y:cy,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-1.5,life:1,c:Math.random()<0.5?"#ffe08a":"#8affc0"}); } }
  pop(t){ this.pops.push({x:this.W*0.5,y:this.H*0.34,t,life:1}); }
  _step(dt){ for(const p of this.parts){ p.x+=p.vx; p.y+=p.vy; p.vy+=0.12; p.life-=dt*1.4; } this.parts=this.parts.filter(p=>p.life>0);
    for(const p of this.pops){ p.y-=26*dt; p.life-=dt*1.0; } this.pops=this.pops.filter(p=>p.life>0); }
}

export default {
  id:"bal", name:"Steady Scales", emoji:"⚖️", exercise:"Static Balance — Weight Shift & Double-Leg Stance", camera:"Front-on (face the camera), standing",
  group:"Static Balance · Closed Chain",
  howto:"Stand <b>facing the camera</b>, feet shoulder-width apart on a <b>firm, flat floor</b> — keep a counter or sturdy chair within reach. Hold the scale <b>level</b>, then <b>shift your weight</b> onto your left leg and hold, return to the middle, then the right. Both feet stay flat.",
  view:"front", calib:"balance", diffs:Object.keys(DIFFS), hudFeedbackTop:true,
  // mouse-preview: pointer left/right → weight on the left/right leg (as in a mirror)
  mouseMetrics(p, px){ const x=px==null?0.5:px, sv=Math.max(-1,Math.min(1,(0.5-x)*2.4));
    return { tracked:true, conf:1, bal:{ ok:true, bodyOk:true, frontOk:true, standingOk:true, stanceOk:true, shift:sv, trunkLean:0, dyN:0 } }; },
  make(ctx){ return new SteadyScales(ctx); },
};
