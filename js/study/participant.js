// participant.js — Virtual Therapy patient portal (web + Android app).
//   Signed out:  split sign-in screen (Study ID + access code), then consent.
//   Signed in:   app shell — navy sidebar on desktop, top bar + bottom tabs on phones — with four pages:
//     #home      next exercise, weekly goal, key numbers, exercise plan, latest therapist note, recent activity
//     #progress  session charts and clinical measurements against the first check-up
//     #health    everything the research team recorded: personal details (incl. CNIC), diagnosis, plan
//     #messages  therapist feedback, linked to the session it refers to
// Data comes from the store (cloud rules let a linked device read its own records) and is cached for offline use.
import { getStore } from "./store.js";
import { T, setLang, getLang, initLang } from "../okc/i18n.js";
import { normalizeCode, GAMES, isDone, sessionTime, mondayOf, DEFAULTS, weeklyCounts, avg, DX_TYPES, DX_SIDES, bmiClass, latestDx } from "./schema.js";
import { ring, lineChart, barChart, COLORS } from "./charts.js";
import { icon } from "./icons.js";
import { esc, langSeg, brandPane } from "./ptui.js";

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const CONSENT_VERSION = "draft-1";     // bump when the approved wording changes
const DAY = 86400000, TABS = ["home", "progress", "health", "messages"];
let store, data = { profile: null, sessions: [] }, redraw = null;

