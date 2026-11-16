// participant.js — patient side of Virtual Therapy: sign-in (Study ID + access code), consent and safety notice,
// then the patient's home: weekly goal, streak, their assigned games (tap = straight into that game), recent sessions.
import { getStore } from "./store.js";
import { T, setLang, getLang, initLang } from "../okc/i18n.js";
import { normalizeCode, GAMES, isDone, sessionTime, mondayOf, DEFAULTS } from "./schema.js";
import { ring } from "./charts.js";

const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const CONSENT_VERSION = "draft-1";     // bump when the approved wording changes
const DAY = 86400000;
let store;

(async function boot(){
  store = await getStore();
  const q = new URLSearchParams(location.search);
  if(q.get("signout")){ await store.participant.logout(); history.replaceState(null, "", location.pathname); }
  try{ localStorage.setItem("vt_role", "patient"); }catch(e){}           // next launch of the app opens the patient side
  const cur = store.participant.current();
  initLang(q.get("lang") || (cur && cur.lang));
  document.querySelectorAll(".langbar button").forEach(b => b.onclick = async () => { setLang(b.dataset.l); if(store.participant.setLang) await store.participant.setLang(b.dataset.l); render(); });
  render();
})();

function chrome(){
  document.querySelectorAll(".langbar button").forEach(b => b.classList.toggle("on", b.dataset.l === getLang()));
  document.title = T("Virtual Therapy");
}
function render(){
  chrome();
  const cur = store.participant.current();
  if(!cur) return viewLogin();
  if(!cur.consented) return viewConsent(cur);
  return viewReady(cur);
}

const demoNote = () => store.mode === "local" ? `<p class="muted small center" style="margin-top:14px">${esc(T("Demo mode: your data stays on this device."))}</p>` : "";
const foot = signedIn => `<div class="p-foot">${signedIn ? `<a href="?signout=1">${esc(T("Sign out"))}</a>` : ""}<a href="therapy.html?choose=1">⇄ ${esc(T("Change role"))}</a></div>`;

function viewLogin(){
  $("#view").innerHTML = `<div class="pcard"><div class="vt-logo">🦵</div><h1 class="vt-title center">${esc(T("Virtual Therapy"))}</h1>
    <p class="center" style="margin-bottom:6px"><span class="pill coral">🧑‍🦳 ${esc(T("Patient"))}</span></p>
    <p class="muted center">${esc(T("Enter the Study ID and access code your therapist gave you."))}</p><div id="err"></div>
    <form id="f"><div class="field"><label>${esc(T("Study ID"))}</label><input id="sid" placeholder="P001" autocomplete="username" autocapitalize="characters" required></div>
    <div class="field"><label>${esc(T("Access code"))}</label><input id="code" placeholder="ABCD-EFGH" autocomplete="current-password" autocapitalize="characters" required></div>
    <button class="btn coral">${esc(T("Sign in"))}</button></form>${demoNote()}</div>${foot(false)}`;
  $("#f").onsubmit = async e => { e.preventDefault(); $("#err").innerHTML = ""; const btn = $("#f button"); btn.disabled = true;
    try{ await store.participant.login($("#sid").value.trim(), normalizeCode($("#code").value)); render(); }
    catch(err){ btn.disabled = false; $("#err").innerHTML = `<div class="err">${esc(T(err.message))}</div>`; } };
}

function viewConsent(cur){
  const pts = ["This is a research study about exercise games for people with knee osteoarthritis.",
    "Taking part is voluntary. You can stop at any time without any effect on your treatment.",
    "The app records your exercise sessions (which game, when, your score, and your knee movement as estimated by the camera) and your pain ratings. It uses your Study ID — not your name.",
    "The camera is used on your phone to follow your movement. Video is not recorded or sent anywhere.",
    "Stop exercising and tell your therapist if you feel sharp or severe pain, dizziness, or feel unsafe.",
    "Keep a sturdy chair or counter within reach, especially for the balance game."];
  $("#view").innerHTML = `<div class="pcard"><div class="vt-logo" style="width:64px;height:64px;font-size:32px;border-radius:20px">📝</div><h1 class="center">${esc(T("Before you start"))}</h1><p class="muted center">${esc(T("Study ID"))}: <b>${esc(cur.studyId)}</b></p>
    <div class="consentbox"><ul style="margin:0;padding-inline-start:20px">${pts.map(p => `<li style="margin-bottom:8px">${esc(T(p))}</li>`).join("")}</ul></div>
    <label style="display:flex;gap:10px;align-items:flex-start;font-size:15px;font-weight:700"><input type="checkbox" id="ok" style="width:22px;height:22px;margin-top:2px"> <span>${esc(T("I have read this and agree to take part."))}</span></label>
    <button class="btn" id="go" disabled style="margin-top:14px">${esc(T("Continue"))}</button>
    <p class="center" style="margin-top:12px"><a href="?signout=1">${esc(T("Not you? Sign out"))}</a></p></div>`;
  $("#ok").onchange = e => $("#go").disabled = !e.target.checked;
  $("#go").onclick = async () => { await store.participant.saveConsent({ version: CONSENT_VERSION, lang: getLang() }); render(); };
}

