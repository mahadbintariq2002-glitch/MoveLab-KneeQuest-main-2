// games/heel.js — OKC Game 3: Heel Slides → "Trace the Arc".
// Dynamic ROM exercise (not an isometric hold): lying or sitting side-on, slide the
// heel toward the buttocks to FLEX the knee as deep as the target, then slide it
// back out to full EXTENSION. One full in-and-out slide = one rainbow arc painted.
import { RepCycle, starsFor } from "../rehab.js";

// hi = knee angle (180=straight) that counts as "back to extension" to close a rep.
// lo = knee angle the patient must reach (or pass) to count as "deep enough" flexion.
const DIFFS = {
  gentle:   { hi:165, lo:135, reps:3 },   // ~45° of flexion required
  steady:   { hi:165, lo:110, reps:4 },   // ~70° of flexion required
  champion: { hi:168, lo:90,  reps:5 },   // ~90° of flexion required
};
const BAND_COLORS=["#ff6f6f","#ffb84d","#ffe08a","#8affc0","#37e1ff","#b58aff"];

class TraceArc {
  constructor(ctx){
    this.W=ctx.W; this.H=ctx.H; this.audio=ctx.audio; this.onEvent=ctx.onEvent||(()=>{});
    this.d = DIFFS[ctx.difficulty]||DIFFS.gentle;
    this.rc = new RepCycle({hi:this.d.hi, lo:this.d.lo});
    this.score=0; this.qSum=0; this.qN=0; this.reps=0; this.repsTarget=this.d.reps;
    this.minAngleCycle=999; this.pos=0; this.glow=0; this.t=0;
    this.parts=[]; this.pops=[]; this.trail=[]; this.done=false; this.result=null;
    this.angle=null; this.angleDisp=null; this.conf=0; this.fb={text:"",color:"#9aa6d4"};
  }
  resize(W,H){ this.W=W; this.H=H; }

  update(dt, m, now){
    if(this.done) return; this.t+=dt;
    const angle=m.kneeAngle, tracked=m.tracked && angle!=null;
    this.angle=tracked?angle:null; this.conf=m.conf||0;
    this.angleDisp = tracked ? (m.kneeAngleDisp!=null?m.kneeAngleDisp:angle) : null;

    if(tracked){
      this.minAngleCycle=Math.min(this.minAngleCycle, angle);
      const r=this.rc.update(angle);
      // trickle score while progressing deeper into flexion (encourages the slide-in)
      const pos=Math.max(0,Math.min(1,(this.d.hi-angle)/(this.d.hi-this.d.lo)));
      if(pos>this.pos) this.score += (pos-this.pos)*40;
      this.pos=pos;
      if(r.justRep){
        const depth=Math.max(0,Math.min(1,(this.d.hi-this.minAngleCycle)/(this.d.hi-this.d.lo)));
        this.qSum+=depth; this.qN++; this.minAngleCycle=999;
        this.reps++; this.score+=60; this._burst(); this.pop("+60 🌈"); this.audio&&this.audio.reward();
        this.onEvent({type:"rep",reps:this.reps});
        if(this.reps>=this.repsTarget){ this._finish(); return; }
      }
    } else { this.pos=this.pos*0.9; }

    this.glow += ((this.rc.phase==="lo"?1:0)-this.glow)*Math.min(1,dt*8);

    if(!tracked) this.fb={text:"📷 Lie or sit side-on — show your whole leg",color:"#ffb84d"};
    else if(this.rc.phase!=="lo" && this.pos<0.95) this.fb={text:"Slide your heel in — bend the knee ↓",color:"#37e1ff"};
    else if(this.rc.phase==="lo") this.fb={text:"Great depth — now slide back out and straighten ↑",color:"#8affc0"};
    else this.fb={text:"Slide in again ↓",color:"#37e1ff"};

    this._step(dt);
  }
  _finish(){ this.done=true; const q=this.qN? this.qSum/this.qN : 0;
    this.result={ completed:true, stars:starsFor(q), score:Math.round(this.score), reps:this.reps, quality:+(q*100).toFixed(0) };
    this.onEvent({type:"end",...this.result}); }
  status(){ return { progress:this.pos, score:Math.round(this.score), reps:this.reps, repsTarget:this.repsTarget, feedback:this.fb, done:this.done, result:this.result }; }