(async function boot(){
  store = await getStore();
  const q = new URLSearchParams(location.search);
  if(q.get("signout")){ await store.participant.logout(); history.replaceState(null, "", location.pathname); }
  try{ localStorage.setItem("vt_role", "patient"); }catch(e){}           // next launch of the app opens the patient side
  const cur = store.participant.current();
  initLang(q.get("lang") || (cur && cur.lang));
  addEventListener("hashchange", () => render());
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
    try{ await store.participant.login($("#sid").value.trim(), normalizeCode($("#code").value)); data = { profile: null, sessions: [] }; refreshedFor = null; location.hash = "#home"; render(); }
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
let refreshing = false, refreshedFor = null;
function refresh(cur){
  if(refreshing || refreshedFor === cur.studyId) return; refreshing = true;
  Promise.all([store.participant.plan ? store.participant.plan().catch(() => null) : null,
    store.participant.profile ? store.participant.profile().catch(() => null) : null,
    store.participant.listMySessions ? store.participant.listMySessions().catch(() => null) : null])
  .then(([, profile, sessions]) => { const c = store.participant.current(); if(!c || c.studyId !== cur.studyId) return;
    if(profile) data.profile = profile; if(sessions) data.sessions = sessions; saveCache(cur.studyId, data); refreshedFor = cur.studyId; if(c.consented) render(); })
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
function streakOf(done){ const days = new Set(done.map(s => new Date(sessionTime(s)).setHours(0,0,0,0))); let d = new Date().setHours(0,0,0,0), n = 0; if(!days.has(d)) d -= DAY; while(days.has(d)){ n++; d -= DAY; } return n; }
const dl = rows => `<dl class="dl2">${rows.map(([k, v]) => `<div><dt>${esc(T(k))}</dt><dd>${v == null || v === "" ? "—" : v}</dd></div>`).join("")}</dl>`;
const panel = (ic, title, body, meta = "", flush = false) => `<section class="panel"><div class="panel-h"><h2>${icon(ic, 18)}${esc(T(title))}</h2>${meta}</div><div class="panel-b ${flush ? "flush" : ""}">${body}</div></section>`;
const empty = (ic, title, sub) => `<div class="empty2">${icon(ic, 34)}<b>${esc(T(title))}</b><span>${esc(T(sub))}</span></div>`;

function derived(cur){
  const prof = data.profile || {}, p = prof.participant || {};
  const done = (data.sessions || []).filter(s => isDone(s) && s.inputMode !== "mouse").sort((a, b) => sessionTime(b) - sessionTime(a));
  const gameIds = (Array.isArray(p.games) && p.games.length ? p.games : cur.games) || GAMES.map(g => g.id);
  const fb = (prof.feedback || []).slice().sort((a, b) => b.createdAt - a.createdAt);
  return { prof, p, done, games: gameIds.map(gameOf).filter(g => g.name), fb, unread: fb.filter(f => f.createdAt > seenAt(cur.studyId)).length, name: prof.identity && prof.identity.name };
}

// ── app shell ────────────────────────────────────────────────────────────────────────────────
function viewApp(cur){
  if(refreshedFor !== cur.studyId && !data.profile){ const c = loadCache(cur.studyId); if(c) data = c; }
  refresh(cur);
  let tab = location.hash.replace("#", ""); if(!TABS.includes(tab)) tab = "home";
  const d = derived(cur), initial = esc(((d.name || cur.studyId).trim()[0] || "P").toUpperCase());
  const items = [["home", "home", "Overview"], ["progress", "progress", "Progress"], ["health", "health", "My health"], ["messages", "message", "Messages"]];
  const cnt = k => k === "messages" && d.unread ? `<span class="count">${d.unread}</span>` : "";
  $("#side").innerHTML = `<div class="side-brand"><span class="logo">${icon("mark", 24)}</span><div><b>${esc(T("Virtual Therapy"))}</b><small>${esc(T("Patient portal"))}</small></div></div>
    <nav>${items.map(([k, ic, l]) => `<a href="#${k}" class="${tab === k ? "on" : ""}">${icon(ic, 19)}${esc(T(l))}${cnt(k)}</a>`).join("")}
      <div class="navlabel">${esc(T("Exercise"))}</div><a href="okc.html">${icon("play", 19)}${esc(T("Start exercises"))}</a></nav>
    <div class="side-foot"><div class="who"><span class="avatar">${initial}</span><div>${esc(d.name || T("Patient"))}<small>${esc(T("Study ID"))} ${esc(cur.studyId)}</small></div></div>
      ${langSeg()}<div class="row" style="gap:16px"><a href="therapy.html?choose=1">${icon("swap", 15)}${esc(T("Change role"))}</a><a href="?signout=1">${icon("logout", 15)}${esc(T("Sign out"))}</a></div></div>`;
  $("#ptTop").innerHTML = `<span class="brandmark">${icon("mark", 20)}</span><b>${esc(T("Virtual Therapy"))}</b><div class="right">${langSeg()}<a href="#health" class="avatar" style="width:32px;height:32px;border-radius:10px;text-decoration:none">${initial}</a></div>`;
  $("#pnav").innerHTML = items.map(([k, ic, l]) => `<a href="#${k}" class="${tab === k ? "on" : ""}">${icon(ic, 22)}${esc(T(l))}${cnt(k)}</a>`).join("");
  redraw = null; window.scrollTo(0, 0);
  ({ home: pageHome, progress: pageProgress, health: pageHealth, messages: pageMessages })[tab](cur, d);
}

// ── overview ─────────────────────────────────────────────────────────────────────────────────
function pageHome(cur, d){
  const target = DEFAULTS.prescribedPerWeek || 3, week = d.done.filter(s => sessionTime(s) >= mondayOf(Date.now())).length, left = Math.max(0, target - week);
  const lastOf = id => d.done.find(s => s.game === id), best = id => Math.max(0, ...d.done.filter(s => s.game === id).map(s => s.stars || 0));
  const next = d.games.slice().sort((a, b) => ((lastOf(a.id) && sessionTime(lastOf(a.id))) || 0) - ((lastOf(b.id) && sessionTime(lastOf(b.id))) || 0))[0];
  const q5 = avg(d.done.slice(0, 5).map(s => s.qualityPct)), hr = new Date().getHours();
  const hello = getLang() === "ur" ? T("Hello") : hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
  const latest = d.fb[0], fbBy = {}; d.fb.forEach(f => { if(f.sessionId) (fbBy[f.sessionId] ||= []).push(f); });
  $("#view").innerHTML = `
    <div class="pg-head"><div><div class="eyebrow">${esc(new Date().toLocaleDateString(loc(), { weekday:"long", day:"numeric", month:"long" }))}</div>
      <h1>${esc(hello)}${d.name ? ", " + esc(d.name.split(" ")[0]) : ""}</h1><p>${esc(T("Here is your plan for today."))}</p></div></div>
    ${next ? `<section class="next"><div><span class="gico">${icon(next.id, 28)}</span><div class="eyebrow">${esc(T("Next exercise"))}</div><h2>${esc(T(next.name))}</h2>
      <p>${esc(T(next.exercise))} · ${esc(T("about 5 minutes · keep your camera on"))}</p>
      <div class="row" style="gap:10px"><a class="btn-primary" href="okc.html?game=${next.id}">${icon("play", 18)} ${esc(T("Start session"))}</a><a class="btn-quiet" href="okc.html">${esc(T("All exercises"))}</a></div></div>
      <div class="weekring">${ring(week / target, { size:112, stroke:10, color:"#2DD4BF", track:"rgba(255,255,255,.12)", label:`${week}/${target}`, sub:esc(T("this week")) })}<small>${esc(left ? T("{n} more to reach your weekly goal", { n: left }) : T("Weekly goal reached"))}</small></div></section>` : ""}
    <div class="kpis">
      <div class="kpi"><div class="lbl">${icon("target", 16)}${esc(T("This week"))}</div><div class="val">${week}<small> / ${target}</small></div><div class="meter"><i style="width:${Math.min(100, week / target * 100)}%"></i></div></div>
      <div class="kpi"><div class="lbl">${icon("flame", 16)}${esc(T("Day streak"))}</div><div class="val">${streakOf(d.done)}</div><div class="sub">${esc(T("days in a row"))}</div></div>
      <div class="kpi"><div class="lbl">${icon("check", 16)}${esc(T("Completed"))}</div><div class="val">${d.done.length}</div><div class="sub">${esc(T("sessions in total"))}</div></div>
      <div class="kpi"><div class="lbl">${icon("activity", 16)}${esc(T("Average quality"))}</div><div class="val">${q5 == null ? "—" : Math.round(q5) + "%"}</div><div class="sub">${esc(T("last 5 sessions"))}</div></div></div>
    <div class="cols"><div>
      ${panel("clipboard", "Your exercise plan", `<div class="rows">${d.games.map(g => { const l = lastOf(g.id);
        return `<a class="rowi" href="okc.html?game=${g.id}">${gtile(g.id)}<div class="main"><b>${esc(T(g.name))}</b><span>${esc(T(g.exercise))}</span></div>
          <div class="end"><span class="hide-sm">${l ? esc(T("Last played {d}", { d: relDay(sessionTime(l)) })) : esc(T("Not played yet"))}</span>${stars(best(g.id))}<span class="startbtn">${icon("play", 16)}</span></div></a>`; }).join("")}</div>`,
        `<span class="meta">${esc(T("{n} of {m} games assigned by your therapist", { n: d.games.length, m: GAMES.length }))}</span>`, true)}
      ${panel("activity", "Recent activity", d.done.length ? `<div class="rows">${d.done.slice(0, 5).map(s => { const g = gameOf(s.game), f = fbBy[s.id];
        return `<div class="rowi">${gtile(s.game)}<div class="main"><b>${esc(T(g.name))}</b><span>${esc(relDay(sessionTime(s)))}${s.painBefore != null ? ` · ${esc(T("Pain"))} ${s.painBefore} → ${s.painAfter ?? "—"}` : ""}${f ? ` · ${esc(T("Therapist replied"))}` : ""}</span></div>
          <div class="end">${f ? `<a href="#messages" class="linkbtn">${icon("message", 16)}</a>` : ""}${qchip(s.qualityPct)}${stars(s.stars)}</div></div>`; }).join("")}</div>`
        : empty("activity", "No sessions yet", "Your completed exercises will appear here."), `<a class="linkbtn" href="#progress">${esc(T("View progress"))} ${icon("chevron", 14)}</a>`, true)}
    </div><div>
      ${panel("message", "From your therapist", latest ? `<div class="note ${latest.kind || ""} ${d.unread ? "unread" : ""}"><span class="who">${icon("doctor", 18)}</span><div class="grow">
          <div class="hd"><b>${esc(T("Your therapist"))}</b><span class="tag ${latest.kind || ""}">${esc(T((FB[latest.kind] || FB.note).t))}</span><span>${esc(relDay(latest.createdAt))}</span></div><p>${esc(latest.text)}</p></div></div>`
        : empty("inbox", "No messages yet", "Feedback from your therapist will appear here."), d.fb.length ? `<a class="linkbtn" href="#messages">${esc(T("All messages"))} ${icon("chevron", 14)}</a>` : "")}
      ${panel("shield", "Exercise safely", `<div class="callout">${icon("chair", 20)}<div>${esc(T("Keep a sturdy chair nearby. Stop if you feel sharp pain or dizziness, and tell your therapist."))}</div></div>`)}
    </div></div>`;
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
  const weekly = weeklyCounts(done, 8), q5 = avg(d.done.slice(0, 5).map(s => s.qualityPct)), pb = avg(d.done.slice(0, 10).map(s => s.painBefore)), pa = avg(d.done.slice(0, 10).map(s => s.painAfter));
  const month = d.done.filter(s => Date.now() - sessionTime(s) < 30 * DAY).length, r1 = v => v == null ? "—" : Math.round(v * 10) / 10;
  const rows = MEASURES.map(m => { const vals = as.map(a => num(m.get(a))).filter(v => v != null); if(!vals.length) return "";
    const b = vals[0], l = vals[vals.length - 1], dlt = vals.length > 1 ? Math.round((l - b) * 10) / 10 : null, good = dlt == null || dlt === 0 ? "" : ((m.better === "lower") === (dlt < 0) ? "up" : "down");
    return `<tr><td class="lbl">${esc(T(m.label))}</td><td class="n base">${r1(b)}</td><td class="n">${r1(l)}</td><td class="n">${dlt == null ? `<span class="delta">${esc(T("first"))}</span>` : `<span class="delta ${good}">${dlt > 0 ? "+" : ""}${dlt} · ${esc(T(good === "up" ? "improved" : good === "down" ? "worse" : "same"))}</span>`}</td></tr>`; }).join("");
  $("#view").innerHTML = `<div class="pg-head"><div><div class="eyebrow">${esc(T("Progress"))}</div><h1>${esc(T("My progress"))}</h1><p>${esc(T("Your exercise sessions and your therapist's measurements."))}</p></div></div>
    <div class="kpis"><div class="kpi"><div class="lbl">${icon("activity", 16)}${esc(T("Average quality"))}</div><div class="val">${q5 == null ? "—" : Math.round(q5) + "%"}</div><div class="sub">${esc(T("last 5 sessions"))}</div></div>
      <div class="kpi"><div class="lbl">${icon("health", 16)}${esc(T("Pain before → after"))}</div><div class="val">${r1(pb)} → ${r1(pa)}</div><div class="sub">${esc(T("0 = no pain, 10 = worst"))}</div></div>
      <div class="kpi"><div class="lbl">${icon("calendar", 16)}${esc(T("Last 30 days"))}</div><div class="val">${month}</div><div class="sub">${esc(T("sessions completed"))}</div></div>
      <div class="kpi"><div class="lbl">${icon("check", 16)}${esc(T("Completed"))}</div><div class="val">${d.done.length}</div><div class="sub">${esc(T("sessions in total"))}</div></div></div>
    <div class="cols-2">${panel("calendar", "Sessions per week", `<canvas id="pc0"></canvas>`)}${panel("activity", "Session quality (%)", `<canvas id="pc1"></canvas>`)}</div>
    ${panel("health", "Pain before and after exercise (0–10)", `<canvas id="pc2"></canvas>`)}
    ${panel("clipboard", "Clinical measurements", as.length ? `<table class="mtable"><thead><tr><th>${esc(T("Measure"))}</th><th style="text-align:end" class="base">${esc(T("Start"))}</th><th style="text-align:end">${esc(T("Latest"))}</th><th style="text-align:end">${esc(T("Change"))}</th></tr></thead><tbody>${rows}</tbody></table>`
      : empty("clipboard", "No check-ups yet", "Your therapist has not recorded any check-up results yet."), as.length ? `<span class="meta">${esc(T("Last check: {d}", { d: as[as.length - 1].timepoint + " · " + as[as.length - 1].date }))}</span>` : "", !!as.length)}
    ${as.length ? panel("calendar", "All check-ups", `<div class="rows">${as.slice().reverse().map(a => `<div class="rowi"><span class="gtile t2">${icon("clipboard", 20)}</span><div class="main"><b>${esc(a.timepoint)}</b><span>${esc(a.date)}${a.notes ? " · " + esc(a.notes) : ""}</span></div>
      <div class="end">${a.womac && a.womac.total != null ? `<span class="qchip">WOMAC ${a.womac.total}</span>` : ""}${a.vas != null ? `<span class="qchip">VAS ${a.vas}</span>` : ""}</div></div>`).join("")}</div>`, "", true) : ""}`;
  const lab = done.map(s => new Date(sessionTime(s)).toLocaleDateString(undefined, { day: "numeric", month: "short" }));
  redraw = () => { barChart($("#pc0"), { labels: weekly.map(w => w.label), values: weekly.map(w => w.n), ref: DEFAULTS.prescribedPerWeek, height: 190 });
    lineChart($("#pc1"), { labels: lab, series: [{ label: "Quality", data: done.map(s => s.qualityPct) }], min: 0, max: 100, height: 190 });
    lineChart($("#pc2"), { labels: lab, series: [{ label: T("Before"), color: COLORS[1], data: done.map(s => s.painBefore) }, { label: T("After"), color: COLORS[0], data: done.map(s => s.painAfter) }], min: 0, max: 10, height: 200 }); };
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
