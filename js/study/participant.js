// participant.js — Virtual Therapy patient portal (web + Android app).
//   Signed out:  split sign-in screen (Study ID + access code), then consent.
//   Signed in:   app shell — navy sidebar on desktop, top bar + bottom tabs on phones — with four pages:
//     #home      next exercise, weekly goal, key numbers, exercise plan, latest therapist note, recent activity
//     #progress  session charts and clinical measurements against the first check-up
//     #health    everything the research team recorded: personal details (incl. CNIC), diagnosis, plan
//     #messages  therapist feedback, linked to the session it refers to
//     #questions ask the therapist a question; replies appear under it
// New feedback/replies arrive by refreshing when the app returns to the screen, every minute, and on page change.
// Data comes from the store (cloud rules let a linked device read its own records) and is cached for offline use.
import { getStore } from "./store.js";
import { T, setLang, getLang, initLang } from "../okc/i18n.js";
import { normalizeCode, GAMES, isDone, sessionTime, mondayOf, DEFAULTS, weeklyCounts, avg, DX_TYPES, DX_SIDES, bmiClass, latestDx } from "./schema.js";
import { ring, lineChart, barChart, COLORS, setChartTheme, sparkline, miniBars } from "./charts.js";
import { kneeArt } from "./kneeart.js";
setChartTheme("dark");
import { icon } from "./icons.js";
import { esc, langSeg, brandPane } from "./ptui.js";

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const CONSENT_VERSION = "draft-1";     // bump when the approved wording changes
const DAY = 86400000, TABS = ["home", "progress", "health", "messages", "questions"];
let store, data = { profile: null, sessions: [] }, redraw = null;

(async function boot(){
  store = await getStore();
  const q = new URLSearchParams(location.search);
  if(q.get("signout")){ await store.participant.logout(); history.replaceState(null, "", location.pathname); }
  try{ localStorage.setItem("vt_role", "patient"); }catch(e){}           // next launch of the app opens the patient side
  const cur = store.participant.current();
  initLang(q.get("lang") || (cur && cur.lang));
  addEventListener("hashchange", () => { document.body.classList.remove("nav-open"); const c = store.participant.current(); if(c && c.consented && /messages|questions/.test(location.hash)) refresh(c, true); render(); });
  // keep feedback and replies current: when the app/tab comes back to the screen, and every minute while visible
  document.addEventListener("visibilitychange", () => { const c = store.participant.current(); if(!document.hidden && c && c.consented) refresh(c, true); });
  setInterval(() => { const c = store.participant.current(); if(!document.hidden && c && c.consented) refresh(c, true); }, 60000);
  $("#backdrop").onclick = () => document.body.classList.remove("nav-open");
  let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => redraw && redraw(), 150); });
  render();
})();

function bindLang(){ $$(".seg button").forEach(b => b.onclick = async () => { setLang(b.dataset.l); if(store.participant.setLang) await store.participant.setLang(b.dataset.l); render(); }); }

function render(){
  document.title = T("Virtual Therapy");
  const cur = store.participant.current();
  const app = !!(cur && cur.consented);
  document.body.classList.toggle("app", app); document.body.classList.toggle("auth", !app);
  $("#view").className = app ? "pt-content" : "";
  if(!cur) viewLogin(); else if(!cur.consented) viewConsent(cur); else viewApp(cur);
  bindLang();
}

// ── sign-in & consent (split layout) ─────────────────────────────────────────────────────────
const demoNote = () => store.mode === "local" ? `<p class="note-sm">${esc(T("Demo mode: your data stays on this device."))}</p>` : "";
function viewLogin(){
  $("#view").innerHTML = `<div class="auth-wrap">${brandPane()}<section class="formpane"><div class="topline">${langSeg()}</div><div class="inner">
      <h2>${esc(T("Patient sign-in"))}</h2><p class="lead">${esc(T("Enter the Study ID and access code your therapist gave you."))}</p><div id="err"></div>
      <form id="f"><div class="field"><label for="sid">${esc(T("Study ID"))}</label><input id="sid" class="code" placeholder="P001" autocomplete="username" autocapitalize="characters" required></div>
        <div class="field"><label for="code">${esc(T("Access code"))}</label><input id="code" class="code" placeholder="ABCD-EFGH" autocomplete="current-password" autocapitalize="characters" required></div>
        <button class="btn-primary">${esc(T("Sign in"))} ${icon("arrow", 18, "chev")}</button></form>
      <p class="note-sm">${esc(T("Lost your code? Ask your therapist — they can issue a new one."))}</p>${demoNote()}
      <div class="alt"><a href="therapy.html?choose=1">${icon("swap", 16)} ${esc(T("Change role"))}</a><span class="muted">${icon("lock", 14)} ${esc(T("Secure sign-in"))}</span></div></div></section></div>`;
  $("#f").onsubmit = async e => { e.preventDefault(); $("#err").innerHTML = ""; const btn = $("#f button"); btn.disabled = true;
    try{ await store.participant.login($("#sid").value.trim(), normalizeCode($("#code").value)); data = { profile: null, sessions: [] }; lastRefresh = 0; lastSig = ""; location.hash = "#home"; render(); }
    catch(err){ btn.disabled = false; $("#err").innerHTML = `<div class="err">${esc(T(err.message))}</div>`; } };
}