  // ── render: a rainbow of concentric arcs, one band per rep, comet traces the active band ──
  render(g, now){
    const W=this.W,H=this.H, cx=W*0.5, gy=H*0.86, baseR=Math.min(W,H)*0.16, gap=Math.min(W,H)*0.085;
    g.fillStyle="#173a2e"; g.fillRect(0,gy,W,H-gy);
    if(this.glow>0.02){ const ag=g.createRadialGradient(cx,gy,20,cx,gy,Math.max(W,H)*0.6);
      ag.addColorStop(0,`rgba(138,255,192,${0.10*this.glow})`); ag.addColorStop(1,"rgba(138,255,192,0)"); g.fillStyle=ag; g.fillRect(0,0,W,H); }
    for(let i=0;i<this.repsTarget;i++){
      const R=baseR+i*gap, done=i<this.reps, active=i===this.reps;
      g.beginPath(); g.arc(cx,gy,R,Math.PI,0,false);
      g.strokeStyle= done ? BAND_COLORS[i%BAND_COLORS.length] : (active?"#5a6a90":"#2c3670");
      g.lineWidth = done ? 10 : (active?9:6); g.lineCap="round";
      if(!done && active){ g.setLineDash([2,10]); } else { g.setLineDash([]); }
      g.globalAlpha = done?1:(active?0.9:0.35); g.stroke(); g.globalAlpha=1; g.setLineDash([]);
    }
    // comet on the active band
    const R=baseR+this.reps*gap, ang=Math.PI*(1-this.pos), px=cx+R*Math.cos(ang), py=gy-R*Math.sin(ang);
    this.trail.push({x:px,y:py,life:1}); if(this.trail.length>26) this.trail.shift();
    for(const p of this.trail){ g.globalAlpha=Math.max(0,p.life)*0.6; g.fillStyle=BAND_COLORS[this.reps%BAND_COLORS.length]; g.beginPath(); g.arc(p.x,p.y,5,0,7); g.fill(); }
    g.globalAlpha=1;
    if(this.glow>0.02){ const gg=g.createRadialGradient(px,py,4,px,py,50); gg.addColorStop(0,`rgba(138,255,192,${0.6*this.glow})`); gg.addColorStop(1,"rgba(138,255,192,0)"); g.fillStyle=gg; g.beginPath(); g.arc(px,py,50,0,7); g.fill(); }
    g.fillStyle="#fff"; g.beginPath(); g.arc(px,py,9,0,7); g.fill();
    g.strokeStyle=BAND_COLORS[this.reps%BAND_COLORS.length]; g.lineWidth=3; g.stroke();
    // endpoints labels
    g.fillStyle="#9aa6d4"; g.font="bold 12px sans-serif"; g.textAlign="left"; g.fillText("EXTENDED", cx-baseR-8, gy+18);
    g.textAlign="right"; g.fillText("FLEXED", cx+baseR+8, gy+18);
    // live readout
    g.textAlign="center"; g.font="900 30px sans-serif"; g.fillStyle="#eef2ff";
    g.fillText(this.angleDisp==null?"— °":Math.round(this.angleDisp)+"°", cx, H*0.16);
    g.font="bold 13px sans-serif";
    if(this.angle==null){ g.fillStyle="#ffb84d"; g.fillText("no knee detected", cx, H*0.16+20); }
    else { g.fillStyle=this.rc.phase==="lo"?"#8affc0":"#37e1ff"; g.fillText(`target flex ${180-this.d.lo}° · reached ${Math.max(0,Math.round(180-this.angle))}°`, cx, H*0.16+20); }
    g.font="11px sans-serif"; g.fillStyle="#9aa6d4"; g.fillText(`confidence ${Math.round(this.conf*100)}%`, cx, H*0.16+38);
    for(let i=0;i<this.repsTarget;i++){ g.font="22px sans-serif"; g.fillText(i<this.reps?"🌈":"○", cx-(this.repsTarget-1)*17 + i*34, H*0.06); }
    for(const p of this.parts){ g.globalAlpha=Math.max(0,p.life); g.fillStyle=p.c; g.beginPath(); g.arc(p.x,p.y,3,0,7); g.fill(); } g.globalAlpha=1;
    for(const p of this.pops){ g.globalAlpha=Math.max(0,p.life); g.fillStyle="#ffe08a"; g.font="bold 20px sans-serif"; g.textAlign="center"; g.fillText(p.t,p.x,p.y); } g.globalAlpha=1;
  }
  _burst(){ const R=baseRof(this)+this.reps*gapOf(this), ang=Math.PI*(1-this.pos), x=this.W*0.5+R*Math.cos(ang), y=this.H*0.86-R*Math.sin(ang);
    for(let i=0;i<18;i++){ const a=Math.random()*7,s=Math.random()*4+1; this.parts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:1,c:Math.random()<0.5?"#ffe08a":BAND_COLORS[this.reps%BAND_COLORS.length]}); } }
  pop(t){ this.pops.push({x:this.W*0.5,y:this.H*0.7,t,life:1}); }
  _step(dt){ for(const p of this.parts){ p.x+=p.vx; p.y+=p.vy; p.vy+=0.08; p.life-=dt*1.5; } this.parts=this.parts.filter(p=>p.life>0);
    for(const p of this.pops){ p.y-=28*dt; p.life-=dt*1.1; } this.pops=this.pops.filter(p=>p.life>0);
    for(const p of this.trail){ p.life-=dt*2.2; } this.trail=this.trail.filter(p=>p.life>0); }
}
function baseRof(self){ return Math.min(self.W,self.H)*0.16; }
function gapOf(self){ return Math.min(self.W,self.H)*0.085; }

export default {
  id:"heel", name:"Trace the Arc", emoji:"🌈", exercise:"Heel Slides / ROM", camera:"Sagittal (side-on)",
  howto:"Lie or sit side-on. <b>Slide your heel toward you</b> to bend the knee as deep as the target, then <b>slide it back out straight</b>. Each full slide paints one band of the rainbow.",
  calib:"none", usesHold:false, diffs:Object.keys(DIFFS),
  // mouse-preview: pointer height → knee angle (top=straight, bottom=deep flex)
  mouseMetrics(p){ const angle=180-p*100; return { tracked:true, conf:1, flex:180-angle, kneeFlex:180-angle, kneeAngle:angle, kneeAngleDisp:angle, hipAngle:150, ankle:{x:.5,y:p}, side:"L" }; },
  make(ctx){ return new TraceArc(ctx); },
};
