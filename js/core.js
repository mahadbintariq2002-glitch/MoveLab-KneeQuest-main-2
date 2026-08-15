// core.js — shared motion-sensing core for MoveLab / KneeQuest.
// Extracted from the tracker (index.html) so the tracker and the games share
// one validated angle pipeline. Pure functions + small stateful filters only;
// no DOM, so this file is unit-testable.

// ─────────────────────── landmark map ───────────────────────
// Knee flexion = angle at KNEE between HIP and ANKLE. raw 180° = straight leg.
export const KNEES = {
  L:{hip:23,knee:25,ankle:27,color:"#39ff14",label:"L.Knee"},
  R:{hip:24,knee:26,ankle:28,color:"#00ff80",label:"R.Knee"},
};
export const P = {L_SH:11,R_SH:12,L_HIP:23,R_HIP:24};
export const LEFT_IDX  = [1,2,3,7,9,11,13,15,17,19,21,23,25,27,29,31];
export const RIGHT_IDX = [4,5,6,8,10,12,14,16,18,20,22,24,26,28,30,32];

// tuning constants (mirror the tracker)
export const VIS_DRAW=0.5, VIS_KNEE=0.55;
export const MIN_KNEE=0, MAX_KNEE=160;   // physiological knee-flexion clamp
export const MED_WIN=5;                   // median window for spike rejection

// ──────────────────── One-Euro filter ─────────────────────
export class OneEuro{
  constructor(min=1.2,beta=0.25,d=1.0){this.min=min;this.beta=beta;this.d=d;
    this.x=null;this.dx=0;this.t=null;this.freq=30;}
  alpha(c){const te=1/this.freq,tau=1/(2*Math.PI*c);return 1/(1+tau/te);}
  filt(x,t){
    if(this.x===null){this.x=x;this.t=t;return x;}
    if(t>this.t)this.freq=1/(t-this.t); this.t=t;
    const dx=(x-this.x)*this.freq, ad=this.alpha(this.d);
    const dxh=ad*dx+(1-ad)*this.dx;
    const cut=this.min+this.beta*Math.abs(dxh), a=this.alpha(cut);
    const xh=a*x+(1-a)*this.x; this.x=xh; this.dx=dxh; return xh;
  }
}

// ───────────────────────── math ───────────────────────────
export function angle3d(a,b,c){
  const ba=[a.x-b.x,a.y-b.y,a.z-b.z], bc=[c.x-b.x,c.y-b.y,c.z-b.z];
  const n1=Math.hypot(...ba), n2=Math.hypot(...bc);
  if(n1<1e-6||n2<1e-6)return null;
  const d=(ba[0]*bc[0]+ba[1]*bc[1]+ba[2]*bc[2])/(n1*n2);
  return Math.acos(Math.max(-1,Math.min(1,d)))*180/Math.PI;
}
export function angle2d(a,b,c,asp){
  const ba=[(a.x-b.x)*asp,a.y-b.y], bc=[(c.x-b.x)*asp,c.y-b.y];
  const n1=Math.hypot(...ba), n2=Math.hypot(...bc);
  if(n1<1e-6||n2<1e-6)return null;
  const d=(ba[0]*bc[0]+ba[1]*bc[1])/(n1*n2);
  return Math.acos(Math.max(-1,Math.min(1,d)))*180/Math.PI;
}
export const clinFlex = raw => Math.max(0,180-raw);
export const clampKnee = v => Math.max(MIN_KNEE,Math.min(MAX_KNEE,v));
export function median(a){const s=[...a].sort((x,y)=>x-y),m=s.length>>1;
  return s.length?(s.length%2?s[m]:(s[m-1]+s[m])/2):null;}

