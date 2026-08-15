// beacons.js — STEADFAST beacon (exercise) definitions.
// Each beacon maps an isometric hold to ONE measured scalar the webcam can see,
// plus an optional posture gate (trunk/pelvis/foot). The game feeds `value` to
// HoldDetector (target ± band); `gate`/`postureCue` become the detector's opts.
//
// A beacon's `compute(ctx)` is a pure function of the current frame:
//   ctx = { sm, wlm, asp, view, knee, hipC, baseline }
//     sm       smoothed screen landmarks [{x,y,z,visibility}]
//     wlm      world landmarks
//     asp      video aspect (w/h) for x-correcting 2-D angles
//     knee     KneeMeter result for this frame (activeFlex, L, R, near…)
//     hipC     {x,y} hip-centre (mid of hips) — for sway beacons
//     baseline {x,y} hip-centre captured when the hold began (sway beacons)
//   returns { value, valid, conf, gate, postureCue }
//     value      the scalar compared against target±band (deg, or sway units)
//     valid      landmarks reliable enough to score
//     conf       0..1 confidence (min visibility of the joints used)
//     gate       optional bool: force in/out-of-band (posture/pelvis/foot check)
//     postureCue optional string shown when gate === false

const IDX={SH_L:11,SH_R:12,HIP_L:23,HIP_R:24,KNEE_L:25,KNEE_R:26,ANK_L:27,ANK_R:28,HEEL_L:29,HEEL_R:30};
const vget=(p)=> (p&&p.visibility!=null)?p.visibility:1;
const mid=(p,q)=>({x:(p.x+q.x)/2,y:(p.y+q.y)/2,v:Math.min(vget(p),vget(q))});
// deviation of vector a→b from the VERTICAL axis (0°=vertical up or down, 90°=horizontal)
function degFromVertical(a,b,asp){const dx=(b.x-a.x)*asp,dy=(b.y-a.y);return Math.atan2(Math.abs(dx),Math.abs(dy))*180/Math.PI;}
// deviation of vector a→b from the HORIZONTAL axis (0°=flat, 90°=vertical)
function degFromHorizontal(a,b,asp){const dx=(b.x-a.x)*asp,dy=(b.y-a.y);return Math.atan2(Math.abs(dy),Math.abs(dx))*180/Math.PI;}
// 2-D angle at vertex b between a and c (aspect-corrected)
function angleAt(a,b,c,asp){
  const b1=[(a.x-b.x)*asp,a.y-b.y], b2=[(c.x-b.x)*asp,c.y-b.y];
  const n1=Math.hypot(...b1),n2=Math.hypot(...b2); if(n1<1e-6||n2<1e-6)return null;
  const d=(b1[0]*b2[0]+b1[1]*b2[1])/(n1*n2);
  return Math.acos(Math.max(-1,Math.min(1,d)))*180/Math.PI;
}
export function hipCentre(sm){ return mid(sm[IDX.HIP_L],sm[IDX.HIP_R]); }

// pick the "working" side for one-leg exercises: prefer the KneeMeter's near/active
function sideOf(knee){ return knee.near || knee.active || "L"; }

