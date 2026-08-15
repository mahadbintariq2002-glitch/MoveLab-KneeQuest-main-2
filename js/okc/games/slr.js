// games/slr.js — OKC Game 2: Straight-Leg-Raise → "Lift-Off".
// Raise the STRAIGHT leg to float a balloon into the target altitude band and
// hold it there. A bent knee invalidates the hold (balloon wobbles). Lower to reset.
//
// Signals used (from the shared PoseController):
//   hipAngle   shoulder–hip–knee angle → leg elevation = baseline(rest) − hipAngle
//   kneeAngle  hip–knee–ankle (180=straight) → knee must stay > 180−kneeTol
import { HoldDecay, Steady, starsFor } from "../rehab.js";

const DIFFS = {
  gentle:   { target:18, band:12, reps:3, kneeTol:22, decay:0.6, low:8 },
  steady:   { target:26, band:10, reps:4, kneeTol:16, decay:0.9, low:8 },
  champion: { target:34, band:8,  reps:5, kneeTol:10, decay:1.2, low:8 },
};

class LiftOff {
  constructor(ctx){
    this.W=ctx.W; this.H=ctx.H; this.audio=ctx.audio; this.onEvent=ctx.onEvent||(()=>{});
    this.d = DIFFS[ctx.difficulty]||DIFFS.gentle;
    this.holdSecs = ctx.holdSecs || 6;
    this.maxElev = this.d.target + this.d.band + 18;
    this.hold=new HoldDecay({holdSecs:this.holdSecs, decay:this.d.decay});
    this.steady=new Steady(20, 6);
    this.score=0; this.qSum=0; this.qN=0; this.reps=0; this.repsTarget=this.d.reps;
    this.phase="raise";                      // "raise" (charge) | "lower" (bring leg down to arm next)
    this.baseline=null; this.elev=0; this.balloonY=0.15; this.glow=0; this.wobble=0; this.t=0; this.rot=0;
    this.clouds=Array.from({length:5},()=>({x:Math.random(),y:0.1+Math.random()*0.5,s:0.5+Math.random()*0.7}));
    this.parts=[]; this.pops=[]; this.done=false; this.result=null;
    this.kneeStraight=false; this.tracked=false; this.conf=0; this.fb={text:"",color:"#9aa6d4"};
  }
  resize(W,H){ this.W=W; this.H=H; }

  update(dt, m, now){
    if(this.done) return; this.t+=dt;
    const tracked = m.tracked && m.hipAngle!=null; this.tracked=tracked; this.conf=m.conf||0;
    // leg elevation = hip flexion (shoulder–hip–knee); ~0 lying flat, grows as the straight leg raises
    const elev = tracked ? Math.max(0, 180 - m.hipAngle) : 0; this.elev=elev;
    const kneeStraight = tracked && m.kneeAngle!=null && m.kneeAngle >= (180 - this.d.kneeTol); this.kneeStraight=kneeStraight;
    const inBand = tracked && elev >= this.d.target - this.d.band && elev <= this.d.target + this.d.band;
    const inZone = inBand && kneeStraight;
    if(tracked) this.steady.push(elev);
    const steadiness = inZone ? this.steady.value() : 0;

    if(this.phase==="raise"){
      const r=this.hold.update(inZone, dt, now/1000);
      if(inZone){ this.score += dt*12*(0.5+0.5*steadiness); this.qSum+=steadiness; this.qN++; }
      if(r.justRep){ this.reps++; this.score+=60; this._burst(); this.pop("Lift-off! +60"); this.audio&&this.audio.reward(); this.onEvent({type:"rep",reps:this.reps});
        if(this.reps>=this.repsTarget){ this._finish(); return; }
        this.phase="lower"; this.hold.reset(); }
    } else { this.hold.p=0; if(tracked && elev <= this.d.low){ this.phase="raise"; } }

    // visuals
    const frac = Math.max(0,Math.min(1, elev/this.maxElev));
    const targetY = 0.88 - frac*0.66;                          // 0.88 (ground) → 0.22 (high)
    this.balloonY += (targetY-this.balloonY)*Math.min(1,dt*6);
    this.glow += (((this.phase==="raise"&&inZone)?1:0)-this.glow)*Math.min(1,dt*8);
    this.wobble += (((tracked&&!kneeStraight&&elev>this.d.low)?1:0)-this.wobble)*Math.min(1,dt*10);
    this.rot=Math.sin(this.t*4)*this.wobble*0.25;
    for(const c of this.clouds){ c.x-=0.00004*dt*1000*c.s; if(c.x<-0.15)c.x=1.15; }

    // feedback
    if(!tracked) this.fb={text:"📷 Lie side-on — show your whole leg",color:"#ffb84d"};
    else if(this.phase==="lower") this.fb={text:"Lower your leg to reset",color:"#ff9ec7"};
    else if(!kneeStraight && elev>this.d.low) this.fb={text:"Keep your knee straight!",color:"#ff6f6f"};
    else if(elev < this.d.target-this.d.band) this.fb={text:"Raise your leg higher ↑",color:"#37e1ff"};
    else if(elev > this.d.target+this.d.band) this.fb={text:"Lower slightly into the band",color:"#ffb84d"};
    else this.fb = steadiness>0.6 ? {text:"Holding steady — nice! 🎈",color:"#8affc0"} : {text:"Hold it steady…",color:"#ffb84d"};

    this._step(dt);
  }
  _finish(){ this.done=true; const q=this.qN? this.qSum/this.qN : 0;
    this.result={ completed:true, stars:starsFor(q), score:Math.round(this.score), reps:this.reps, quality:+(q*100).toFixed(0) };
    this.onEvent({type:"end",...this.result}); }
  status(){ return { progress:this.hold.p, score:Math.round(this.score), reps:this.reps, repsTarget:this.repsTarget, feedback:this.fb, done:this.done, result:this.result }; }

