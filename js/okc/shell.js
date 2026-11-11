// shell.js — shared OKC game shell: hub, control (pose+mouse), loop, HUD,
// session summary, progression, dashboard. Any game module that exports the
// standard def ({id,name,howto,calib,make}) plugs in here unchanged.
import { PoseController } from "./pose.js";
import { OKCSave, rankFor } from "./save.js";
import { Audio } from "../arcade/audio.js";
import QUAD from "./games/quad.js";
import SLR from "./games/slr.js";
import HEEL from "./games/heel.js";
import TKE from "./games/tke.js";
import TEMPO from "./games/tempo.js";
import HAM from "./games/ham.js";
import BAL from "./games/balance.js";
import { Sync, PAIN } from "./sync.js";
import { T, TX, initLang, setLang, getLang, applyDom, patchCanvas, speechLang, canSpeakCurrent } from "./i18n.js";

const $=id=>document.getElementById(id);
const stage=$("stage"), sctx=stage.getContext("2d"), video=$("video"), pip=$("pip"), pctx=pip.getContext("2d");
// language + participant context first: a signed-in participant who hasn't consented goes back to the consent step
{ const c0=Sync.context(); if(c0.needsConsent) location.replace("participant.html"); initLang(c0.lang); applyDom();
  if(getLang()==="ur"){ patchCanvas(sctx); patchCanvas(pctx); } }       // canvas text (cues, labels) is translated as it is drawn

// game registry — OKC order. Only built games are playable; rest are "coming soon".
const GAMES=[
  { def:QUAD },
  { def:SLR },
  { def:HEEL },
  { def:TKE },
  { def:TEMPO },
  { def:HAM },
  { def:BAL },        // static balance — a closed-chain category, shown under its own heading
];
const DIFFS=[
  { id:"gentle",  name:"Gentle",  desc:"Wide zone, short holds. Best to start." },
  { id:"steady",  name:"Steady",  desc:"A balanced challenge." },
  { id:"champion",name:"Champion",desc:"Tight zone, long holds." },
];
const ACH={ first:"first_okc", steady90:"okc_steady90", champ:"okc_champion", streak3:"okc_streak3" };
const HOLD_PRESETS=[3,5,8,12,20];           // seconds the patient must hold per rep
const REP_PRESETS=[3,5,8,10,15];            // number of reps in the set
// pace multiplier applied to a paced game's phase timings (e.g. Tempo Lift's ghost dot).
// >1 = more seconds per phase = a slower dot; <1 = fewer seconds = a faster one.
const PACE_PRESETS=[ {id:1.5,label:"Slower"}, {id:1.2,label:"Relaxed"}, {id:1,label:"Normal"}, {id:0.8,label:"Brisk"} ];
const GHOST_PRESETS=[ {id:1,label:"Ghost On"}, {id:0,label:"Ghost Off"} ];   // pacer dot shown / free-pace mode
let chosenGhost=true;
const CONF_GATE=0.4;                       // min tracking confidence to accept a frame (low-light friendly)
let chosenHold=8, chosenReps=5, chosenPace=1, extRef=null; // extRef = patient's calibrated full-extension angle
let balRef=null;                                            // balRef = patient's calibrated neutral stance (front-view balance game)

let W=0,H=0,DPR=1, scene="hub", mode="mouse", running=false, lastTs=0, countUntil=0;
let curDef=null, chosenDiff="gentle", game=null, ended=false, pointerNorm=0.5, pointerNormX=0.5;
const pose=new PoseController(); let camReady=false;

function resize(){ DPR=Math.min(devicePixelRatio||1,2); W=innerWidth; H=innerHeight;
  stage.width=W*DPR; stage.height=H*DPR; stage.style.width=W+"px"; stage.style.height=H+"px"; sctx.setTransform(DPR,0,0,DPR,0,0);
  pip.width=132; pip.height=99; if(game&&game.resize) game.resize(W,H); }
addEventListener("resize",resize); addEventListener("orientationchange",()=>setTimeout(resize,200));

const SCREENS=["hub","diffScreen","painScreen","calibScreen","sumScreen","dashScreen"];
function showScreen(id){ scene=id; for(const s of SCREENS) $(s).classList.toggle("on", s===id); $("hud").classList.toggle("on", id==="game");
  if(id!=="calibScreen"){ $("calibScreen").classList.remove("preview"); $("framehint").style.display="none"; } }