export function kneeState(flex){
  if(flex<10) return["FULL EXTENSION","#39ff14"];
  if(flex<40) return["SLIGHT FLEX","#00ff80"];
  if(flex<90) return["MODERATE FLEX","#00dcff"];
  if(flex<120)return["DEEP FLEX","#ffa500"];
  return["MAX FLEX","#ff3250"];
}
export function vis(p){ return (p && p.visibility!=null) ? p.visibility : 1; }

export function detectView(lm){
  const ls=lm[P.L_SH],rs=lm[P.R_SH];
  if(vis(ls)<.4||vis(rs)<.4)return["—","#9aa0c0"];
  const sdx=Math.abs(rs.x-ls.x);
  const lh=lm[P.L_HIP],rh=lm[P.R_HIP];
  const hdx=(vis(lh)>.3&&vis(rh)>.3)?Math.abs(rh.x-lh.x):.18;
  const r=sdx/Math.max(hdx,.04);
  if(r<.30)return["SIDE","#ffa500"];
  if(r>.80)return["FRONTAL","#39ff14"];
  return["ANGLED","#00dcff"];
}

// ─────────── active-knee flexion from a landmark frame ───────────
// Returns per-side smoothed clinical flexion (deg), confidence, and which
// leg(s) are being measured — reused by both games and the tracker.
export class KneeMeter{
  constructor(){
    this.filt={L:new OneEuro(0.5,0.10), R:new OneEuro(0.5,0.10)};
    this.med={L:[],R:[]};
    this.calib={L:0,R:0};
    this.lastValid={L:false,R:false};
  }
  reset(){ this.calib.L=0; this.calib.R=0; }
  // sm: screen landmarks [{x,y,z,visibility}], wlm: world landmarks, view: "SIDE"|... , asp: aspect
  measure(sm, wlm, view, asp){
    const out={L:null,R:null,view};
    let measure={L:true,R:true};
    if(view==="SIDE"){
      let ls=0,rs=0;
      for(const i of LEFT_IDX)  ls+=vis(sm[i]);
      for(const i of RIGHT_IDX) rs+=vis(sm[i]);
      const nearL = ls>=rs; measure={L:nearL,R:!nearL};
      out.near = nearL?"L":"R";
    }
    for(const side of ["L","R"]){
      const K=KNEES[side];
      if(!measure[side]){ this.med[side].length=0; this.lastValid[side]=false; continue; }
      const conf=Math.min(vis(sm[K.hip]),vis(sm[K.knee]),vis(sm[K.ankle]));
      if(conf<VIS_KNEE){ this.lastValid[side]=false; continue; }
      let rawA=(view==="SIDE")?angle2d(sm[K.hip],sm[K.knee],sm[K.ankle],asp)
                              :angle3d(wlm[K.hip],wlm[K.knee],wlm[K.ankle]);
      if(rawA===null) rawA=angle3d(wlm[K.hip],wlm[K.knee],wlm[K.ankle]);
      if(rawA===null){ this.lastValid[side]=false; continue; }
      const win=this.med[side]; win.push(rawA); if(win.length>MED_WIN)win.shift();
      const t=(typeof performance!=="undefined"?performance.now():Date.now())/1000;
      const smA=this.filt[side].filt(median(win),t);
      const flex=clampKnee(clinFlex(smA)-this.calib[side]);
      out[side]={flex,conf,calibrated:this.calib[side]!==0};
      this.lastValid[side]=true;
    }
    // active = valid side with the higher confidence
    let act=null;
    if(out.L&&out.R) act=out.L.conf>=out.R.conf?"L":"R";
    else if(out.L)   act="L";
    else if(out.R)   act="R";
    out.active=act;
    out.activeFlex = act? out[act].flex : null;
    out.activeConf = act? out[act].conf : 0;
    return out;
  }
  // zero the currently-valid side(s) so a straight leg reads 0° (like the tracker)
  calibrate(measured){
    const done=[];
    for(const s of ["L","R"]){
      if(measured[s]){ this.calib[s]+=measured[s].flex; done.push(s); }
    }
    return done;
  }
}