export const BEACONS = {
  // ── Beacon 1 — Harbor Light: wall sit (quadriceps) ──
  harbor:{
    id:"harbor", beacon:"Harbor Light", exercise:"Wall sit", level:"QUADS", unit:"°",
    target:60, band:12, holdSecs:20, sets:5, restSecs:30, min:30, max:110,
    targetLabel:"Wall-sit knee bend", view:"side",
    calMsg:"Stand <b>side-on</b>, whole body in frame. Straighten the leg, tap <b>Set 0°</b>, then sit back into the wall.",
    safety:"⚠ Back on the wall, chair within reach. Knees ~60–90° (safe range). Breathe. Stop if pain &gt;4/10.",
    cues:{below:"Sit a little deeper", above:"Ease up — too deep", posture:"Keep your trunk upright"},
    compute(ctx){
      const {sm,asp,knee}=ctx;
      if(knee.activeFlex==null) return {valid:false,conf:knee.activeConf||0};
      // trunk should stay roughly vertical during a wall sit
      const sh=mid(sm[IDX.SH_L],sm[IDX.SH_R]), hp=mid(sm[IDX.HIP_L],sm[IDX.HIP_R]);
      const trunk=degFromVertical(hp,sh,asp);          // 0 = upright
      const postureOk = !(sh.v>0.4 && hp.v>0.4) || trunk<=22;
      return {value:knee.activeFlex, valid:true, conf:knee.activeConf,
              gate: postureOk ? undefined : false, postureCue: postureOk?undefined:"posture"};
    },
  },

  // ── Beacon 2 — Cliff Light: straight-leg-raise hold (supine) ──
  cliff:{
    id:"cliff", beacon:"Cliff Light", exercise:"Straight-leg-raise hold", level:"QUADS", unit:"°",
    target:30, band:12, holdSecs:12, sets:5, restSecs:30, min:15, max:60,
    targetLabel:"Leg raise from floor", view:"side",
    calMsg:"Lie down, <b>side-on</b> to the camera, whole body in frame. Straighten the leg fully, then raise it.",
    safety:"⚠ Lie on your back, low back supported. Keep the knee straight, no breath-holding. Stop if pain &gt;4/10.",
    cues:{below:"Raise the leg a little higher", above:"Lower slightly", posture:"Straighten your knee"},
    compute(ctx){
      const {sm,asp,knee}=ctx;
      const s=sideOf(knee);
      const hip=sm[s==="L"?IDX.HIP_L:IDX.HIP_R], kn=sm[s==="L"?IDX.KNEE_L:IDX.KNEE_R], an=sm[s==="L"?IDX.ANK_L:IDX.ANK_R];
      const conf=Math.min(vget(hip),vget(kn),vget(an));
      if(conf<0.5) return {valid:false,conf};
      const elevation=degFromHorizontal(hip,kn,asp);   // thigh angle above the floor
      const kneeAngle=angleAt(hip,kn,an,asp);          // ~180 when straight
      const kneeStraight = kneeAngle==null || kneeAngle>=155;
      return {value:elevation, valid:true, conf,
              gate: kneeStraight?undefined:false, postureCue: kneeStraight?undefined:"posture"};
    },
  },

  // ── Beacon 5 — Anchor Stance: single-leg stance (balance/sway) ──
  anchor:{
    id:"anchor", beacon:"Anchor Stance", exercise:"Single-leg stance", level:"BALANCE", unit:"sway",
    target:0, band:5, holdSecs:15, sets:5, restSecs:30, min:3, max:10, needsBaseline:true,
    targetLabel:"Postural sway allowed", view:"front",
    calMsg:"Stand <b>facing</b> the camera, full body in frame, support within reach. Lift one foot, then hold still.",
    safety:"⚠ Stay within arm’s reach of support. Lift one foot slightly. Stop if unsteady or pain &gt;4/10.",
    cues:{below:"Hold steady", above:"Too much sway — steady", posture:"Lift one foot to begin"},
    compute(ctx){
      const {sm,hipC,baseline}=ctx;
      const al=sm[IDX.ANK_L], ar=sm[IDX.ANK_R];
      const conf=Math.min(hipC.v, vget(al), vget(ar));
      if(conf<0.5) return {valid:false,conf};
      // one foot lifted → ankles at clearly different heights (normalised y)
      const footLifted = Math.abs(al.y-ar.y) > 0.06;
      // sway = displacement of hip-centre from the baseline captured at hold start
      const b = baseline || hipC;
      const sway = Math.hypot(hipC.x-b.x, hipC.y-b.y) * 100;   // ~% of frame
      return {value:sway, valid:true, conf,
              gate: footLifted?undefined:false, postureCue: footLifted?undefined:"posture"};
    },
  },

  // ── Beacon 7 — Keystone: glute bridge hold (supine) ──
  keystone:{
    id:"keystone", beacon:"Keystone", exercise:"Glute bridge hold", level:"GLUTES", unit:"°",
    target:160, band:15, holdSecs:20, sets:5, restSecs:30, min:130, max:180,
    targetLabel:"Hip extension (shoulder–hip–knee)", view:"side",
    calMsg:"Lie down <b>side-on</b>, knees bent, feet flat. Lift your hips so shoulder–hip–knee is a straight line.",
    safety:"⚠ Lie on your back, lift hips gently, pelvis level. Lower with control. Breathe. Stop if pain &gt;4/10.",
    cues:{below:"Lift your hips higher", above:"Lower slightly", posture:"Keep your pelvis level"},
    compute(ctx){
      const {sm,asp}=ctx;
      const s = sideOf(ctx.knee);
      const sh=sm[s==="L"?IDX.SH_L:IDX.SH_R], hp=sm[s==="L"?IDX.HIP_L:IDX.HIP_R], kn=sm[s==="L"?IDX.KNEE_L:IDX.KNEE_R];
      const conf=Math.min(vget(sh),vget(hp),vget(kn));
      if(conf<0.5) return {valid:false,conf};
      const ext=angleAt(sh,hp,kn,asp);                 // ~180 when hips fully extended
      if(ext==null) return {valid:false,conf};
      // pelvis level: the two hips should be at similar height
      const pelvisOk = Math.abs(sm[IDX.HIP_L].y - sm[IDX.HIP_R].y) < 0.08;
      return {value:ext, valid:true, conf,
              gate: pelvisOk?undefined:false, postureCue: pelvisOk?undefined:"posture"};
    },
  },
};

// MVP order (GDD §15.1). Extra beacons can be added later.
export const MVP_BEACONS = ["harbor","cliff","anchor","keystone"];