function viewConsent(cur){
  const pts = ["This is a research study about exercise games for people with knee osteoarthritis.",
    "Taking part is voluntary. You can stop at any time without any effect on your treatment.",
    "The app records your exercise sessions (which game, when, your score, and your knee movement as estimated by the camera) and your pain ratings. It uses your Study ID — not your name.",
    "The camera is used on your phone to follow your movement. Video is not recorded or sent anywhere.",
    "Stop exercising and tell your therapist if you feel sharp or severe pain, dizziness, or feel unsafe.",
    "Keep a sturdy chair or counter within reach, especially for the balance game."];
  $("#view").innerHTML = `<div class="auth-wrap">${brandPane()}<section class="formpane"><div class="topline">${langSeg()}</div><div class="inner">
      <h2>${esc(T("Before you start"))}</h2><p class="lead">${esc(T("Study ID"))}: <b>${esc(cur.studyId)}</b></p>
      <ul class="consent-list">${pts.map(p => `<li>${icon("check", 18)}<span>${esc(T(p))}</span></li>`).join("")}</ul>
      <label class="agree"><input type="checkbox" id="ok" style="width:20px;height:20px;margin-top:1px"> <span>${esc(T("I have read this and agree to take part."))}</span></label>
      <button class="btn-primary" id="go" disabled style="margin-top:14px">${esc(T("Continue"))} ${icon("arrow", 18, "chev")}</button>
      <div class="alt"><a href="?signout=1">${icon("logout", 16)} ${esc(T("Not you? Sign out"))}</a></div></div></section></div>`;
  $("#ok").onchange = e => $("#go").disabled = !e.target.checked;
  $("#go").onclick = async () => { await store.participant.saveConsent({ version: CONSENT_VERSION, lang: getLang() }); location.hash = "#home"; render(); };
}

