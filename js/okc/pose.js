// pose.js — shared PoseController (precision build).
// Knee angle = 2-D sagittal angle at hip–knee–ankle. Pipeline for a steady,
// data-grade reading: smoothed landmarks → median spike-rejection → One-Euro →
// display dead-band. Draws the SMOOTHED skeleton (not raw) for a stable overlay.
import { FilesetResolver, PoseLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12";
import { OneEuro, angle2d, vis, VIS_DRAW } from "../core.js";

const POSE_MODEL="https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";
const WASM="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/wasm";
const SH={L:11,R:12}, HIP={L:23,R:24}, KNEE={L:25,R:26}, ANK={L:27,R:28};
const TRACK_FLOOR=0.35, MED=7, DEADBAND=1.2;
// Extra gates so a close-up limb (e.g. a straightened arm) or a person sitting
// square to the camera can't be mistaken for a tracked knee:
const SHOULDER_FLOOR=0.35;  // both shoulders must be visible — confirms a torso (not just a nearby limb) is actually in frame
const ASYM_FLOOR=0.12;      // one side's hip-knee-ankle chain must clearly out-read the other — true only in a genuine side-on view; a person facing the camera reads both legs about equally
// FRONT view (standing balance games): the person must face the camera, standing, whole body in frame.
const BAL_FLOOR=0.4;        // shoulders, hips and ankles (both sides) must all be visible
const FRONT_RATIO=0.5;      // shoulder width / torso length — wide only when facing the camera (side-on ≈ 0.1-0.2, facing ≈ 0.7)
const STAND_RATIO=1.25;     // hip→ankle length / torso length — ≈1.6 standing, ≈0.9 seated facing the camera
const STANCE_MIN=0.25;      // ankle separation / leg length — feet apart, not together (shoulder-width ≈ 0.45)

function median(a){ if(!a.length)return null; const s=[...a].sort((x,y)=>x-y),m=s.length>>1; return s.length%2?s[m]:(s[m-1]+s[m])/2; }

export class PoseController {
  constructor(){
    this.landmarker=null; this.stream=null; this.video=null; this.facing="user";
    this.fX=[]; this.fY=[]; for(let i=0;i<33;i++){this.fX[i]=new OneEuro(1.0,0.15);this.fY[i]=new OneEuro(1.0,0.15);}  // smoother skeleton
    this.kneeSmooth=new OneEuro(0.5,0.05); this.hipSmooth=new OneEuro(0.5,0.05);   // very steady when held
    this.kneeMed=[]; this.hipMed=[]; this.kneeDisp=null; this.smLandmarks=null;
    this.lastRes=null; this.lastVideoTime=-1; this.zero=0; this.primaryIdx=0; this.view="side";
    this.m={ tracked:false, conf:0, kneeAngle:null, kneeAngleDisp:null, kneeFlex:null, hipAngle:null, ankle:null, side:null, bodyOk:false, sideOnOk:false, bal:null };
  }
  get CONNECTIONS(){ return PoseLandmarker.POSE_CONNECTIONS; }

  // "side" = knee-angle games (default). "front" = standing balance: reads the person facing the camera.
  setView(v){ this.view = v==="front" ? "front" : "side"; this.kneeMed.length=0; this.hipMed.length=0;
    const m=this.m; m.tracked=false; m.bal=null; m.side=null; m.kneeAngle=null; m.kneeAngleDisp=null; m.kneeFlex=null; m.hipAngle=null; this.kneeDisp=null; }

  async load(onMsg){ if(this.landmarker) return; onMsg&&onMsg("Loading tracker… (first time ~10 MB)");
    const vision=await FilesetResolver.forVisionTasks(WASM);
    const opt=del=>({baseOptions:{modelAssetPath:POSE_MODEL,delegate:del},runningMode:"VIDEO",numPoses:2,
      minPoseDetectionConfidence:.4,minPosePresenceConfidence:.4,minTrackingConfidence:.4});
    try{ this.landmarker=await PoseLandmarker.createFromOptions(vision,opt("GPU")); }
    catch(e){ this.landmarker=await PoseLandmarker.createFromOptions(vision,opt("CPU")); } }

  async startCamera(video, facing){ this.video=video; if(facing)this.facing=facing;
    if(this.stream)this.stream.getTracks().forEach(t=>t.stop());
    let s; try{ s=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:this.facing},width:{ideal:1280},height:{ideal:720}}}); }
    catch(e){ s=await navigator.mediaDevices.getUserMedia({audio:false,video:true}); }
    this.stream=s; video.srcObject=s; await new Promise(r=>{ if(video.readyState>=1)r(); else video.onloadedmetadata=()=>r(); }); await video.play(); }
  stop(){ if(this.stream){ this.stream.getTracks().forEach(t=>t.stop()); this.stream=null; } }
  async switchCamera(video){ this.facing=this.facing==="user"?"environment":"user"; await this.startCamera(video); }

  frame(now){
    const v=this.video, m=this.m;
    if(!this.landmarker||!v||v.readyState<2){ m.tracked=false; return m; }
    if(v.currentTime!==this.lastVideoTime){ this.lastVideoTime=v.currentTime; try{ this.lastRes=this.landmarker.detectForVideo(v,now); }catch(e){} }
    const res=this.lastRes;
    if(res&&res.landmarks&&res.landmarks.length){
      const pi=this._primary(res.landmarks); this.primaryIdx=pi;
      const raw=res.landmarks[pi], t=now/1000, asp=(v.videoWidth/v.videoHeight)||(16/9);
      const sm=raw.map((p,i)=>({x:this.fX[i].filt(p.x,t),y:this.fY[i].filt(p.y,t),z:p.z,visibility:vis(p)}));
      this.smLandmarks=sm;                                        // for a smooth skeleton overlay
      if(this.view==="front"){ this._frontal(sm,asp); return m; }
      m.bal=null;
      const cL=Math.min(vis(sm[HIP.L]),vis(sm[KNEE.L]),vis(sm[ANK.L]));
      const cR=Math.min(vis(sm[HIP.R]),vis(sm[KNEE.R]),vis(sm[ANK.R]));
      const side = cL>=cR ? "L":"R"; const conf=Math.max(cL,cR); m.side=side; m.conf=conf;
      const bodyOk = vis(sm[SH.L])>=SHOULDER_FLOOR && vis(sm[SH.R])>=SHOULDER_FLOOR;
      const sideOnOk = Math.abs(cL-cR)>=ASYM_FLOOR;
      m.bodyOk=bodyOk; m.sideOnOk=sideOnOk;
      if(conf>=TRACK_FLOOR && bodyOk && sideOnOk){
        const raw2=angle2d(sm[HIP[side]], sm[KNEE[side]], sm[ANK[side]], asp);
        if(raw2!=null){ this.kneeMed.push(raw2); if(this.kneeMed.length>MED) this.kneeMed.shift();
          const ka=this.kneeSmooth.filt(median(this.kneeMed), t);
          m.kneeAngle=ka; m.kneeFlex=Math.max(0,180-ka);
          if(this.kneeDisp==null || Math.abs(ka-this.kneeDisp)>DEADBAND) this.kneeDisp=ka;   // steady display number
          m.kneeAngleDisp=this.kneeDisp; m.tracked=true;
        } else { m.tracked=false; }
        const sh=sm[SH[side]];
        if(vis(sh)>0.4 && vis(sm[HIP[side]])>0.4 && vis(sm[KNEE[side]])>0.4){
          const rawh=angle2d(sh, sm[HIP[side]], sm[KNEE[side]], asp);
          if(rawh!=null){ this.hipMed.push(rawh); if(this.hipMed.length>MED)this.hipMed.shift(); m.hipAngle=this.hipSmooth.filt(median(this.hipMed),t); }
        } else m.hipAngle=null;
        m.ankle = sm[ANK[side]] ? {x:sm[ANK[side]].x,y:sm[ANK[side]].y,v:vis(sm[ANK[side]])} : null;
      } else { m.tracked=false; m.kneeAngle=null; m.kneeFlex=null; m.hipAngle=null; this.kneeMed.length=0; }
    } else { m.tracked=false; m.conf=0; m.kneeAngle=null; m.kneeFlex=null; m.hipAngle=null; m.bal=null; this.smLandmarks=null; this.kneeMed.length=0; }
    return m;
  }

  // Front view: lateral weight-shift of the pelvis relative to the feet.
  //   shift  = (pelvis midpoint − ankle midpoint) along the ankle-to-ankle axis, in half-stance units.
  //            +1 = pelvis directly over the ANATOMICAL LEFT ankle, −1 = over the right, 0 = centred.
  //            Axis comes from the ankle landmarks themselves, so it is independent of image mirroring.
  //   weight on the left leg ≈ 0.5 + shift/2 (static: centre of mass splits load between the feet in
  //   proportion to its distance from each) — a position-based estimate, NOT a force measurement.
  _frontal(sm, asp){
    const m=this.m, P=i=>({x:sm[i].x*asp, y:sm[i].y}), mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
    const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
    m.kneeAngle=null; m.kneeAngleDisp=null; m.kneeFlex=null; m.hipAngle=null; m.side=null; m.bodyOk=false; m.sideOnOk=false; this.kneeMed.length=0;
    const conf=Math.min(...[SH.L,SH.R,HIP.L,HIP.R,ANK.L,ANK.R].map(i=>vis(sm[i]))); m.conf=conf;
    const sL=P(SH.L), sR=P(SH.R), hL=P(HIP.L), hR=P(HIP.R), aL=P(ANK.L), aR=P(ANK.R);
    const sh=mid(sL,sR), hp=mid(hL,hR), ak=mid(aL,aR);
    const torso=dist(sh,hp), legLen=dist(hp,ak), shW=dist(sL,sR), stance=dist(aL,aR);
    const bodyOk = conf>=BAL_FLOOR && torso>1e-6 && legLen>1e-6;
    const frontOk = bodyOk && shW/torso>=FRONT_RATIO;
    const standingOk = bodyOk && legLen/torso>=STAND_RATIO;
    const stanceOk = bodyOk && stance/legLen>=STANCE_MIN;
    let shift=0, trunkLean=0;
    if(bodyOk && stance>1e-6){
      const ux=(aL.x-aR.x)/stance, uy=(aL.y-aR.y)/stance;
      shift=((hp.x-ak.x)*ux+(hp.y-ak.y)*uy)/(stance/2);
      trunkLean=((sh.x-hp.x)*ux+(sh.y-hp.y)*uy)/torso;           // upper-body lean toward the left foot (+), ~sin(angle)
    }
    const ok = bodyOk && frontOk && standingOk;
    m.bal={ ok, bodyOk, frontOk, standingOk, stanceOk, shift, trunkLean, dyN: bodyOk?(aL.y-aR.y)/legLen:0 };
    m.bodyOk=bodyOk; m.tracked=ok;
  }

  _primary(list){ if(list.length<=1) return 0; let best=0,ba=-1;
    for(let i=0;i<list.length;i++){ const lm=list[i]; let mnx=1,mny=1,mxx=0,mxy=0,n=0;
      for(const p of lm){ if((p.visibility??1)<0.3) continue; mnx=Math.min(mnx,p.x); mny=Math.min(mny,p.y); mxx=Math.max(mxx,p.x); mxy=Math.max(mxy,p.y); n++; }
      const area = n>6 ? (mxx-mnx)*(mxy-mny) : 0; if(area>ba){ ba=area; best=i; } }
    return best; }

  calibrateZero(){ if(this.m.kneeAngle!=null){ this.zero=180-this.m.kneeAngle; return true; } return false; }

  // draw the live camera (cover-fit) + SMOOTHED skeleton, tracked leg highlighted.
  drawScene(ctx,w,h){ ctx.clearRect(0,0,w,h); const v=this.video; if(!v||!v.videoWidth) return;
    if(this.view==="front"){ ctx.save(); ctx.translate(w,0); ctx.scale(-1,1); try{ this._drawBody(ctx,w,h); }finally{ ctx.restore(); } }   // mirror view for front-facing games
    else this._drawBody(ctx,w,h); }
  _drawBody(ctx,w,h){ const v=this.video;
    const vw=v.videoWidth, vh=v.videoHeight, scale=Math.max(w/vw,h/vh), dw=vw*scale, dh=vh*scale, ox=(w-dw)/2, oy=(h-dh)/2;
    try{ ctx.drawImage(v,ox,oy,dw,dh); }catch(e){}
    const lm=this.smLandmarks; if(!lm) return; const P=p=>[ox+p.x*dw, oy+p.y*dh];
    ctx.lineWidth=Math.max(2,w/320); ctx.strokeStyle="#37e1ffbb"; ctx.lineCap="round";
    for(const c of this.CONNECTIONS){ const a=lm[c.start],b=lm[c.end]; if(vis(a)<0.4||vis(b)<0.4)continue; const pa=P(a),pb=P(b); ctx.beginPath();ctx.moveTo(pa[0],pa[1]);ctx.lineTo(pb[0],pb[1]);ctx.stroke(); }
    if(this.view==="front" && this.m.bal && this.m.bal.bodyOk){   // centre-of-mass proxy (pelvis) vs. the feet
      const mid=(i,j)=>({x:(lm[i].x+lm[j].x)/2, y:(lm[i].y+lm[j].y)/2}), hp=P(mid(HIP.L,HIP.R)), ak=P(mid(ANK.L,ANK.R)), aL=P(lm[ANK.L]), aR=P(lm[ANK.R]);
      ctx.strokeStyle="#ffe08a"; ctx.lineWidth=Math.max(3,w/200); ctx.setLineDash([6,6]); ctx.beginPath(); ctx.moveTo(hp[0],hp[1]); ctx.lineTo(hp[0],ak[1]); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle="#8affc0"; ctx.lineWidth=Math.max(4,w/150); ctx.beginPath(); ctx.moveTo(aL[0],aL[1]); ctx.lineTo(aR[0],aR[1]); ctx.stroke();
      ctx.fillStyle="#8affc0"; for(const q of [aL,aR]){ ctx.beginPath(); ctx.arc(q[0],q[1],Math.max(5,w/120),0,7); ctx.fill(); }
      ctx.fillStyle="#ffe08a"; ctx.beginPath(); ctx.arc(hp[0],hp[1],Math.max(7,w/90),0,7); ctx.fill();
    }
    const s=this.m.side; if(s){ ctx.strokeStyle="#8affc0"; ctx.lineWidth=Math.max(4,w/150);
      for(const [i,j] of [[HIP[s],KNEE[s]],[KNEE[s],ANK[s]]]){ const a=lm[i],b=lm[j]; if(vis(a)<0.3||vis(b)<0.3)continue; const pa=P(a),pb=P(b); ctx.beginPath();ctx.moveTo(pa[0],pa[1]);ctx.lineTo(pb[0],pb[1]);ctx.stroke(); }
      for(const idx of [HIP[s],KNEE[s],ANK[s]]){ const p=lm[idx]; if(vis(p)<0.3)continue; const pp=P(p); ctx.fillStyle="#8affc0"; ctx.beginPath();ctx.arc(pp[0],pp[1],Math.max(4,w/140),0,7);ctx.fill(); }
      // show the live angle right at the knee
      if(this.m.kneeAngleDisp!=null){ const k=P(lm[KNEE[s]]); ctx.fillStyle="#eef2ff"; ctx.font=`900 ${Math.max(16,w/26)}px sans-serif`; ctx.textAlign="left";
        ctx.strokeStyle="#000"; ctx.lineWidth=4; ctx.strokeText(Math.round(this.m.kneeAngleDisp)+"°", k[0]+14, k[1]); ctx.fillText(Math.round(this.m.kneeAngleDisp)+"°", k[0]+14, k[1]); } } }

  drawPip(ctx,w,h){ this.drawScene(ctx,w,h); }
}
