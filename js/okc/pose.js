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

function median(a){ if(!a.length)return null; const s=[...a].sort((x,y)=>x-y),m=s.length>>1; return s.length%2?s[m]:(s[m-1]+s[m])/2; }

export class PoseController {
  constructor(){
    this.landmarker=null; this.stream=null; this.video=null; this.facing="user";
    this.fX=[]; this.fY=[]; for(let i=0;i<33;i++){this.fX[i]=new OneEuro(1.0,0.15);this.fY[i]=new OneEuro(1.0,0.15);}  // smoother skeleton
    this.kneeSmooth=new OneEuro(0.5,0.05); this.hipSmooth=new OneEuro(0.5,0.05);   // very steady when held
    this.kneeMed=[]; this.hipMed=[]; this.kneeDisp=null; this.smLandmarks=null;
    this.lastRes=null; this.lastVideoTime=-1; this.zero=0; this.primaryIdx=0;
    this.m={ tracked:false, conf:0, kneeAngle:null, kneeAngleDisp:null, kneeFlex:null, hipAngle:null, ankle:null, side:null };
  }
  get CONNECTIONS(){ return PoseLandmarker.POSE_CONNECTIONS; }

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
      const cL=Math.min(vis(sm[HIP.L]),vis(sm[KNEE.L]),vis(sm[ANK.L]));
      const cR=Math.min(vis(sm[HIP.R]),vis(sm[KNEE.R]),vis(sm[ANK.R]));
      const side = cL>=cR ? "L":"R"; const conf=Math.max(cL,cR); m.side=side; m.conf=conf;
      if(conf>=TRACK_FLOOR){
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
    } else { m.tracked=false; m.conf=0; m.kneeAngle=null; m.kneeFlex=null; m.hipAngle=null; this.smLandmarks=null; this.kneeMed.length=0; }
    return m;
  }

  _primary(list){ if(list.length<=1) return 0; let best=0,ba=-1;
    for(let i=0;i<list.length;i++){ const lm=list[i]; let mnx=1,mny=1,mxx=0,mxy=0,n=0;
      for(const p of lm){ if((p.visibility??1)<0.3) continue; mnx=Math.min(mnx,p.x); mny=Math.min(mny,p.y); mxx=Math.max(mxx,p.x); mxy=Math.max(mxy,p.y); n++; }
      const area = n>6 ? (mxx-mnx)*(mxy-mny) : 0; if(area>ba){ ba=area; best=i; } }
    return best; }

  calibrateZero(){ if(this.m.kneeAngle!=null){ this.zero=180-this.m.kneeAngle; return true; } return false; }

  // draw the live camera (cover-fit) + SMOOTHED skeleton, tracked leg highlighted.
  drawScene(ctx,w,h){ ctx.clearRect(0,0,w,h); const v=this.video; if(!v||!v.videoWidth) return;
    const vw=v.videoWidth, vh=v.videoHeight, scale=Math.max(w/vw,h/vh), dw=vw*scale, dh=vh*scale, ox=(w-dw)/2, oy=(h-dh)/2;
    try{ ctx.drawImage(v,ox,oy,dw,dh); }catch(e){}
    const lm=this.smLandmarks; if(!lm) return; const P=p=>[ox+p.x*dw, oy+p.y*dh];
    ctx.lineWidth=Math.max(2,w/320); ctx.strokeStyle="#37e1ffbb"; ctx.lineCap="round";
    for(const c of this.CONNECTIONS){ const a=lm[c.start],b=lm[c.end]; if(vis(a)<0.4||vis(b)<0.4)continue; const pa=P(a),pb=P(b); ctx.beginPath();ctx.moveTo(pa[0],pa[1]);ctx.lineTo(pb[0],pb[1]);ctx.stroke(); }
    const s=this.m.side; if(s){ ctx.strokeStyle="#8affc0"; ctx.lineWidth=Math.max(4,w/150);
      for(const [i,j] of [[HIP[s],KNEE[s]],[KNEE[s],ANK[s]]]){ const a=lm[i],b=lm[j]; if(vis(a)<0.3||vis(b)<0.3)continue; const pa=P(a),pb=P(b); ctx.beginPath();ctx.moveTo(pa[0],pa[1]);ctx.lineTo(pb[0],pb[1]);ctx.stroke(); }
      for(const idx of [HIP[s],KNEE[s],ANK[s]]){ const p=lm[idx]; if(vis(p)<0.3)continue; const pp=P(p); ctx.fillStyle="#8affc0"; ctx.beginPath();ctx.arc(pp[0],pp[1],Math.max(4,w/140),0,7);ctx.fill(); }
      // show the live angle right at the knee
      if(this.m.kneeAngleDisp!=null){ const k=P(lm[KNEE[s]]); ctx.fillStyle="#eef2ff"; ctx.font=`900 ${Math.max(16,w/26)}px sans-serif`; ctx.textAlign="left";
        ctx.strokeStyle="#000"; ctx.lineWidth=4; ctx.strokeText(Math.round(this.m.kneeAngleDisp)+"°", k[0]+14, k[1]); ctx.fillText(Math.round(this.m.kneeAngleDisp)+"°", k[0]+14, k[1]); } } }

  drawPip(ctx,w,h){ this.drawScene(ctx,w,h); }
}