// ── home ─────────────────────────────────────────────────────────────────────────────────────
const relDay = t => { if(!t) return ""; const d = Math.floor((new Date().setHours(0,0,0,0) - new Date(t).setHours(0,0,0,0)) / DAY); return d <= 0 ? T("today") : d === 1 ? T("yesterday") : T("{n} days ago", { n: d }); };
const starsHtml = n => `<span class="stars">${"★".repeat(n || 0)}${"☆".repeat(3 - (n || 0))}</span>`;
function streakOf(done){
  const days = new Set(done.map(s => new Date(sessionTime(s)).setHours(0,0,0,0))); let d = new Date().setHours(0,0,0,0), n = 0;
  if(!days.has(d)) d -= DAY;                                  // a streak is still alive if the last session was yesterday
  while(days.has(d)){ n++; d -= DAY; } return n;
}

function viewReady(cur){
  drawHome(cur, cur.games || GAMES.map(g => g.id), []);
  // latest prescription from the researcher + the patient's own sessions (both cached/offline-safe)
  Promise.all([store.participant.plan ? store.participant.plan().catch(() => null) : null, store.participant.listMySessions ? store.participant.listMySessions().catch(() => []) : []])
    .then(([plan, sessions]) => { const c = store.participant.current(); if(c && c.consented) drawHome(c, (plan && plan.games) || c.games || GAMES.map(g => g.id), sessions || []); });
}

function drawHome(cur, gameIds, sessions){
  const target = DEFAULTS.prescribedPerWeek || 3, done = sessions.filter(s => isDone(s) && s.inputMode !== "mouse");
  const week = done.filter(s => sessionTime(s) >= mondayOf(Date.now())).length, left = Math.max(0, target - week), streak = streakOf(done);
  const starsTotal = done.reduce((a, s) => a + (s.stars || 0), 0), best = id => Math.max(0, ...done.filter(s => s.game === id).map(s => s.stars || 0));
  const games = gameIds.map(id => GAMES.find(g => g.id === id)).filter(Boolean);
  const recent = [...done].sort((a, b) => sessionTime(b) - sessionTime(a)).slice(0, 4);
  const hr = new Date().getHours(), hello = getLang() === "ur" ? T("Hello") : (hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening");
  $("#view").innerHTML = `
    <div class="p-hero"><h1>${esc(hello)} 👋</h1><p>${esc(T("Ready for today's knee exercises?"))}</p><span class="idchip">${esc(T("Study ID"))}: ${esc(cur.studyId)}</span>
      <div class="p-goal">${ring(week / target, { size:86, stroke:9, color:"#FF8E72", track:"rgba(255,255,255,.22)", label:`${week}/${target}`, sub:esc(T("this week")) })}
        <div><h3>${esc(T("Weekly goal"))}</h3><p>${esc(left ? T("{n} more session(s) to reach this week's goal.", { n: left }) : T("Goal reached — well done! 🎉"))}</p></div></div></div>
    <div class="p-stats"><div class="p-stat"><b>🔥 ${streak}</b><span>${esc(T("Day streak"))}</span></div><div class="p-stat"><b>✅ ${done.length}</b><span>${esc(T("Sessions"))}</span></div><div class="p-stat"><b>⭐ ${starsTotal}</b><span>${esc(T("Stars"))}</span></div></div>
    <div class="section-title"><h2>${esc(T("Your exercises"))}</h2><span class="muted small">${esc(T("Tap a game to start"))}</span></div>
    <div class="p-games">${games.map(g => `<a class="p-game g${GAMES.indexOf(g)}" href="okc.html?game=${g.id}"><span class="em">${g.emoji}</span><b>${esc(T(g.name))}</b><span>${esc(T(g.exercise))}</span>${starsHtml(best(g.id))}</a>`).join("")}</div>
    <a class="btn coral" href="okc.html" style="width:100%;margin-top:16px;padding:16px;font-size:18px;border-radius:18px">▶ ${esc(T("Start exercises"))}</a>
    <div class="tipcard"><span class="ti">🪑</span><div>${esc(T("Keep a sturdy chair nearby. Stop if you feel sharp pain or dizziness, and tell your therapist."))}</div></div>
    <div class="section-title"><h2>${esc(T("Recent sessions"))}</h2></div>
    <div class="p-recent">${recent.map(s => { const g = GAMES.find(x => x.id === s.game) || { emoji:"🎮", name: s.gameName || s.game };
      return `<div class="p-rec"><span class="em">${g.emoji}</span><div class="what"><b>${esc(T(g.name))}</b><span>${esc(relDay(sessionTime(s)))}${s.painBefore != null ? ` · ${esc(T("Pain"))} ${s.painBefore}→${s.painAfter ?? "—"}` : ""}</span></div>${starsHtml(s.stars)}</div>`; }).join("")
      || `<div class="p-rec"><span class="em">🌱</span><div class="what"><span>${esc(T("No sessions yet — your first one will appear here."))}</span></div></div>`}</div>
    ${demoNote()}${foot(true)}`;
}