// ── data: cached profile + sessions, refreshed in the background ─────────────────────────────
const cacheKey = id => "vt_profile_" + id;
function loadCache(id){ try{ return JSON.parse(localStorage.getItem(cacheKey(id))); }catch(e){ return null; } }
function saveCache(id, v){ try{ localStorage.setItem(cacheKey(id), JSON.stringify(v)); }catch(e){} }
let refreshing = false, lastRefresh = 0, lastSig = "", lastTab = null;
function refresh(cur, force){
  if(refreshing || (!force && Date.now() - lastRefresh < 15000)) return; refreshing = true;
  Promise.all([store.participant.plan ? store.participant.plan().catch(() => null) : null,
    store.participant.profile ? store.participant.profile().catch(() => null) : null,
    store.participant.listMySessions ? store.participant.listMySessions().catch(() => null) : null])
  .then(([, profile, sessions]) => { const c = store.participant.current(); if(!c || c.studyId !== cur.studyId) return;
    if(profile) data.profile = profile; if(sessions) data.sessions = sessions; lastRefresh = Date.now();
    const sig = JSON.stringify(data); if(sig !== lastSig){ lastSig = sig; saveCache(cur.studyId, data); if(c.consented) render(); } })
  .finally(() => { refreshing = false; });
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────
const loc = () => getLang() === "ur" ? "ur-PK" : undefined;
const relDay = t => { if(!t) return ""; const d = Math.floor((new Date().setHours(0,0,0,0) - new Date(t).setHours(0,0,0,0)) / DAY); return d <= 0 ? T("today") : d === 1 ? T("yesterday") : T("{n} days ago", { n: d }); };
const dateStr = t => t ? new Date(t).toLocaleDateString(loc(), { day:"numeric", month:"short", year:"numeric" }) : "—";
const stars = n => `<span class="stars5" aria-label="${n || 0} / 3">${[0,1,2].map(i => icon("star", 14, i < (n || 0) ? "on" : "")).join("")}</span>`;
const gameOf = id => GAMES.find(g => g.id === id) || { id, name: id || "", exercise:"" };
const gtile = id => `<span class="gtile t${Math.max(0, GAMES.findIndex(g => g.id === id))}">${icon(id, 22)}</span>`;
const qchip = q => q == null ? "" : `<span class="qchip ${q >= 80 ? "good" : q >= 60 ? "mid" : "low"}">${q}%</span>`;
const FB = { praise:{ t:"Praise" }, tip:{ t:"Tip" }, caution:{ t:"Caution" }, note:{ t:"Note" } };
const seenKey = id => "vt_fb_seen_" + id, seenAt = id => { try{ return Number(localStorage.getItem(seenKey(id))) || 0; }catch(e){ return 0; } };
const seenQKey = id => "vt_q_seen_" + id, seenQAt = id => { try{ return Number(localStorage.getItem(seenQKey(id))) || 0; }catch(e){ return 0; } };
function streakOf(done){ const days = new Set(done.map(s => new Date(sessionTime(s)).setHours(0,0,0,0))); let d = new Date().setHours(0,0,0,0), n = 0; if(!days.has(d)) d -= DAY; while(days.has(d)){ n++; d -= DAY; } return n; }
const dl = rows => `<dl class="dl2">${rows.map(([k, v]) => `<div><dt>${esc(T(k))}</dt><dd>${v == null || v === "" ? "—" : v}</dd></div>`).join("")}</dl>`;
const panel = (ic, title, body, meta = "", flush = false) => `<section class="panel"><div class="panel-h"><h2>${icon(ic, 18)}${esc(T(title))}</h2>${meta}</div><div class="panel-b ${flush ? "flush" : ""}">${body}</div></section>`;
const empty = (ic, title, sub) => `<div class="empty2">${icon(ic, 34)}<b>${esc(T(title))}</b><span>${esc(T(sub))}</span></div>`;

function derived(cur){
  const prof = data.profile || {}, p = prof.participant || {};
  const done = (data.sessions || []).filter(s => isDone(s) && s.inputMode !== "mouse").sort((a, b) => sessionTime(b) - sessionTime(a));
  const gameIds = (Array.isArray(p.games) && p.games.length ? p.games : cur.games) || GAMES.map(g => g.id);
  const fb = (prof.feedback || []).slice().sort((a, b) => b.createdAt - a.createdAt);
  const qs = (prof.questions || []).slice().sort((a, b) => b.createdAt - a.createdAt), qSeen = seenQAt(cur.studyId);
  return { prof, p, done, games: gameIds.map(gameOf).filter(g => g.name), fb, unread: fb.filter(f => f.createdAt > seenAt(cur.studyId)).length, name: prof.identity && prof.identity.name,
    qs, newReplies: qs.filter(q => q.repliedAt && q.repliedAt > qSeen).length };
}

// ── app shell ────────────────────────────────────────────────────────────────────────────────
function viewApp(cur){
  if(!data.profile){ const c = loadCache(cur.studyId); if(c){ data = c; lastSig = JSON.stringify(c); } }
  refresh(cur);
  let tab = location.hash.replace("#", ""); if(!TABS.includes(tab)) tab = "home";
  const d = derived(cur), initial = esc(((d.name || cur.studyId).trim()[0] || "P").toUpperCase());
  const items = [["home", "home", "Overview"], ["progress", "progress", "Progress"], ["health", "health", "My health"], ["messages", "message", "Messages"], ["questions", "help", "Ask a question"]];
  const cnt = k => k === "messages" && d.unread ? `<span class="count">${d.unread}</span>` : k === "questions" && d.newReplies ? `<span class="count">${d.newReplies}</span>` : "";
  $("#side").innerHTML = `<div class="side-brand"><span class="logo">${icon("mark", 24)}</span><div><b>${esc(T("Virtual Therapy"))}</b><small>${esc(T("Patient portal"))}</small></div></div>
    <nav>${items.map(([k, ic, l]) => `<a href="#${k}" class="${tab === k ? "on" : ""}">${icon(ic, 19)}${esc(T(l))}${cnt(k)}</a>`).join("")}
      <div class="navlabel">${esc(T("Exercise"))}</div><a href="okc.html">${icon("play", 19)}${esc(T("Start exercises"))}</a></nav>
    <div class="side-foot"><div class="who"><span class="avatar">${initial}</span><div>${esc(d.name || T("Patient"))}<small>${esc(T("Study ID"))} ${esc(cur.studyId)}</small></div></div>
      ${langSeg()}<div class="row" style="gap:16px"><a href="therapy.html?choose=1">${icon("swap", 15)}${esc(T("Change role"))}</a><a href="?signout=1">${icon("logout", 15)}${esc(T("Sign out"))}</a></div></div>`;
  $("#ptTop").innerHTML = `<button class="hamb" id="hamb" aria-label="Menu">${icon("menu", 20)}</button><span class="brandmark">${icon("mark", 20)}</span><b>${esc(T("Virtual Therapy"))}</b><div class="right">${langSeg()}<a href="#health" class="avatar" style="width:32px;height:32px;border-radius:10px;text-decoration:none">${initial}</a></div>`;
  const dockItems = [["home", "home", "Overview"], ["progress", "progress", "Progress"], ["health", "health", "My health"], ["messages", "message", "Messages"], ["questions", "help", "Ask a question"]];
  $("#pnav").className = "dock"; $("#pnav").setAttribute("aria-label", T("Main menu"));
  $("#pnav").innerHTML = dockItems.map(([k, ic, l]) => `<a href="#${k}" class="${tab === k ? "on" : ""}" aria-label="${esc(T(l))}" title="${esc(T(l))}">${icon(ic, 21)}${cnt(k)}</a>`).join("");
  $("#hamb").onclick = () => document.body.classList.toggle("nav-open");
  document.querySelectorAll("#side a").forEach(a => a.addEventListener("click", () => document.body.classList.remove("nav-open")));
  redraw = null; if(tab !== lastTab){ window.scrollTo(0, 0); lastTab = tab; }
  ({ home: pageHome, progress: pageProgress, health: pageHealth, messages: pageMessages, questions: pageQuestions })[tab](cur, d);
}

// ── overview (dark dashboard) ─────────────────────────────────────────────────────────────────
// Knee Health Score: an app-computed index (not a clinical measure) from the last 10 sessions —
// 45 % movement quality, 30 % sessions in the last 7 days vs the weekly target, 25 % pain after exercise (lower = better).
function kneeScore(d){
  const recent = d.done.slice(0, 10); if(!recent.length) return null;
  const target = DEFAULTS.prescribedPerWeek || 3, last7 = d.done.filter(s => Date.now() - sessionTime(s) < 7 * DAY).length;
  const q = avg(recent.map(s => s.qualityPct)), pain = avg(recent.map(s => s.painAfter != null ? s.painAfter : s.painBefore));
  return Math.max(0, Math.min(100, Math.round(0.45 * (q == null ? 60 : q) + 0.30 * Math.min(1, last7 / target) * 100 + 0.25 * (pain == null ? 70 : 100 - pain * 10))));
}
const scoreStatus = v => v == null ? { t: "No data yet", c: "muted" } : v >= 80 ? { t: "Good", c: "good" } : v >= 60 ? { t: "Fair", c: "fair" } : { t: "Needs attention", c: "low" };
const painStatus = v => v == null ? { t: "No rating yet", c: "muted" } : v <= 3 ? { t: "Low", c: "good" } : v <= 6 ? { t: "Moderate", c: "fair" } : { t: "High", c: "low" };
const TIPS = ["Warm up with a few gentle knee bends before you start.", "Move slowly and smoothly — control matters more than speed.",
  "A short walk on a flat surface keeps the knee joint nourished.", "Keep a sturdy chair nearby for every standing exercise.",
  "Stop if pain goes above 5 out of 10 and tell your therapist.", "Little and often: three short sessions a week work better than one long one.",
  "Sit with your knee straight sometimes — long bent sitting makes it stiff."];
const tipOfDay = () => TIPS[Math.floor(Date.now() / DAY) % TIPS.length];

function pageHome(cur, d){
  const target = DEFAULTS.prescribedPerWeek || 3, week = d.done.filter(s => sessionTime(s) >= mondayOf(Date.now())).length, left = Math.max(0, target - week);
  const lastOf = id => d.done.find(s => s.game === id), best = id => Math.max(0, ...d.done.filter(s => s.game === id).map(s => s.stars || 0));
  const next = d.games.slice().sort((a, b) => ((lastOf(a.id) && sessionTime(lastOf(a.id))) || 0) - ((lastOf(b.id) && sessionTime(lastOf(b.id))) || 0))[0];
  const chron = d.done.slice().reverse(), score = kneeScore(d), st = scoreStatus(score);
  const pains = chron.map(s => s.painAfter != null ? s.painAfter : s.painBefore).filter(v => v != null), painNow = pains.length ? pains[pains.length - 1] : null, ps = painStatus(painNow);
  const flex = chron.map(s => s.peakFlexionDeg).filter(v => v != null), flexNow = flex.length ? flex[flex.length - 1] : null;
  const qual = chron.map(s => s.qualityPct).filter(v => v != null), qNow = qual.length ? Math.round(avg(qual.slice(-5))) : null;
  const weekly = weeklyCounts(chron, 6).map(w => w.n);
  const latest = d.fb[0], first = d.name ? d.name.split(" ")[0] : "";
  const tile = (lbl, val, unit, status, spark) => `<div class="dtile"><span class="lbl">${esc(T(lbl))}</span><b class="v">${val}${unit ? `<small>${unit}</small>` : ""}</b><span class="st ${status.c}">${esc(T(status.t))}</span>${spark}</div>`;
  $("#view").innerHTML = `
    <header class="dhead"><div><p class="hi">${esc(T("Hi"))}${first ? ", " + esc(first) : ""}!</p><h1>${esc(T("Let's keep your"))} <span>${esc(T("knees healthy"))}</span></h1></div>
      <div class="dact"><a class="ibtn" href="#health" aria-label="${esc(T("My health"))}">${icon("user", 20)}</a><a class="ibtn" href="#messages" aria-label="${esc(T("Messages"))}">${icon("message", 20)}${d.unread ? `<i class="pip"></i>` : ""}</a></div></header>
    ${d.p.status === "completed" ? `<div class="gcard note-ok">${icon("check", 20)}<div><b>${esc(T("You have completed your treatment programme"))}</b><span>${esc(T("Well done. You can keep doing your exercises and view your records here."))}</span></div></div>`
      : d.p.status === "withdrawn" ? `<div class="gcard note-warn">${icon("alert", 20)}<div><b>${esc(T("Your participation in the study has ended"))}</b><span>${esc(T("Your records stay available here. Contact your therapist if you have any questions."))}</span></div></div>` : ""}
    <div class="dgrid">
      <section class="hero-knee">${kneeArt({ height: 250 })}</section>
      <div class="dcol">
        <a class="gcard metric" href="#progress"><div><span class="lbl">${esc(T("Knee Health Score"))}</span><b class="big">${score == null ? "—" : score}<small>${score == null ? "" : "%"}</small></b><span class="st ${st.c}">${esc(T(st.t))}</span></div>
          <span class="gico">${kneeArt({ height: 46, small: true })}</span></a>
        <div class="gcard metric"><div><span class="lbl">${esc(T("Pain level (0–10)"))}</span><b class="big">${painNow == null ? "—" : painNow}</b><span class="st ${ps.c}">${esc(T(ps.t))}</span></div>
          <div class="bars">${miniBars(pains, { color: ps.c === "low" ? "#FB7185" : ps.c === "fair" ? "#FBBF24" : "#4ADE80" })}<span class="gico sm">${icon("health", 18)}</span></div></div>
      </div>
    </div>
    <h2 class="dsec">${esc(T("Today's overview"))}</h2>
    <div class="dtiles">
      ${tile("Knee bend", flexNow == null ? "—" : Math.round(flexNow), flexNow == null ? "" : "°", flexNow == null ? { t: "Not measured", c: "muted" } : { t: flexNow >= 110 ? "Good" : flexNow >= 90 ? "Fair" : "Limited", c: flexNow >= 110 ? "good" : flexNow >= 90 ? "fair" : "low" }, sparkline(flex.slice(-8)))}
      ${tile("This week", week, `/${target}`, left ? { t: T("{n} to go", { n: left }), c: "fair" } : { t: "Goal reached", c: "good" }, sparkline(weekly))}
      ${tile("Quality", qNow == null ? "—" : qNow, qNow == null ? "" : "%", qNow == null ? { t: "No data yet", c: "muted" } : { t: qNow >= 80 ? "Good" : qNow >= 60 ? "Fair" : "Keep practising", c: qNow >= 80 ? "good" : qNow >= 60 ? "fair" : "low" }, sparkline(qual.slice(-8)))}
    </div>
    ${next ? `<section class="gcard nextx"><span class="gico">${icon(next.id, 24)}</span><div class="grow"><span class="lbl">${esc(T("Next exercise"))}</span><b>${esc(T(next.name))}</b><span class="sub">${esc(T(next.exercise))}</span></div>
      <a class="btn-go" href="okc.html?game=${next.id}">${icon("play", 16)} ${esc(T("Start"))}</a></section>` : ""}
    ${latest ? `<a class="gcard msgc ${d.unread ? "new" : ""}" href="#messages"><span class="gico">${icon("doctor", 20)}</span><div class="grow"><span class="lbl">${esc(T(d.unread ? "New message from your therapist" : "Latest message from your therapist"))} · ${esc(relDay(latest.createdAt))}</span>
      <p>${esc(latest.text.length > 120 ? latest.text.slice(0, 118) + "…" : latest.text)}</p></div>${icon("chevron", 18, "chev")}</a>` : ""}
    <h2 class="dsec">${esc(T("Your exercise plan"))} <span>${esc(T("{n} of {m} games assigned by your therapist", { n: d.games.length, m: GAMES.length }))}</span></h2>
    <div class="gcard list">${d.games.map(g => { const l = lastOf(g.id);
      return `<a class="drow" href="okc.html?game=${g.id}"><span class="gico">${icon(g.id, 20)}</span><div class="grow"><b>${esc(T(g.name))}</b><span>${l ? esc(T("Last played {d}", { d: relDay(sessionTime(l)) })) : esc(T("Not played yet"))}</span></div>${stars(best(g.id))}<span class="playb">${icon("play", 14)}</span></a>`; }).join("")}</div>
    <section class="gcard tipc"><div class="grow"><span class="lbl accent">${esc(T("Tip of the day"))}</span><p>${esc(T(tipOfDay()))}</p></div><span class="tipart">${icon("chair", 34)}</span></section>
    <p class="dnote">${esc(T("The Knee Health Score is calculated by the app from your exercise quality, weekly sessions and pain ratings. It is not a medical test."))}</p>`;
}

// ── progress ─────────────────────────────────────────────────────────────────────────────────
const MEASURES = [
  { label:"WOMAC total (0–96)", get:a => a.womac && a.womac.total, better:"lower" }, { label:"WOMAC pain (0–20)", get:a => a.womac && a.womac.pain, better:"lower" },
  { label:"WOMAC stiffness (0–8)", get:a => a.womac && a.womac.stiffness, better:"lower" }, { label:"WOMAC function (0–68)", get:a => a.womac && a.womac.function, better:"lower" },
  { label:"Timed Up and Go (seconds)", get:a => a.tug && a.tug.seconds, better:"lower" }, { label:"Berg Balance (0–56)", get:a => a.bbs && a.bbs.total, better:"higher" },
  { label:"Pain score VAS (0–100)", get:a => a.vas, better:"lower" },
  { label:"Left knee bending (°)", get:a => a.rom && a.rom.left && a.rom.left.flexion, better:"higher" }, { label:"Left knee straightening gap (°)", get:a => a.rom && a.rom.left && a.rom.left.extension, better:"lower" },
  { label:"Right knee bending (°)", get:a => a.rom && a.rom.right && a.rom.right.flexion, better:"higher" }, { label:"Right knee straightening gap (°)", get:a => a.rom && a.rom.right && a.rom.right.extension, better:"lower" },
];
const num = v => (v == null || v === "" || Number.isNaN(Number(v))) ? null : Number(v);
function pageProgress(cur, d){
  const done = d.done.slice().reverse(), as = ((d.prof.assessments) || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const weekly = weeklyCounts(done, 8), r1 = v => v == null ? "—" : Math.round(v * 10) / 10, score = kneeScore(d), st = scoreStatus(score);
  const mon = mondayOf(Date.now()), sun = mon + 6 * DAY, fmt = t => new Date(t).toLocaleDateString(loc(), { day: "numeric", month: "short" });
  const q = done.map(s => s.qualityPct).filter(v => v != null), qBest = q.length ? Math.max(...q) : null, qAvg = q.length ? Math.round(avg(q)) : null;
  const highPain = d.done.filter(s => Date.now() - sessionTime(s) < 7 * DAY && ((s.painAfter != null && s.painAfter >= 7) || (s.painBefore != null && s.painBefore >= 7))).length;
  const rows = MEASURES.map(m => { const vals = as.map(a => num(m.get(a))).filter(v => v != null); if(!vals.length) return "";
    const b = vals[0], l = vals[vals.length - 1], dlt = vals.length > 1 ? Math.round((l - b) * 10) / 10 : null, good = dlt == null || dlt === 0 ? "" : ((m.better === "lower") === (dlt < 0) ? "up" : "down");
    return `<tr><td class="lbl">${esc(T(m.label))}</td><td class="n base">${r1(b)}</td><td class="n">${r1(l)}</td><td class="n">${dlt == null ? `<span class="delta">${esc(T("first"))}</span>` : `<span class="delta ${good}">${dlt > 0 ? "+" : ""}${dlt} · ${esc(T(good === "up" ? "improved" : good === "down" ? "worse" : "same"))}</span>`}</td></tr>`; }).join("");
  $("#view").innerHTML = `<header class="dhead"><div><p class="hi">${esc(T("Progress"))}</p><h1>${esc(T("Weekly report"))}</h1></div><span class="rangechip">${icon("calendar", 15)} ${esc(fmt(mon))} – ${esc(fmt(sun))}</span></header>
    <section class="gcard metric wide"><div><span class="lbl">${esc(T("Knee function"))}</span><b class="big">${score == null ? "—" : score}<small>${score == null ? "" : "%"}</small></b><span class="st ${st.c}">${esc(T(st.t))}</span></div>
      <span class="artsm">${kneeArt({ height: 110, small: true })}</span></section>
    <section class="gcard chartc"><div class="chd"><span class="lbl">${esc(T("Session quality (%)"))}</span><div class="pair"><div><b>${qBest == null ? "—" : qBest + "%"}</b><span>${esc(T("Best"))}</span></div><div><b>${qAvg == null ? "—" : qAvg + "%"}</b><span>${esc(T("Average"))}</span></div></div></div><canvas id="pc1"></canvas></section>
    <div class="dpair">
      <section class="gcard chartc"><div class="chd"><span class="lbl">${esc(T("Sessions per week"))}</span></div><canvas id="pc0"></canvas></section>
      <section class="gcard chartc"><div class="chd"><span class="lbl">${esc(T("Pain before and after exercise (0–10)"))}</span></div><canvas id="pc2"></canvas></section>
    </div>
    <section class="gcard metric"><div><span class="lbl">${esc(T("Symptoms this week"))}</span><b class="mid">${highPain ? esc(T("{n} high-pain session(s)", { n: highPain })) : esc(T("None"))}</b><span class="st ${highPain ? "low" : "good"}">${esc(T(highPain ? "Tell your therapist" : "Great!"))}</span></div>
      <span class="okdot ${highPain ? "warn" : ""}">${icon(highPain ? "alert" : "check", 22)}</span></section>
    <h2 class="dsec">${esc(T("Clinical measurements"))} <span>${as.length ? esc(T("Last check: {d}", { d: as[as.length - 1].timepoint + " · " + as[as.length - 1].date })) : ""}</span></h2>
    <section class="gcard list">${as.length ? `<table class="mtable"><thead><tr><th>${esc(T("Measure"))}</th><th style="text-align:end" class="base">${esc(T("Start"))}</th><th style="text-align:end">${esc(T("Latest"))}</th><th style="text-align:end">${esc(T("Change"))}</th></tr></thead><tbody>${rows}</tbody></table>`
      : empty("clipboard", "No check-ups yet", "Your therapist has not recorded any check-up results yet.")}</section>
    <section class="gcard tipc"><div class="grow"><span class="lbl accent">${esc(T("Tip of the day"))}</span><p>${esc(T(tipOfDay()))}</p></div><span class="tipart">${icon("activity", 34)}</span></section>`;
  const lab = done.map(s => new Date(sessionTime(s)).toLocaleDateString(undefined, { day: "numeric", month: "short" }));
  redraw = () => { barChart($("#pc0"), { labels: weekly.map(w => w.label), values: weekly.map(w => w.n), ref: DEFAULTS.prescribedPerWeek, height: 170, color: "#4ADE80" });
    lineChart($("#pc1"), { labels: lab, series: [{ label: "Quality", color: "#4ADE80", data: done.map(s => s.qualityPct) }], min: 0, max: 100, height: 170 });
    lineChart($("#pc2"), { labels: lab, series: [{ label: T("Before"), color: "#FB7185", data: done.map(s => s.painBefore) }, { label: T("After"), color: "#4ADE80", data: done.map(s => s.painAfter) }], min: 0, max: 10, height: 180 }); };
  redraw();
}

// ── my health ────────────────────────────────────────────────────────────────────────────────
function pageHealth(cur, d){
  const p = d.p, dm = p.demographics || {}, id = d.prof.identity || {}, dx = latestDx(d.prof.diagnoses || []);
  const yr = n => `${n} ${T(n === 1 ? "year" : "years")}`, mo = n => `${n} ${T(n === 1 ? "month" : "months")}`;
  const pdur = m => m == null ? "—" : m >= 12 ? yr(Math.floor(m/12)) + (m%12 ? " " + mo(m%12) : "") : mo(m);
  const side = dx && (DX_SIDES.find(s => s.v === dx.side) || {}).label, type = dx && (dx.type === "other" ? dx.otherText : (DX_TYPES.find(t => t.v === dx.type) || {}).label);
  const L = dx && (dx.side === "left" || dx.side === "bilateral"), R = dx && (dx.side === "right" || dx.side === "bilateral");
  const knee = (on, kl, label) => `<div class="knee ${on ? "on" : ""}"><small>${esc(T(label))}</small><b>${on ? (kl ?? "–") : "—"}</b><small>${esc(T(on ? "KL grade" : "not affected"))}</small></div>`;
  const conds = dx ? [...(dx.comorbidities || []), ...(dx.comorbidityOther ? [dx.comorbidityOther] : [])] : [];
  $("#view").innerHTML = `<div class="pg-head"><div><div class="eyebrow">${esc(T("My health"))}</div><h1>${esc(T("Health record"))}</h1><p>${esc(T("Everything your therapist has recorded for you."))}</p></div></div>
    <section class="panel"><div class="panel-b"><div class="idcard"><span class="av">${esc(((id.name || cur.studyId).trim()[0] || "P").toUpperCase())}</span><div><h2>${esc(id.name || T("Patient"))}</h2>
      <div class="chips"><span class="pill navy">${esc(T("Study ID"))} ${esc(cur.studyId)}</span>${p.group ? `<span class="pill">${esc(p.group)}</span>` : ""}${dm.klGrade ? `<span class="pill">KL ${esc(dm.klGrade)}</span>` : ""}</div></div></div></div></section>
    <div class="cols"><div>
      ${panel("user", "Personal details", dl([["Name", esc(id.name)], ["CNIC number", esc(id.cnic)], ["Age", dm.age ? esc(dm.age) + " " + esc(T("years")) : ""], ["Gender", esc(T(dm.gender || ""))],
        ["Residence", esc(dm.residence)], ["Education", esc(dm.education)], ["Occupation", esc(dm.occupation)], ["Marital status", esc(T(dm.marital || ""))],
        ["Knee pain for", esc(pdur(dm.painDurationMonths))], ["Knee OA grade (KL)", esc(dm.klGrade)], ["Enrolled on", esc(dateStr(p.enrolledAt))], ["Consent given", esc(dateStr(d.prof.consentAt))]]))}
      ${panel("steth", "My diagnosis", dx ? `<div class="row between" style="align-items:flex-start;margin-bottom:14px"><div><h3 style="font-size:18px;color:var(--navy);margin:0 0 8px">${esc(type)}</h3>
          <div class="chips">${dx.icd10 ? `<span class="dx-icd">ICD-10 ${esc(dx.icd10)}</span>` : ""}${side ? `<span class="pill coral">${esc(T(side))}</span>` : ""}${dx.imaging ? `<span class="pill navy">${esc(dx.imaging)}</span>` : ""}</div></div>
          <div class="knees" style="min-width:210px">${knee(R, dx.klRight, "Right knee")}${knee(L, dx.klLeft, "Left knee")}</div></div>
        ${dl([["Diagnosed on", esc(dx.diagnosedOn)], ["Diagnosed by", esc(dx.diagnosedBy)], ["Height", dx.heightCm ? esc(dx.heightCm) + " cm" : ""], ["Weight", dx.weightKg ? esc(dx.weightKg) + " kg" : ""],
          ["BMI", dx.bmi != null ? `${esc(dx.bmi)} · ${esc(T(bmiClass(dx.bmi)))}` : ""], ["Medicines", esc(dx.medications)]])}
        <div style="margin-top:14px"><div class="muted small" style="font-weight:700;margin-bottom:6px">${esc(T("Other conditions"))}</div><div class="chips">${conds.map(c => `<span class="pill navy">${esc(T(c))}</span>`).join("") || `<span class="muted small">${esc(T("None recorded"))}</span>`}</div></div>
        ${(dx.precautions || []).length ? `<div class="callout danger" style="margin-top:16px">${icon("alert", 20)}<div><b>${esc(T("Take care while exercising"))}</b>${dx.precautions.map(c => esc(T(c))).join(" · ")}</div></div>` : ""}
        ${dx.notes ? `<div class="callout" style="margin-top:12px">${icon("note", 20)}<div><b>${esc(T("Therapist's notes"))}</b>${esc(dx.notes)}</div></div>` : ""}`
        : empty("steth", "No diagnosis yet", "Your therapist has not recorded a diagnosis yet."))}
    </div><div>
      ${panel("clipboard", "My exercise plan", `<div class="rows">${d.games.map(g => `<a class="rowi" href="okc.html?game=${g.id}">${gtile(g.id)}<div class="main"><b>${esc(T(g.name))}</b><span>${esc(T(g.exercise))}</span></div><span class="startbtn">${icon("play", 16)}</span></a>`).join("")}</div>`,
        `<span class="meta">${esc(T("Aim for {n} sessions a week.", { n: DEFAULTS.prescribedPerWeek }))}</span>`, true)}
      <div class="callout">${icon("lock", 18)}<div>${esc(T("Only you and your research team can see this record."))}</div></div>
    </div></div>`;
}

// ── messages ─────────────────────────────────────────────────────────────────────────────────
function pageMessages(cur, d){
  const ss = data.sessions || [], seen = seenAt(cur.studyId);
  $("#view").innerHTML = `<div class="pg-head"><div><div class="eyebrow">${esc(T("Messages"))}</div><h1>${esc(T("Messages from your therapist"))}</h1><p>${esc(T("Feedback from your therapist on your exercises."))}</p></div>
      ${d.fb.length ? `<span class="pill navy">${d.fb.length} ${esc(T("messages"))}</span>` : ""}</div>
    <section class="panel"><div class="panel-b">${d.fb.length ? `<div class="notes">${d.fb.map(f => { const s = f.sessionId && ss.find(x => x.id === f.sessionId), g = gameOf((s && s.game) || f.game), isNew = f.createdAt > seen;
      return `<div class="note ${f.kind || ""} ${isNew ? "unread" : ""}"><span class="who">${icon("doctor", 18)}</span><div class="grow">
        <div class="hd"><b>${esc(T("Your therapist"))}</b><span class="tag ${f.kind || ""}">${esc(T((FB[f.kind] || FB.note).t))}</span>${isNew ? `<span class="tag new">${esc(T("New"))}</span>` : ""}<span>${esc(dateStr(f.createdAt))} · ${esc(relDay(f.createdAt))}</span></div>
        <p>${esc(f.text)}</p>${s || f.game ? `<span class="ref">${icon(g.id, 15)} ${esc(T(g.name))}${s ? ` · ${esc(dateStr(sessionTime(s)))} · ${s.qualityPct ?? "—"}% · ${s.repsDone ?? "—"}/${s.repsTarget ?? "—"} ${esc(T("reps"))}` : ""}</span>` : ""}</div></div>`; }).join("")}</div>`
      : empty("inbox", "No messages yet", "Your therapist's feedback on your games will appear here.")}</div></section>`;
  if(d.fb.length){ try{ localStorage.setItem(seenKey(cur.studyId), String(d.fb[0].createdAt)); }catch(e){} $$(".count").forEach(c => c.remove()); }
}

// ── ask a question ───────────────────────────────────────────────────────────────────────────
function pageQuestions(cur, d){
  const topics = [["", "General question"], ["pain", "Pain or discomfort"], ["app", "Using the app"], ...d.games.map(g => [g.id, g.name])];
  const topicLabel = t => { const x = topics.find(([v]) => v === (t || "")); return x ? T(x[1]) : T("General question"); };
  $("#view").innerHTML = `<div class="pg-head"><div><div class="eyebrow">${esc(T("Ask a question"))}</div><h1>${esc(T("Questions for your therapist"))}</h1>
      <p>${esc(T("Ask anything about your exercises, your pain or the app. Your therapist will reply here."))}</p></div></div>
    <div class="cols"><div>
      ${panel("help", "Your questions", d.qs.length ? `<div class="qa">${d.qs.map(q => `<div class="qitem"><div class="hd" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:12.5px;color:var(--muted);font-weight:600">
          <span class="tag">${esc(topicLabel(q.topic))}</span><span>${esc(dateStr(q.createdAt))} · ${esc(relDay(q.createdAt))}</span>${q.repliedAt ? `<span class="tag praise">${esc(T("Answered"))}</span>` : ""}</div>
          <p class="q">${esc(q.text)}</p>
          ${q.reply ? `<div class="a"><div class="hd">${icon("doctor", 14)} ${esc(T("Your therapist replied"))} · ${esc(relDay(q.repliedAt))}</div>${esc(q.reply)}</div>` : `<div class="wait">${icon("calendar", 14)} ${esc(T("Waiting for a reply"))}</div>`}</div>`).join("")}</div>`
        : empty("help", "No questions yet", "Questions you send will appear here with your therapist's reply."))}
    </div><div>
      ${panel("send", "New question", `<form id="askf" class="ask"><div class="field"><label for="qtopic">${esc(T("About"))}</label><select id="qtopic">${topics.map(([v, l]) => `<option value="${esc(v)}">${esc(T(l))}</option>`).join("")}</select></div>
        <div class="field"><label for="qtext">${esc(T("Your question"))}</label><textarea id="qtext" maxlength="2000" placeholder="${esc(T("Type your question in English or Urdu…"))}" required></textarea></div>
        <button class="btn-primary" style="width:100%;justify-content:center">${icon("send", 18)} ${esc(T("Send question"))}</button><p class="muted small" id="qmsg" style="margin:10px 0 0"></p></form>`)}
      <div class="callout warn">${icon("alert", 18)}<div>${esc(T("For severe pain, swelling or a fall, stop exercising and contact your doctor or therapist directly — do not wait for a reply here."))}</div></div>
    </div></div>`;
  $("#askf").onsubmit = async e => { e.preventDefault(); const text = $("#qtext").value.trim(), b = $("#askf button"); if(!text) return;
    b.disabled = true; $("#qmsg").textContent = T("Sending…");
    try{ const rec = await store.participant.ask(text, $("#qtopic").value || null);
      data.profile = data.profile || {}; data.profile.questions = [...(data.profile.questions || []), rec]; lastSig = JSON.stringify(data); saveCache(cur.studyId, data);
      render(); const m = $("#qmsg"); if(m) m.textContent = T("Sent. Your therapist will reply here."); refresh(cur, true); }
    catch(err){ b.disabled = false; $("#qmsg").textContent = (err && err.message) || String(err); } };
  const answered = d.qs.filter(q => q.repliedAt).map(q => q.repliedAt);
  if(answered.length){ try{ localStorage.setItem(seenQKey(cur.studyId), String(Math.max(...answered))); }catch(e){} }
}