function toScene(id){ Audio.tap&&Audio.tap(); showScreen(id); if(id==="hub")refreshHub(); if(id==="dashScreen")renderDash(); }
function toast(m){ const t=$("toast"); t.textContent=m; t.style.opacity=1; clearTimeout(t._h); t._h=setTimeout(()=>t.style.opacity=0,1800); }
// ── voice guidance (so the patient can play by ear with the phone across the room) ──
let _spoke="", _spokeAt=0, _count=-1, _lastFb="";
function canSpeak(){ return !OKCSave.data.settings.muted && ("speechSynthesis" in window) && canSpeakCurrent(); }   // Urdu: only if the device has an Urdu voice
function say(text, rate=1.0){ if(!canSpeak())return; try{ speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(text); u.lang=speechLang(); u.rate=rate; u.pitch=1.05; speechSynthesis.speak(u);}catch(e){} }
function speakCue(text){ if(!text)return; const now=performance.now(); if(now-_spokeAt<1600)return; if(text===_spoke && now-_spokeAt<3200)return; _spoke=text; _spokeAt=now; say(cleanSpeak(text)); }
function cleanSpeak(t){ return t.replace(/[^\p{L}\p{N}\s.,!'’-]/gu,"").replace(/\s+/g," ").trim(); }

// ── hub ──
function refreshHub(){ const sc=Sync.context(), chip=$("studyChip"); chip.style.display=sc.studyId?"block":"none";
  chip.innerHTML = sc.studyId ? T("Participant {id}",{id:sc.studyId}) + (sc.viaStore ? ` · <a href="participant.html?signout=1" style="color:inherit">${T("Sign out")}</a>` : "") : "";
  $("extraLinks").style.display = sc.studyId ? "none" : "";                 // demo links (tracker, arcade) are not part of the study
  $("btnLang").textContent = getLang()==="ur" ? "English" : "اردو";
  const d=OKCSave.data; $("coinN").textContent=d.coins; $("rankN").textContent=T("Lv {n}",{n:rankFor(d.xp)}); $("streakN").textContent="🔥 "+d.streak; }
function buildHub(){ const g=$("gameGrid"); g.innerHTML=""; let lastGroup=null;
  GAMES.forEach((G,i)=>{ const def=G.def, id=def?def.id:G.id, name=def?def.name:G.name, emoji=def?def.emoji:G.emoji, ex=def?def.exercise:G.exercise;
    const grp=(def&&def.group)||null;                       // games outside the open-chain suite get their own heading
    if(i>0 && grp!==lastGroup && grp){ const h=document.createElement("div"); h.className="grouphead"; h.textContent=T(grp); g.appendChild(h); }
    lastGroup=grp;
    const best=OKCSave.best(id); const el=document.createElement("button"); el.className="pick game"+(G.soon?" locked":"");
    el.innerHTML=`<div class="emoji">${emoji}</div><div class="pn">${i+1}. ${T(name)}</div><div class="pd">${T(ex)}</div>`+
      (G.soon?`<div class="soon">${T("Coming soon")}</div>`:`<div class="stars">${"★".repeat(best.bestStars)}${"☆".repeat(3-best.bestStars)}</div>`);
    el.onclick=()=>{ if(G.soon){ toast(T("Building these next — Quad Press is ready!")); return; } curDef=def; openDiff(); Audio.tap&&Audio.tap(); };
    g.appendChild(el); }); }
function openDiff(){ $("diffTitle").textContent=T(curDef.name); $("diffHow").innerHTML=T(curDef.howto)+`<br><small>📷 ${T(curDef.camera)}</small>`;
  const g=$("diffGrid"); g.innerHTML=""; DIFFS.forEach(dd=>{ const el=document.createElement("button"); el.className="pick diff"; el.dataset.id=dd.id;
    el.innerHTML=`<div class="pn">${T(dd.name)}</div><div class="pd">${T(dd.desc)}</div>`; el.onclick=()=>{ chosenDiff=dd.id; sel("diff",dd.id); Audio.tap&&Audio.tap(); }; g.appendChild(el); });
  sel("diff",chosenDiff);
  const usesHold = curDef.usesHold!==false;
  $("holdLabel").style.display = usesHold?"block":"none";
  const hg=$("holdRow"); hg.innerHTML=""; hg.style.display = usesHold?"flex":"none";
  if(usesHold) HOLD_PRESETS.forEach(sec=>{ const el=document.createElement("button"); el.className="pick hold"; el.dataset.id=sec;
    el.style.width="92px"; el.innerHTML=`<div class="pn">${T("{n}s",{n:sec})}</div>`; el.onclick=()=>{ chosenHold=sec; sel("hold",sec); Audio.tap&&Audio.tap(); }; hg.appendChild(el); });
  sel("hold",chosenHold);
  const usesGhostToggle = !!curDef.usesGhostToggle;
  $("ghostLabel").style.display = usesGhostToggle?"block":"none";
  const gr=$("ghostRow"); gr.innerHTML=""; gr.style.display = usesGhostToggle?"flex":"none";
  const applyPaceVis=()=>{ const show=!!curDef.usesPace && (!usesGhostToggle || chosenGhost);   // pace only matters while the ghost is on
    $("paceLabel").style.display = show?"block":"none"; $("paceRow").style.display = show?"flex":"none"; };
  if(usesGhostToggle) GHOST_PRESETS.forEach(p=>{ const el=document.createElement("button"); el.className="pick ghost"; el.dataset.id=p.id;
    el.style.width="110px"; el.innerHTML=`<div class="pn">${T(p.label)}</div>`; el.onclick=()=>{ chosenGhost=!!p.id; sel("ghost",p.id); applyPaceVis(); Audio.tap&&Audio.tap(); }; gr.appendChild(el); });
  sel("ghost",chosenGhost?1:0);
  const usesPace = !!curDef.usesPace;
  const pg=$("paceRow"); pg.innerHTML="";
  if(usesPace) PACE_PRESETS.forEach(p=>{ const el=document.createElement("button"); el.className="pick pace"; el.dataset.id=p.id;
    el.style.width="92px"; el.innerHTML=`<div class="pn">${T(p.label)}</div>`; el.onclick=()=>{ chosenPace=p.id; sel("pace",p.id); Audio.tap&&Audio.tap(); }; pg.appendChild(el); });
  sel("pace",chosenPace); applyPaceVis();
  const rg=$("repRow"); rg.innerHTML=""; REP_PRESETS.forEach(n=>{ const el=document.createElement("button"); el.className="pick reps"; el.dataset.id=n;
    el.style.width="92px"; el.innerHTML=`<div class="pn">${n}</div>`; el.onclick=()=>{ chosenReps=n; sel("reps",n); Audio.tap&&Audio.tap(); }; rg.appendChild(el); });
  sel("reps",chosenReps);
  showScreen("diffScreen"); }
function sel(cls,id){ document.querySelectorAll("."+cls).forEach(e=>e.classList.toggle("sel",e.dataset.id==id)); }

// ── flow ──
$("btnPlayHub")&&($("btnPlayHub").onclick=()=>{ Audio.init(); Audio.resume(); Audio.startMusic(); });
$("btnDash").onclick=()=>toScene("dashScreen");
$("btnDashBack").onclick=()=>toScene("hub");
$("btnDiffBack").onclick=()=>toScene("hub");
$("btnDiffNext").onclick=()=>{ Audio.init(); Audio.resume(); beginSession(); };
$("btnPause").onclick=()=>{
  if(Sync.active && game && sess && !ended && running) Sync.submit(sessionRecord(game.status(), "abandoned", null));   // keep partial sessions for adherence analysis
  running=false; pose.stop(); camReady=false; Audio.stopMusic(); toScene("hub"); };

// ── study participants: pain check before / after each session (0–10), session record hand-off ──
let painBefore=null, sess=null;
const r1=v=>v==null?null:Math.round(v*10)/10;
function beginSession(){
  if(!Sync.active){ openCalib(); return; }                       // anonymous visitor: flow unchanged
  openPain("before",(n,skip)=>{ painBefore=n;
    if(skip){ sess={ t0:performance.now(), wall0:Date.now() }; Sync.submit(sessionRecord({reps:0,score:0,stars:0,completed:false},"skipped_pain",null)); sess=null; toScene("hub"); }
    else openCalib(); }); }
function openPain(kind, done){
  $("painTitle").textContent = T(kind==="before" ? "How is your knee pain right now?" : "How does your knee feel now?");
  $("painSub").textContent = T(kind==="before" ? "Before we start — tap a number." : "After the exercise — tap a number.");
  $("painAdvice").style.display="none";
  const g=$("painGrid"); g.innerHTML="";
  for(let n=0;n<=10;n++){ const el=document.createElement("button"); el.className="pick"; el.style.width="64px"; el.style.padding="12px 0";
    el.innerHTML=`<div class="pn" style="margin:0;font-size:20px">${n}</div>`; el.onclick=()=>{ Audio.tap&&Audio.tap(); painChosen(kind,n,done); }; g.appendChild(el); }
  showScreen("painScreen"); }
function painChosen(kind,n,done){
  if(n < (kind==="before"?PAIN.adviseBefore:PAIN.adviseAfter)){ done(n,false); return; }
  $("painAdviceText").textContent = kind==="before"
    ? T("Your pain is {n}/10 today. It is safest to skip this exercise and tell your therapist.",{n})
    : T("Your pain is {n}/10. Please rest, and tell your therapist how you feel.",{n});
  $("painSkip").style.display = kind==="before" ? "inline-flex" : "none";
  $("painGo").textContent = T(kind==="before" ? "Continue anyway" : "OK");
  $("painAdvice").style.display="block";
  $("painGo").onclick=()=>done(n,false); $("painSkip").onclick=()=>done(n,true); }
function trackSession(m){                                          // peak knee angles / balance shift across the session
  if(!sess || !m || !m.tracked) return;
  if(m.kneeAngle!=null){ sess.minAng = sess.minAng==null ? m.kneeAngle : Math.min(sess.minAng,m.kneeAngle); sess.maxAng = sess.maxAng==null ? m.kneeAngle : Math.max(sess.maxAng,m.kneeAngle); }
  if(m.bal && m.bal.ok){ const sh=m.bal.shift-(balRef?balRef.shift0:0); sess.balL = sess.balL==null?sh:Math.max(sess.balL,sh); sess.balR = sess.balR==null?sh:Math.min(sess.balR,sh); } }
function sessionRecord(r, status, painAfter){
  const s=sess||{}, d=curDef;
  return { type:"session", status, game:d.id, gameName:d.name, exercise:d.exercise, difficulty:chosenDiff,
    repsTarget: game?game.repsTarget:chosenReps, repsDone:r.reps||0, completed:!!r.completed, stars:r.stars||0, score:r.score||0, qualityPct: r.quality==null?null:r.quality,
    durationSec: s.t0?Math.round((performance.now()-s.t0)/1000):null,
    holdSecs: d.usesHold!==false?chosenHold:null, paceMult: d.usesPace?chosenPace:null, ghost: d.usesGhostToggle?chosenGhost:null,
    inputMode: mode, extRefDeg:r1(s.extRef), kneeAngleMinDeg:r1(s.minAng), kneeAngleMaxDeg:r1(s.maxAng),
    peakFlexionDeg: (s.minAng!=null&&s.extRef!=null)?r1(Math.max(0,s.extRef-s.minAng)):null,
    balShiftMaxLeft:r1(s.balL), balShiftMaxRight:r1(s.balR),
    painBefore, painAfter, startedAt:s.wall0?new Date(s.wall0).toISOString():null, endedAt:new Date().toISOString() }; }
$("btnMute").onclick=()=>{ const m=!OKCSave.data.settings.muted; OKCSave.data.settings.muted=m; OKCSave.save(); Audio.setMuted(m); $("btnMute").textContent=m?"🔇":"🔊"; };
$("btnMute").textContent=OKCSave.data.settings.muted?"🔇":"🔊"; Audio.setMuted(OKCSave.data.settings.muted);

function openCalib(){ showScreen("calibScreen"); $("calibScreen").classList.remove("preview"); $("framehint").style.display="none";
  $("calCamRow").style.display="flex"; $("calBody").style.display="none"; $("spin").style.display="none"; $("pipWrap").style.display="none";
  extRef=null; balRef=null;
  const ext = curDef.calib==="extension", balc = curDef.calib==="balance", front = curDef.view==="front";
  pose.setView(front?"front":"side");               // front = standing balance (person faces the camera); side = knee-angle games
  $("calLabel").textContent = T(front ? "WEIGHT ON EACH LEG (estimate)" : "YOUR KNEE (from straight)");
  $("calZone").textContent = T(front ? "Stand facing the camera, whole body in view" : "Sit side-on, whole leg visible");
  $("framehint").textContent = T(front ? "Stand facing the camera — head to feet in the frame" : "Get your whole body side-on in the frame (head to feet)");
  $("calHint").textContent = T(front
    ? "Stand FACING the camera, ~2.5 m back, feet shoulder-width apart on a firm, flat floor, in good light. Keep a counter or sturdy chair within reach."
    : "Sit or lie side-on with your WHOLE BODY in view (head to feet), ~2 m back, in good light. The tracker needs to see your body — not just the leg.");
  $("calCam").onclick=async()=>{ mode="camera"; $("calCamRow").style.display="none"; $("spin").style.display="block";
    try{ await pose.load(t=>$("calHint").textContent=T(t)); await pose.startCamera(video); camReady=true; running=true; camLoop();
      $("spin").style.display="none"; $("calBody").style.display="block"; $("pipWrap").style.display="none"; $("calHint").textContent="";
      $("calSet").style.display = (ext||balc)?"inline-flex":"none"; $("calSet").textContent = T(ext?"🎯 Capture extension":balc?"🎯 Set centre":"🎯 Set 0°");
      $("calSteps2").innerHTML = T(ext
        ? "Position your leg, then <b>straighten fully</b> & tap <b>Capture</b>, then <b>Start</b>."
        : balc ? "Stand tall with your weight <b>even on both feet</b>, then tap <b>Set centre</b>, then <b>Start</b>."
        : "Position your leg in the frame, then press <b>Start</b>."); }
    catch(e){ $("spin").style.display="none"; $("calCamRow").style.display="flex";
      const denied=/denied|permission|NotAllowed/i.test(e.name+e.message);
      $("calHint").innerHTML = denied
        ? T("⚠ Camera blocked. Tap <b>Play with camera</b> again and choose <b>Allow</b>. On a phone use Chrome/Safari (an embedded preview can't use the camera).")
        : T("Camera error:")+" "+(e.message||e); } };
  $("calMouse").style.display = Sync.context().source==="android" ? "none" : "";   // in the patient app only the camera counts
  $("calMouse").onclick=()=>{ mode="mouse"; $("pipWrap").style.display="none"; startGame(); };
  $("calSet").onclick=()=>{
    if(curDef.calib==="balance"){ const bl=pose.m.bal;
      if(bl && bl.ok && bl.stanceOk){ balRef={ shift0:bl.shift, trunk0:bl.trunkLean, dyN0:bl.dyN }; toast(T("Centre set — this is your even-weight position")); }
      else toast(T("Face the camera, stand tall, feet shoulder-width apart first")); return; }
    if(pose.m.kneeAngle!=null && pose.m.tracked){ extRef=pose.m.kneeAngle; toast(T("Captured full extension: {n}°",{n:Math.round(extRef)})); }
    else toast(T("Straighten your leg in view first")); };
  $("calGo").onclick=startGame;
}
// lightweight pose loop during calibration (before game starts)
function camLoop(){ if(!camReady || scene!=="calibScreen") return; requestAnimationFrame(camLoop); const now=performance.now(); pose.frame(now);
  $("calibScreen").classList.add("preview"); $("framehint").style.display="block";
  pose.drawScene(sctx, W, H);                       // full-screen live camera + skeleton
  if(curDef.view==="front"){ camLoopFront(); return; }
  const a=pose.m.kneeAngle, conf=Math.round((pose.m.conf||0)*100), good=pose.m.tracked && (pose.m.conf||0)>=CONF_GATE;
  const anyPose = !!(pose.lastRes && pose.lastRes.landmarks && pose.lastRes.landmarks.length);
  $("calNow").textContent = pose.m.kneeAngleDisp!=null? Math.round(pose.m.kneeAngleDisp)+"°":"—";
  const b=$("calZone");
  if(!anyPose){ b.textContent=T("📷 No body detected — step back so your whole body is in view"); b.style.color="#ff6f6f"; }
  else if(!pose.m.bodyOk){ b.textContent=T("⚠ Only part of you is in frame — step back so your shoulders AND legs are both visible (not just an arm)"); b.style.color="#ff9ec7"; }
  else if(!pose.m.sideOnOk){ b.textContent=T("⚠ Turn side-on to the camera — sitting/facing it straight-on can't be read as a knee"); b.style.color="#ff9ec7"; }
  else if(a==null||!good){ b.textContent=T("⚠ Weak tracking ({c}%) — turn side-on, better light, whole leg visible",{c:conf}); b.style.color="#ffb84d"; }
  else if(curDef.calib==="extension"){ b.textContent = extRef!=null ? T("✓ Captured {a}° · conf {c}%",{a:Math.round(extRef),c:conf}) : T("✓ Tracking {c}% — straighten & Capture",{c:conf}); b.style.color="#8affc0"; }
  else { b.textContent=T("✓ Tracking {c}% — ready",{c:conf}); b.style.color="#8affc0"; } }

// calibration read-out for front-view (standing balance) games
function camLoopFront(){
  const bl=pose.m.bal, conf=Math.round((pose.m.conf||0)*100), b=$("calZone");
  const anyPose = !!(pose.lastRes && pose.lastRes.landmarks && pose.lastRes.landmarks.length);
  if(bl && bl.ok){ const s=bl.shift-(balRef?balRef.shift0:0), wl=Math.round(100*Math.max(0,Math.min(1,0.5+0.5*s)));
    $("calNow").textContent=T("L {l}% · R {r}%",{l:wl,r:100-wl}); } else $("calNow").textContent="—";
  if(!anyPose){ b.textContent=T("📷 No body detected — step back so your whole body is in view"); b.style.color="#ff6f6f"; }
  else if(!bl || !bl.bodyOk){ b.textContent=T("⚠ Step back — your whole body, head to feet, must be in view"); b.style.color="#ff9ec7"; }
  else if(!bl.frontOk){ b.textContent=T("↻ Face the camera — stand square-on to it"); b.style.color="#ff9ec7"; }
  else if(!bl.standingOk){ b.textContent=T("🧍 Stand up — this game is done standing"); b.style.color="#ff9ec7"; }
  else if(!bl.stanceOk){ b.textContent=T("↔ Feet shoulder-width apart please"); b.style.color="#ffb84d"; }
  else if(balRef){ b.textContent=T("✓ Centre set · conf {c}%",{c:conf}); b.style.color="#8affc0"; }
  else { b.textContent=T("✓ Tracking {c}% — stand tall, weight even, then tap Set centre",{c:conf}); b.style.color="#8affc0"; }
}

function startGame(){ ended=false; _lastFb=""; _count=-1; showScreen("game"); $("hud").classList.add("on");
  $("hud").classList.toggle("fbTop", !!curDef.hudFeedbackTop);
  $("calibScreen").classList.remove("preview"); $("framehint").style.display="none";
  say(T(curDef.name)+". "+T(curDef.exercise||""), 1.0);
  $("pipWrap").style.display = mode==="camera" ? "block" : "none";
  const er = extRef!=null ? extRef : (pose.m.kneeAngle||178);   // fall back to current straight reading
  game=curDef.make({ W,H, difficulty:chosenDiff, holdSecs:chosenHold, repsTarget:chosenReps, paceMult:chosenPace, ghost:chosenGhost, extRef:er, balRef, audio:Audio, onEvent:onGameEvent });
  $("gTitle").textContent=T(curDef.name);
  sess={ t0:performance.now(), wall0:Date.now(), extRef:er, minAng:null, maxAng:null, balL:null, balR:null };
  countUntil=performance.now()+3000; running=true; lastTs=performance.now(); requestAnimationFrame(loop); }

function onGameEvent(e){
  if(e.type==="rep"){ say(T("Rep {n}",{n:e.reps})); _spokeAt=performance.now(); }
  if(e.type==="end" && !ended){ ended=true; running=false; endGame(e); } }
// per-game mouse-preview metrics (falls back to a knee-flex mapping)
function mouseMetricsFor(p,px){ return (curDef&&curDef.mouseMetrics) ? curDef.mouseMetrics(p,px)
  : { tracked:true, conf:1, flex:p*90, kneeFlex:p*90, kneeAngle:180-p*90, hipAngle:150, ankle:{x:.5,y:p}, side:"L" }; }

// ── main loop ──
function loop(now){ if(!running) return; requestAnimationFrame(loop);
  const dt=Math.min(0.05,(now-lastTs)/1000)||0; lastTs=now;
  let m;
  if(mode==="camera"){ m=pose.frame(now); if(m.tracked && (m.conf||0)<CONF_GATE) m.tracked=false;  // require high confidence
    m.flex = (m.tracked && m.kneeFlex!=null)? (m.kneeFlex - pose.zero) : null; }
  else { m=mouseMetricsFor(pointerNorm, pointerNormX); }
  renderBg(now);
  if(now<countUntil){ const c=Math.ceil((countUntil-now)/1000); $("countbig").style.display="flex"; $("countbig").textContent=c;
    if(c!==_count){ _count=c; Audio.tap&&Audio.tap(); say(String(c),1.1); } }
  else { $("countbig").style.display="none"; if(_count!==0){ _count=0; say(T("Go!"),1.1); } if(game&&!game.done){ game.update(dt,m,now); trackSession(m); } }
  if(game) game.render(sctx,now);
  if(mode==="camera") pose.drawScene(pctx,pip.width,pip.height);
  const s=game?game.status():null; if(s){ updateHUD(s);
    const ft=s.feedback&&s.feedback.text; if(ft && ft!==_lastFb){ _lastFb=ft; speakCue(TX(ft)); } }
  if(s&&s.done&&!ended){ ended=true; endGame(s.result); }
}
let bgStars=null;
function renderBg(now){ const g=sctx.createLinearGradient(0,0,0,H); g.addColorStop(0,"#101a4a"); g.addColorStop(0.6,"#241a54"); g.addColorStop(1,"#3a1f52");
  sctx.fillStyle=g; sctx.fillRect(0,0,W,H);
  if(!bgStars) bgStars=Array.from({length:60},()=>({x:Math.random()*W,y:Math.random()*H*0.7,s:Math.random()*2+0.5,p:Math.random()*7}));
  for(const s of bgStars){ sctx.globalAlpha=0.25+0.5*Math.abs(Math.sin(s.p+now/1200)); sctx.fillStyle="#fff"; sctx.fillRect(s.x,s.y,s.s,s.s); } sctx.globalAlpha=1; }

function updateHUD(s){ $("progBar").style.width=Math.round(s.progress*100)+"%"; $("scoreN").textContent=s.score; $("repsN").textContent=`${s.reps}/${s.repsTarget}`;
  const fb=$("fbBanner"); fb.textContent=TX(s.feedback.text); fb.style.color=s.feedback.color; fb.style.opacity=s.feedback.text?1:0; }

// ── summary + progression ──
function endGame(r){ running=false; pose.stop(); camReady=false; Audio.stopMusic(); Audio.victory&&Audio.victory();
  if(Sync.active) openPain("after", n=>finishSession(r,n)); else finishSession(r,null); }   // study participants rate their pain first
function finishSession(r, painAfter){
  if(Sync.active){ Sync.submit(sessionRecord(r, r.completed?"completed":"ended", painAfter)); sess=null; }
  setTimeout(()=>say(T(r.completed?"Exercise complete. Great job!":"Session ended.")),300);
  const xp = r.completed? 40 + r.stars*30 + Math.round((r.quality||0)/3) : 15;
  const coins = r.completed? 15 + r.stars*10 : 5;
  OKCSave.addXP(xp); OKCSave.addCoins(coins); const streak=OKCSave.touchStreak();
  OKCSave.record({ game:curDef.id, stars:r.stars, score:r.score, reps:r.reps, quality:r.quality, completed:r.completed });
  const newAch=[];
  if(r.completed && OKCSave.unlock(ACH.first)) newAch.push(T("First Rep"));
  if((r.quality||0)>=90 && OKCSave.unlock(ACH.steady90)) newAch.push(T("Steady Hand"));
  if(chosenDiff==="champion" && r.completed && OKCSave.unlock(ACH.champ)) newAch.push(T("Champion"));
  if(streak>=3 && OKCSave.unlock(ACH.streak3)) newAch.push(T("On a Roll"));
  showSummary(r,xp,coins,streak,newAch);
}
function showSummary(r,xp,coins,streak,newAch){ showScreen("sumScreen");
  $("sumTitle").textContent=(curDef?T(curDef.name)+" — ":"")+T(r.completed?"Complete!":"Session Ended");
  const se=$("sumStars"); se.innerHTML=""; for(let i=0;i<3;i++){ const s=document.createElement("span"); s.className="bigstar"+(i<r.stars?" lit":""); s.textContent="★"; s.style.animationDelay=(i*0.22)+"s"; se.appendChild(s); }
  $("sumStats").innerHTML=`
    <div class="crow"><span>${T("Reps completed")}</span><b>${r.reps}</b></div>
    <div class="crow"><span>${T("Hold quality")}</span><b>${r.quality||0}%</b></div>
    <div class="crow"><span>${T("Score")}</span><b>${r.score}</b></div>
    <div class="crow xp"><span>${T("+ XP")}</span><b>${xp}</b></div>
    <div class="crow coin"><span>${T("+ Coins")}</span><b>${coins} 🪙</b></div>
    <div class="crow"><span>${T("Day streak")}</span><b>🔥 ${streak}</b></div>`;
  $("sumAch").textContent = newAch.length? "🏅 "+newAch.join(", ") : "";
}
$("btnReplay").onclick=()=>{ Audio.startMusic(); beginSession(); };
$("btnSumHome").onclick=()=>toScene("hub");

// ── dashboard ──
function renderDash(){ const d=OKCSave.data;
  $("dTiles").innerHTML=`
    <div class="tile"><div class="tv">${T("Lv {n}",{n:rankFor(d.xp)})}</div><div class="tl">${T("rank")}</div></div>
    <div class="tile"><div class="tv">${d.xp}</div><div class="tl">${T("XP")}</div></div>
    <div class="tile"><div class="tv">${d.coins}</div><div class="tl">${T("coins")}</div></div>
    <div class="tile"><div class="tv">🔥 ${d.streak}</div><div class="tl">${T("streak")}</div></div>`;
  $("dGames").innerHTML=GAMES.map(G=>{ const id=G.def?G.def.id:G.id, name=G.def?G.def.name:G.name, b=OKCSave.best(id);
    return `<div class="crow"><span>${G.def?G.def.emoji:G.emoji} ${T(name)}</span><b>${G.soon?"—":`${T("{n} plays",{n:b.plays})} · ${"★".repeat(b.bestStars)||"—"}`}</b></div>`; }).join("");
  const hist=d.history.slice(-10), cv=$("dChart"), cx=cv.getContext("2d"); cv.width=cv.clientWidth*2; cv.height=120*2; cx.scale(2,2);
  const w=cv.clientWidth,h=120; cx.clearRect(0,0,w,h);
  if(hist.length){ const bw=w/hist.length; hist.forEach((s,i)=>{ const bh=(s.quality||0)/100*(h-24); cx.fillStyle="#37e1ff"; cx.fillRect(i*bw+bw*0.2,h-16-bh,bw*0.6,bh);
    cx.fillStyle="#9aa6d4"; cx.font="9px sans-serif"; cx.textAlign="center"; cx.fillText((s.stars||0)+"★",i*bw+bw*0.5,h-4); });
    cx.fillStyle="#9aa6d4"; cx.font="10px sans-serif"; cx.textAlign="left"; cx.fillText(T("Hold quality % (last {n})",{n:hist.length}),4,12); }
  else { cx.fillStyle="#9aa6d4"; cx.font="12px sans-serif"; cx.fillText(T("No sessions yet — play Quad Press!"),8,60); } }

// pointer control
function ptr(e){ const t=e.touches?e.touches[0]:e, y=t.clientY, x=t.clientX; pointerNorm=Math.max(0,Math.min(1,y/H)); pointerNormX=Math.max(0,Math.min(1,x/W)); }
stage.addEventListener("mousemove",ptr); stage.addEventListener("touchmove",e=>{ptr(e);e.preventDefault();},{passive:false}); stage.addEventListener("touchstart",ptr);

// language toggle (hub): saved on the device; inside the Android app the app is told too, since it owns the language there
$("btnLang").onclick=()=>{ const next=getLang()==="ur"?"en":"ur"; setLang(next); try{ window.AndroidBridge&&window.AndroidBridge.setLang&&window.AndroidBridge.setLang(next); }catch(e){}
  const u=new URL(location.href); u.searchParams.delete("lang"); location.replace(u.toString()); };
// boot
resize(); buildHub(); refreshHub(); showScreen("hub"); Sync.flush().catch(()=>{});
// test hook
window.__okc={ scene:()=>scene,
  openGame:(id,hold,reps)=>{ const G=GAMES.find(g=>g.def&&g.def.id===id); curDef=(G&&G.def)||QUAD; chosenDiff="gentle"; if(hold)chosenHold=hold; if(reps)chosenReps=reps; mode="mouse"; startGame(); },
  forcePlay:()=>{countUntil=0;}, setPointer:(v,x)=>{pointerNorm=v; if(x!=null)pointerNormX=x;},
  step:(dt)=>{ if(!game)return; const mm=mouseMetricsFor(pointerNorm, pointerNormX); game.update(dt||0.05, mm, performance.now()); trackSession(mm); },
  status:()=>game?game.status():null };
