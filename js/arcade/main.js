// main.js — Crystal Guardian orchestration: scenes, pose/mouse control, HUD,
// progression, and wiring of engine (game), audio, save, pose + hold logic.
import { FilesetResolver, PoseLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12";
import { OneEuro, detectView, KneeMeter, KNEES, vis, VIS_DRAW } from "../core.js";
import { HoldDetector } from "../holdDetector.js";
import { CHARACTERS, DIFFICULTIES, LEVELS, ACHIEVEMENTS, rankFor, xpForRank, rankTitle } from "./config.js";
import { Save } from "./save.js";
import { Audio } from "./audio.js";
import { CrystalGuardian } from "./game.js";

const POSE_MODEL="https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";
const WASM="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/wasm";
const $=id=>document.getElementById(id);
const stage=$("stage"), sctx=stage.getContext("2d"), video=$("video"), pip=$("pip"), pctx=pip.getContext("2d");

let W=0,H=0,DPR=1;
let scene="home", mode="mouse", running=false, lastTs=0;
let chosenChar=CHARACTERS[0], chosenDiff=DIFFICULTIES[0], chosenLevel=LEVELS[0];
let game=null, det=null, hold={tracked:false,inBand:false,steadiness:0,holdTime:0}, countUntil=0;
// pose
let landmarker=null, stream=null, facing="user", camActive=false, lastVideoTime=-1, lastRes=null;
const fX=[],fY=[]; for(let i=0;i<33;i++){fX[i]=new OneEuro();fY[i]=new OneEuro();}
const meter=new KneeMeter(); let flex=null, flexConf=0, flexSmooth=new OneEuro(1.5,0.4), calZero=0;
let pointerNorm=0.5, invert=Save.data.settings.invert;

// ── sizing ──
function resize(){ DPR=Math.min(window.devicePixelRatio||1,2); W=innerWidth; H=innerHeight;
  stage.width=W*DPR; stage.height=H*DPR; stage.style.width=W+"px"; stage.style.height=H+"px"; sctx.setTransform(DPR,0,0,DPR,0,0);
  pip.width=132; pip.height=99; if(game) game.resize(W,H); }
addEventListener("resize",resize); addEventListener("orientationchange",()=>setTimeout(resize,200));

// ── scene manager ──
const SCREENS=["home","charsel","diffsel","tutorial","calib","complete","dashboard"];
function showScreen(id){ scene=id; for(const s of SCREENS) $(s).classList.toggle("on", s===id);
  $("hud").classList.toggle("on", id==="game"); if(id&&id!=="game") { /* menus */ } }
function toScene(id){ Audio.tap(); showScreen(id); if(id==="home")refreshHome(); if(id==="dashboard")renderDashboard(); }

// ── home / hud chrome ──
function refreshHome(){ const d=Save.data, r=rankFor(d.xp);
  $("coinN").textContent=d.coins; $("rankN").textContent="Lv "+r; $("streakN").textContent="🔥 "+d.streak;
  $("homeSub").textContent = d.xp>0 ? `${rankTitle(r)} · ${d.xp} XP` : "Tap Play to begin your watch"; }

// ── character select ──
function buildChars(){ const g=$("charGrid"); g.innerHTML="";
  CHARACTERS.forEach(c=>{ const el=document.createElement("button"); el.className="pick char"; el.dataset.id=c.id;
    el.innerHTML=`<div class="emoji" style="filter:drop-shadow(0 0 10px ${c.color})">${c.emoji}</div>
      <div class="pn">${c.name}</div><div class="pd">${c.desc}</div>`;
    el.onclick=()=>{ chosenChar=c; Save.data.character=c.id; Save.save(); markSel("char",c.id); Audio.tap(); };
    g.appendChild(el); }); markSel("char",Save.data.character); chosenChar=CHARACTERS.find(c=>c.id===Save.data.character)||CHARACTERS[0]; }
function buildDiffs(){ const g=$("diffGrid"); g.innerHTML="";
  DIFFICULTIES.forEach(dd=>{ const el=document.createElement("button"); el.className="pick diff"; el.dataset.id=dd.id;
    el.innerHTML=`<div class="pn">${dd.name}</div><div class="pd">${dd.desc}</div>`;
    el.onclick=()=>{ chosenDiff=dd; markSel("diff",dd.id); Audio.tap(); }; g.appendChild(el); }); markSel("diff",chosenDiff.id); }
function buildLevels(){ const g=$("levelRow"); if(!g)return; g.innerHTML="";
  LEVELS.forEach(l=>{ const locked=l.id>Save.data.unlockedLevel; const st=Save.data.bestStars[l.id]||0;
    const el=document.createElement("button"); el.className="pick lvl"+(locked?" locked":""); el.dataset.id=l.id;
    el.innerHTML=`<div class="pn">${locked?"🔒 ":""}${l.name}</div><div class="stars">${"★".repeat(st)}${"☆".repeat(3-st)}</div>`;
    el.onclick=()=>{ if(locked){toast("Finish the previous mission to unlock");return;} chosenLevel=l; markSel("lvl",l.id); Audio.tap(); };
    g.appendChild(el); }); chosenLevel=LEVELS.find(l=>l.id<=Save.data.unlockedLevel)||LEVELS[0]; markSel("lvl",chosenLevel.id); }
function markSel(cls,id){ document.querySelectorAll("."+cls).forEach(e=>e.classList.toggle("sel", e.dataset.id==id)); }

// ── flow ──
$("btnPlay").onclick=()=>{ Audio.init(); Audio.resume(); Audio.startMusic(); buildChars(); toScene("charsel"); };
$("btnCharNext").onclick=()=>{ buildDiffs(); buildLevels(); toScene("diffsel"); };
$("btnDiffNext").onclick=()=>{ if(!Save.data.tutorialDone){ toScene("tutorial"); } else startPreGame(); };
$("btnTutNext").onclick=()=>{ Save.data.tutorialDone=true; Save.save(); startPreGame(); };
$("btnDash").onclick=()=>toScene("dashboard");
$("btnDashBack").onclick=()=>toScene("home");
$("btnCharBack").onclick=()=>toScene("home");
$("btnDiffBack").onclick=()=>toScene("charsel");
$("btnPause").onclick=()=>{ running=false; camActive=false; Audio.stopMusic(); toScene("home"); };

function startPreGame(){ // choose control mode
  showScreen("calib");
  $("calCam").onclick=async()=>{ mode="camera"; $("calCamRow").style.display="none"; $("spin").style.display="block";
    try{ if(!landmarker)await loadModel(); await startCamera(); camActive=true; poseLoop(); $("spin").style.display="none"; $("calSteps").style.display="block"; $("pipWrap").style.display="block"; }
    catch(e){ $("spin").style.display="none"; $("calCamRow").style.display="flex"; $("calHint").textContent="Camera error: "+(e.message||e); } };
  $("calMouse").onclick=()=>{ mode="mouse"; $("pipWrap").style.display="none"; beginCountdown(); };
  $("calSet").onclick=()=>{ if(flex!=null){ calZero=flex; toast("Zeroed — now bend to the glowing zone"); } else toast("Straighten your leg in view first"); };
  $("calGo").onclick=beginCountdown;
  $("calCamRow").style.display="flex"; $("calSteps").style.display="none"; $("spin").style.display="none";
  $("calHint").textContent="Sit side-on so your whole leg is visible.";
}

function beginCountdown(){ showScreen("game"); $("hud").classList.add("on");
  chosenLevel = chosenLevel||LEVELS[0];
  det=new HoldDetector({ target:chosenLevel.target, band:chosenDiff.band, holdSecs:9999, jitterTol:chosenDiff.steadyTol, steadyWin:20 });
  game=new CrystalGuardian({ W,H, difficulty:chosenDiff, character:chosenChar, level:chosenLevel, onEvent:onGameEvent });
  countUntil=performance.now()+3000; running=true; lastTs=performance.now(); requestAnimationFrame(loop);
}

// ── main loop ──
function loop(now){ if(!running) return; requestAnimationFrame(loop);
  const dt=Math.min(0.05,(now-lastTs)/1000)||0; lastTs=now;
  // control → hold state
  let value=null;
  if(mode==="mouse"){ let n=pointerNorm; value=(invert? n : 1-n)*90; /* map pointer to a 0..90 pseudo-angle */ value=Math.abs(value-chosenLevel.target)<=chosenDiff.band? value : value; }
  else if(flex!=null){ value=flex-calZero; }
  const st = det.update(value==null?null:value, now/1000);
  hold={ tracked: value!=null, inBand: st.inBand, steadiness: st.brightness, holdTime: st.holdTime };
  // countdown gate
  if(now<countUntil){ $("countbig").style.display="flex"; $("countbig").textContent=Math.ceil((countUntil-now)/1000); }
  else { $("countbig").style.display="none"; if(game && game.phase!=="done"){ game.update(dt, hold, now); } }
  renderBackground(now); if(game) game.render(sctx, now); if(mode==="camera") drawPip();
  updateHUD();
}

// ── background (animated aurora sky + stars) ──
let bgStars=null;
function renderBackground(now){ const sky=chosenLevel.sky;
  const g=sctx.createLinearGradient(0,0,0,H); g.addColorStop(0,sky[0]); g.addColorStop(0.5,sky[1]); g.addColorStop(1,sky[2]);
  sctx.fillStyle=g; sctx.fillRect(0,0,W,H);
  if(!bgStars){ bgStars=Array.from({length:70},()=>({x:Math.random()*W,y:Math.random()*H*0.7,s:Math.random()*2+0.5,p:Math.random()*7})); }
  for(const s of bgStars){ sctx.globalAlpha=0.3+0.5*Math.abs(Math.sin(s.p+now/1200)); sctx.fillStyle="#fff"; sctx.fillRect(s.x,s.y,s.s,s.s); }
  sctx.globalAlpha=1;
  // aurora ribbons
  for(let k=0;k<2;k++){ sctx.beginPath(); const yy=H*(0.25+k*0.12);
    for(let x=0;x<=W;x+=24){ const y=yy+Math.sin(x/140+now/1800+k*2)*30; x?sctx.lineTo(x,y):sctx.moveTo(x,y); }
    sctx.lineWidth=40; sctx.strokeStyle=`${hexA(chosenLevel.accent,0.05)}`; sctx.stroke(); }
  // ground glow
  const gg=sctx.createLinearGradient(0,H*0.7,0,H); gg.addColorStop(0,"rgba(0,0,0,0)"); gg.addColorStop(1,"rgba(0,0,0,0.4)"); sctx.fillStyle=gg; sctx.fillRect(0,H*0.7,W,H*0.3);
}
function hexA(hex,a){ const n=parseInt(hex.slice(1),16); return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`; }

// ── HUD ──
function updateHUD(){ if(!game)return;
  $("waveTxt").textContent=`Wave ${game.wave}/${game.waves}`;
  $("hpBar").style.width=Math.max(0,game.hp/game.maxHp*100)+"%";
  $("novaBar").style.width=(game.charge*100)+"%";
  const fb=$("fbBanner");
  if(!hold.tracked){ fb.textContent="Step into frame"; fb.style.color="#ffb84d"; fb.style.opacity=1; }
  else if(hold.inBand){ fb.textContent = hold.steadiness>0.6?"Shield strong — hold it! ✨":"Hold steady…"; fb.style.color="#8affc0"; fb.style.opacity=1; }
  else { fb.textContent="Move to the target zone"; fb.style.color="#ffb84d"; fb.style.opacity=1; }
}

// ── game events ──
function onGameEvent(e){
  if(e.type==="nova"){ Save.unlock("nova"); }
  if(e.type==="waveclear"){ toast("Wave cleared!"); }
  if(e.type==="end"){ endGame(e); }
}
function endGame(r){ running=false; camActive=false; Audio.stopMusic();
  const base = r.completed? (60 + r.stars*40 + Math.round(r.steadiness/2)) : 20;
  const coins = r.completed? (20+r.stars*15) : 5;
  Save.addXP(base); Save.addCoins(coins);
  const streak=Save.touchStreak();
  Save.recordSession({ level:chosenLevel.id, difficulty:chosenDiff.id, stars:r.stars, xp:base, coins,
    steadiness:r.steadiness, wispsCleared:r.wispsCleared, novas:r.novas, completed:r.completed });
  // achievements
  const newAch=[];
  if(r.completed && Save.unlock("first_light")) newAch.push("first_light");
  if(r.steadiness>=90 && Save.unlock("steady_hand")) newAch.push("steady_hand");
  if(r.hpPct>=100 && r.completed && Save.unlock("flawless")) newAch.push("flawless");
  if(streak>=3 && Save.unlock("streak3")) newAch.push("streak3");
  if(r.completed && chosenDiff.id==="champion" && Save.unlock("champion")) newAch.push("champion");
  Audio.victory();
  showComplete(r, base, coins, streak, newAch);
}

// ── level complete ──
function showComplete(r, xp, coins, streak, newAch){ showScreen("complete");
  $("cTitle").textContent = r.completed? "Mission Complete!" : "Crystal Dimmed";
  const starEls=$("cStars"); starEls.innerHTML="";
  for(let i=0;i<3;i++){ const s=document.createElement("span"); s.className="bigstar"+(i<r.stars?" lit":""); s.textContent="★"; s.style.animationDelay=(i*0.25)+"s"; starEls.appendChild(s); }
  $("cStats").innerHTML=`
    <div class="crow"><span>Steadiness</span><b>${r.steadiness}%</b></div>
    <div class="crow"><span>Wisps cleared</span><b>${r.wispsCleared}</b></div>
    <div class="crow"><span>Nova blasts</span><b>${r.novas}</b></div>
    <div class="crow"><span>Crystal health</span><b>${r.hpPct}%</b></div>
    <div class="crow xp"><span>+ XP</span><b>${xp}</b></div>
    <div class="crow coin"><span>+ Coins</span><b>${coins} 🪙</b></div>
    <div class="crow"><span>Day streak</span><b>🔥 ${streak}</b></div>`;
  $("cAch").innerHTML = newAch.length? "🏅 Unlocked: "+newAch.map(id=>ACHIEVEMENTS.find(a=>a.id===id).name).join(", ") : "";
  $("btnNext").style.display = (r.completed && chosenLevel.id<LEVELS.length && chosenLevel.id<Save.data.unlockedLevel+1)? "inline-flex":"none";
}
$("btnReplay").onclick=()=>{ Audio.startMusic(); beginCountdown(); };
$("btnNext").onclick=()=>{ const nx=LEVELS.find(l=>l.id===chosenLevel.id+1); if(nx){chosenLevel=nx;} Audio.startMusic(); beginCountdown(); };
$("btnCompHome").onclick=()=>{ toScene("home"); };

// ── dashboard ──
function renderDashboard(){ const d=Save.data, r=rankFor(d.xp);
  $("dTiles").innerHTML=`
    <div class="tile"><div class="tv">Lv ${r}</div><div class="tl">${rankTitle(r)}</div></div>
    <div class="tile"><div class="tv">${d.xp}</div><div class="tl">XP</div></div>
    <div class="tile"><div class="tv">${d.coins}</div><div class="tl">coins</div></div>
    <div class="tile"><div class="tv">🔥 ${d.streak}</div><div class="tl">streak</div></div>`;
  // rank progress
  const cur=xpForRank(r), nxt=xpForRank(r+1); $("dProg").style.width=Math.round((d.xp-cur)/Math.max(nxt-cur,1)*100)+"%";
  $("dProgTxt").textContent=`${d.xp-cur} / ${nxt-cur} XP to Lv ${r+1}`;
  // achievements
  $("dAch").innerHTML=ACHIEVEMENTS.map(a=>`<div class="ach ${d.achievements.includes(a.id)?'got':''}"><div class="ae">${a.emoji}</div><div class="an">${a.name}</div><div class="ad">${a.desc}</div></div>`).join("");
  // history chart (steadiness last 10)
  const hist=d.history.slice(-10); const cv=$("dChart"); const cx=cv.getContext("2d"); cv.width=cv.clientWidth*2; cv.height=120*2; cx.scale(2,2);
  const w=cv.clientWidth,h=120; cx.clearRect(0,0,w,h);
  if(hist.length){ const bw=w/hist.length;
    hist.forEach((s,i)=>{ const bh=(s.steadiness||0)/100*(h-24); cx.fillStyle="#37e1ff"; cx.fillRect(i*bw+bw*0.2,h-16-bh,bw*0.6,bh);
      cx.fillStyle="#93a0c8"; cx.font="9px sans-serif"; cx.textAlign="center"; cx.fillText((s.stars||0)+"★",i*bw+bw*0.5,h-4); });
    cx.fillStyle="#93a0c8"; cx.font="10px sans-serif"; cx.textAlign="left"; cx.fillText("Steadiness % (last "+hist.length+" sessions)",4,12);
  } else { cx.fillStyle="#93a0c8"; cx.font="12px sans-serif"; cx.fillText("No sessions yet — play a mission!",8,60); }
}

// ── settings ──
$("btnMute").onclick=()=>{ const m=!Save.data.settings.muted; Save.data.settings.muted=m; Save.save(); Audio.setMuted(m); $("btnMute").textContent=m?"🔇":"🔊"; };
$("btnMute").textContent=Save.data.settings.muted?"🔇":"🔊"; Audio.setMuted(Save.data.settings.muted);

// ── pose / camera ──
async function loadModel(){ $("calHint").textContent="Loading tracker… (first time ~10MB)";
  const vision=await FilesetResolver.forVisionTasks(WASM);
  const opts=del=>({baseOptions:{modelAssetPath:POSE_MODEL,delegate:del},runningMode:"VIDEO",numPoses:1,minPoseDetectionConfidence:.5,minPosePresenceConfidence:.5,minTrackingConfidence:.5});
  try{ landmarker=await PoseLandmarker.createFromOptions(vision,opts("GPU")); }catch(e){ landmarker=await PoseLandmarker.createFromOptions(vision,opts("CPU")); } }
async function startCamera(){ if(stream)stream.getTracks().forEach(t=>t.stop());
  let s; try{ s=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facing},width:{ideal:1280},height:{ideal:720}}}); }
  catch(e){ s=await navigator.mediaDevices.getUserMedia({audio:false,video:true}); }
  stream=s; video.srcObject=s; await new Promise(r=>{ if(video.readyState>=1)r(); else video.onloadedmetadata=()=>r(); }); await video.play(); }
function poseLoop(){ if(!camActive)return; requestAnimationFrame(poseLoop);
  if(!landmarker||video.readyState<2)return; const now=performance.now();
  if(video.currentTime!==lastVideoTime){ lastVideoTime=video.currentTime; try{ lastRes=landmarker.detectForVideo(video,now); }catch(e){} }
  if(lastRes&&lastRes.landmarks&&lastRes.landmarks[0]){ const raw=lastRes.landmarks[0]; const wlm=(lastRes.worldLandmarks&&lastRes.worldLandmarks[0])||raw; const t=now/1000;
    const sm=raw.map((p,i)=>({x:fX[i].filt(p.x,t),y:fY[i].filt(p.y,t),z:p.z,visibility:vis(p)}));
    const [vl]=detectView(sm); const asp=(video.videoWidth/video.videoHeight)||(16/9); const m=meter.measure(sm,wlm,vl,asp);
    if(m.activeFlex!=null){ flex=flexSmooth.filt(m.activeFlex,t); flexConf=m.activeConf; } else { flex=null; flexConf=Math.max(0,m.activeConf||0); }
    if(scene==="calib"){ const cur = flex!=null? Math.round(flex-calZero):null;
      $("calNow").textContent = cur!=null? cur+"°" : "—";
      const inzone = cur!=null && Math.abs(cur-chosenLevel.target)<=chosenDiff.band;
      const b=$("calZone"); b.textContent = flex==null? "📷 Move so your whole leg shows" : (inzone?"✓ In the zone — this is your hold!":`Bend toward ${chosenLevel.target}° and hold`);
      b.style.color = flex==null?"#ffb84d":(inzone?"#8affc0":"#ffb84d"); }
  } else if(scene==="calib"){ flex=null; $("calNow").textContent="—"; } }
function drawPip(){ pctx.clearRect(0,0,pip.width,pip.height);
  if(lastRes&&lastRes.landmarks&&lastRes.landmarks[0]){ const lm=lastRes.landmarks[0]; pctx.strokeStyle="#37e1ffaa"; pctx.lineWidth=2;
    for(const c of PoseLandmarker.POSE_CONNECTIONS){ const a=lm[c.start],b=lm[c.end]; if(vis(a)<VIS_DRAW||vis(b)<VIS_DRAW)continue;
      pctx.beginPath(); pctx.moveTo(a.x*pip.width,a.y*pip.height); pctx.lineTo(b.x*pip.width,b.y*pip.height); pctx.stroke(); } }
  $("pipAngle").textContent = flex==null?"—":Math.round(flex-calZero)+"°"; }

// pointer control (mouse/touch) over the stage
function ptr(e){ const y=(e.touches?e.touches[0].clientY:e.clientY); pointerNorm=Math.max(0,Math.min(1,y/H)); }
stage.addEventListener("mousemove",ptr); stage.addEventListener("touchmove",e=>{ptr(e);e.preventDefault();},{passive:false}); stage.addEventListener("touchstart",ptr);

// toast
function toast(m){ const t=$("toast"); t.textContent=m; t.style.opacity=1; clearTimeout(t._h); t._h=setTimeout(()=>t.style.opacity=0,1800); }

// boot
resize(); refreshHome(); showScreen("home");
// testing hook
window.__cg={ scene:()=>scene, go:toScene, startMouse:()=>{chosenChar=CHARACTERS[0];chosenDiff=DIFFICULTIES[0];chosenLevel=LEVELS[0];mode="mouse";beginCountdown();},
  setPointer:v=>{pointerNorm=v;}, forcePlay:()=>{countUntil=0;}, step:(dt)=>{ if(game){ const st=det.update((1-pointerNorm)*90,performance.now()/1000); hold={tracked:true,inBand:st.inBand,steadiness:st.brightness,holdTime:st.holdTime}; game.update(dt||0.05,hold,performance.now()); } },
  state:()=>game?{phase:game.phase,wave:game.wave,hp:Math.round(game.hp),charge:+game.charge.toFixed(2),cleared:game.wispsCleared,result:game.result}:null };