  // ── render ──
  render(g, now){
    const W=this.W,H=this.H, cx=W*0.5;
    // clouds
    for(const c of this.clouds){ this._cloud(g, c.x*W, c.y*H, 34*c.s); }
    // target altitude band
    const yOf=e=>H*(0.88 - Math.max(0,Math.min(1,e/this.maxElev))*0.66);
    const yb1=yOf(this.d.target+this.d.band), yb2=yOf(this.d.target-this.d.band);
    const active=this.phase==="raise";
    g.fillStyle=active?"rgba(138,255,192,0.16)":"rgba(138,255,192,0.06)"; g.fillRect(0,yb1,W,yb2-yb1);
    g.strokeStyle=active?"#8affc0":"#5a6a90"; g.lineWidth=2; g.setLineDash([8,7]);
    g.beginPath(); g.moveTo(0,yb1); g.lineTo(W,yb1); g.moveTo(0,yb2); g.lineTo(W,yb2); g.stroke(); g.setLineDash([]);
    g.fillStyle=active?"#8affc0":"#7a86ad"; g.font="bold 13px sans-serif"; g.textAlign="left"; g.fillText("TARGET ALTITUDE", 12, yb1-8);
    // ground
    g.fillStyle="#173a2e"; g.fillRect(0,H*0.9,W,H*0.1); g.fillStyle="#1f5140"; for(let i=0;i<W;i+=26){ g.fillRect(i,H*0.9-6,3,6); }
    // balloon
    const by=this.balloonY*H, wob=Math.sin(this.t*8)*this.wobble*10;
    g.save(); g.translate(cx+wob, by); g.rotate(this.rot);
    if(this.glow>0.02){ const gg=g.createRadialGradient(0,0,4,0,0,110); gg.addColorStop(0,`rgba(138,255,192,${0.5*this.glow})`); gg.addColorStop(1,"rgba(138,255,192,0)"); g.fillStyle=gg; g.beginPath(); g.arc(0,0,110,0,7); g.fill(); }
    // string to ground (green when straight, red when bent)
    g.strokeStyle=this.kneeStraight?"#8affc088":"#ff6f6f"; g.lineWidth=2; g.beginPath(); g.moveTo(0,44); g.lineTo(wob*0.3,(H*0.9-by)); g.stroke();
    // balloon body
    const bg=g.createRadialGradient(-10,-14,4,0,0,46); bg.addColorStop(0,"#fff"); bg.addColorStop(0.5,"#ff8fbf"); bg.addColorStop(1,"#e0559a");
    g.fillStyle=bg; g.beginPath(); g.ellipse(0,0,38,46,0,0,7); g.fill(); g.fillStyle="#c33f82"; g.beginPath(); g.moveTo(-6,44); g.lineTo(6,44); g.lineTo(0,52); g.closePath(); g.fill();
    g.fillStyle="#8a5a2a"; g.fillRect(-12,54,24,14); g.strokeStyle="#c98a2e"; g.strokeRect(-12,54,24,14);
    // hold ring on balloon
    g.beginPath(); g.arc(0,0,54,-Math.PI/2,-Math.PI/2+this.hold.p*2*Math.PI); g.strokeStyle="#ffe08a"; g.lineWidth=5; g.lineCap="round"; g.stroke();
    g.restore();
    // live readout
    g.textAlign="center"; g.font="900 26px sans-serif"; g.fillStyle="#eef2ff"; g.fillText((this.tracked?Math.round(this.elev):"—")+"° raise", cx, H*0.14);
    g.font="bold 13px sans-serif";
    if(!this.tracked){ g.fillStyle="#ffb84d"; g.fillText("no leg detected", cx, H*0.14+20); }
    else { g.fillStyle=this.kneeStraight?"#8affc0":"#ff6f6f"; g.fillText(this.kneeStraight?"● knee straight":"● knee BENT — straighten", cx, H*0.14+20); }
    g.font="11px sans-serif"; g.fillStyle="#9aa6d4"; g.fillText(`confidence ${Math.round(this.conf*100)}%  ·  hold ${this.holdSecs}s`, cx, H*0.14+38);
    // reps pips
    for(let i=0;i<this.repsTarget;i++){ g.fillStyle=i<this.reps?"#ffe08a":"#ffffff33"; g.font="24px sans-serif"; g.fillText(i<this.reps?"🎈":"○", cx-(this.repsTarget-1)*18 + i*36, H*0.955); }
    // particles + pops
    for(const p of this.parts){ g.globalAlpha=Math.max(0,p.life); g.fillStyle=p.c; g.beginPath(); g.arc(p.x,p.y,3,0,7); g.fill(); } g.globalAlpha=1;
    for(const p of this.pops){ g.globalAlpha=Math.max(0,p.life); g.fillStyle="#ffe08a"; g.font="bold 20px sans-serif"; g.textAlign="center"; g.fillText(p.t,p.x,p.y); } g.globalAlpha=1;
  }
  _cloud(g,x,y,r){ g.fillStyle="#ffffff22"; g.beginPath(); g.arc(x,y,r,0,7); g.arc(x+r*0.8,y+5,r*0.7,0,7); g.arc(x-r*0.8,y+6,r*0.6,0,7); g.fill(); }
  _burst(){ const x=this.W*0.5, y=this.balloonY*this.H; for(let i=0;i<18;i++){ const a=Math.random()*7,s=Math.random()*4+1; this.parts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:1,c:Math.random()<0.5?"#ffe08a":"#ff8fbf"}); } }
  pop(t){ this.pops.push({x:this.W*0.5,y:this.balloonY*this.H-60,t,life:1}); }
  _step(dt){ for(const p of this.parts){ p.x+=p.vx; p.y+=p.vy; p.vy+=0.08; p.life-=dt*1.5; } this.parts=this.parts.filter(p=>p.life>0);
    for(const p of this.pops){ p.y-=26*dt; p.life-=dt*1.1; } this.pops=this.pops.filter(p=>p.life>0); }
}

export default {
  id:"slr", name:"Lift-Off", emoji:"🎈", exercise:"Straight Leg Raise", camera:"Sagittal (side-on)",
  howto:"Lie side-on. Keep your <b>knee straight</b> and <b>raise your whole leg</b> to float the balloon into the target band, then <b>hold</b>. A bent knee makes it wobble. Lower to reset.",
  calib:"none", diffs:Object.keys(DIFFS),
  // mouse-preview: pointer height → leg elevation, knee assumed straight
  mouseMetrics(p){ const raise=(1-p)*70; return { tracked:true, conf:1, flex:3, kneeFlex:3, kneeAngle:177, hipAngle:180-raise, ankle:{x:0.5,y:p}, side:"L" }; },
  make(ctx){ return new LiftOff(ctx); },
};
