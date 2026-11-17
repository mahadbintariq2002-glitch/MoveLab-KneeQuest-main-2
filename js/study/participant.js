// participant.js — patient side of Virtual Therapy. Sign-in (Study ID + access code) and consent, then the patient's
// dashboard with a bottom tab bar:
//   #home      weekly goal, streak, latest therapist message, assigned games (tap = straight into that game), recent sessions
//   #progress  charts of their sessions + assessment results (WOMAC, TUG, BBS, VAS, knee ROM) against baseline
//   #health    everything the researcher recorded: personal details (incl. CNIC), diagnosis, assigned games
//   #messages  the therapist's feedback, linked to the session it is about
// Data comes from the store (cloud: the rules let a linked device read its own records) and is cached for offline use.
import { getStore } from "./store.js";
import { T, setLang, getLang, initLang } from "../okc/i18n.js";
import { normalizeCode, GAMES, isDone, sessionTime, mondayOf, DEFAULTS, weeklyCounts, avg, DX_TYPES, DX_SIDES, bmiClass, latestDx } from "./schema.js";
import { ring, lineChart, barChart, COLORS } from "./charts.js";

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
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
  $$(".langbar button").forEach(b => b.onclick = async () => { setLang(b.dataset.l); if(store.participant.setLang) await store.participant.setLang(b.dataset.l); render(); });
  addEventListener("hashchange", () => render());
  let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => redraw && redraw(), 150); });
  render();
})();

function render(){
  $$(".langbar button").forEach(b => b.classList.toggle("on", b.dataset.l === getLang()));
  document.title = T("Virtual Therapy");
  const cur = store.participant.current();
  document.body.classList.toggle("has-nav", !!(cur && cur.consented));
  if(!cur){ $("#pnav").hidden = true; return viewLogin(); }
  if(!cur.consented){ $("#pnav").hidden = true; return viewConsent(cur); }
  viewDashboard(cur);
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
    try{ await store.participant.login($("#sid").value.trim(), normalizeCode($("#code").value)); data = { profile: null, sessions: [] }; location.hash = "#home"; render(); }
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
    if(profile) data.profile = profile; if(sessions) data.sessions = sessions; saveCache(cur.studyId, data); refreshedFor = cur.studyId; if(c.consented) viewDashboard(c); })
  .finally(() => { refreshing = false; });
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────
const relDay = t => { if(!t) return ""; const d = Math.floor((new Date().setHours(0,0,0,0) - new Date(t).setHours(0,0,0,0)) / DAY); return d <= 0 ? T("today") : d === 1 ? T("yesterday") : T("{n} days ago", { n: d }); };
const dateStr = t => t ? new Date(t).toLocaleDateString(getLang() === "ur" ? "ur-PK" : undefined, { day:"numeric", month:"short", year:"numeric" }) : "—";
const starsHtml = n => `<span class="stars">${"★".repeat(n || 0)}${"☆".repeat(3 - (n || 0))}</span>`;
const gameOf = id => GAMES.find(g => g.id === id) || { emoji:"🎮", name: id || "", exercise:"" };
const FB = { praise:{ ic:"👏", t:"Praise", cls:"good" }, tip:{ ic:"💡", t:"Tip", cls:"" }, caution:{ ic:"⚠️", t:"Caution", cls:"warn" }, note:{ ic:"📝", t:"Note", cls:"navy" } };
const seenKey = id => "vt_fb_seen_" + id;
const seenAt = id => { try{ return Number(localStorage.getItem(seenKey(id))) || 0; }catch(e){ return 0; } };
function streakOf(done){
  const days = new Set(done.map(s => new Date(sessionTime(s)).setHours(0,0,0,0))); let d = new Date().setHours(0,0,0,0), n = 0;
  if(!days.has(d)) d -= DAY;                                  // a streak is still alive if the last session was yesterday
  while(days.has(d)){ n++; d -= DAY; } return n;
}
const kv = rows => `<dl class="kv">${rows.filter(r => r).map(([k, v]) => `<dt>${esc(T(k))}</dt><dd>${v == null || v === "" ? "—" : v}</dd>`).join("")}</dl>`;

function viewDashboard(cur){
  if(refreshedFor !== cur.studyId && !data.profile){ const c = loadCache(cur.studyId); if(c) data = c; }
  refresh(cur);
  let tab = location.hash.replace("#", ""); if(!TABS.includes(tab)) tab = "home";
  const fb = ((data.profile && data.profile.feedback) || []).slice().sort((a, b) => b.createdAt - a.createdAt), unread = fb.filter(f => f.createdAt > seenAt(cur.studyId)).length;
  const nav = $("#pnav"); nav.hidden = false;
  nav.innerHTML = [["home", "🏠", "Home"], ["progress", "📈", "Progress"], ["health", "🩺", "My health"], ["messages", "💬", "Messages"]]
    .map(([k, ic, l]) => `<a href="#${k}" class="${tab === k ? "on" : ""}"><span class="ic">${ic}${k === "messages" && unread ? `<i class="dot">${unread}</i>` : ""}</span>${esc(T(l))}</a>`).join("");
  redraw = null; window.scrollTo(0, 0);
  ({ home: tabHome, progress: tabProgress, health: tabHealth, messages: tabMessages })[tab](cur, fb, unread);
}

// ── home ─────────────────────────────────────────────────────────────────────────────────────
function tabHome(cur, fb, unread){
  const sessions = data.sessions || [], prof = data.profile || {}, p = prof.participant || {}, name = prof.identity && prof.identity.name;
  const target = DEFAULTS.prescribedPerWeek || 3, done = sessions.filter(s => isDone(s) && s.inputMode !== "mouse");
  const week = done.filter(s => sessionTime(s) >= mondayOf(Date.now())).length, left = Math.max(0, target - week), streak = streakOf(done);
  const starsTotal = done.reduce((a, s) => a + (s.stars || 0), 0), best = id => Math.max(0, ...done.filter(s => s.game === id).map(s => s.stars || 0));
  const gameIds = (Array.isArray(p.games) && p.games.length ? p.games : cur.games) || GAMES.map(g => g.id), games = gameIds.map(id => GAMES.find(g => g.id === id)).filter(Boolean);
  const recent = [...done].sort((a, b) => sessionTime(b) - sessionTime(a)).slice(0, 4), fbBy = {}; fb.forEach(f => { if(f.sessionId) (fbBy[f.sessionId] ||= []).push(f); });
  const hr = new Date().getHours(), hello = getLang() === "ur" ? T("Hello") : (hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening");
  const latest = fb[0];
  $("#view").innerHTML = `
    <div class="p-hero"><h1>${esc(hello)}${name ? ", " + esc(name.split(" ")[0]) : ""} 👋</h1><p>${esc(T("Ready for today's knee exercises?"))}</p><span class="idchip">${esc(T("Study ID"))}: ${esc(cur.studyId)}</span>
      <div class="p-goal">${ring(week / target, { size:86, stroke:9, color:"#FF8E72", track:"rgba(255,255,255,.22)", label:`${week}/${target}`, sub:esc(T("this week")) })}
        <div><h3>${esc(T("Weekly goal"))}</h3><p>${esc(left ? T("{n} more session(s) to reach this week's goal.", { n: left }) : T("Goal reached — well done! 🎉"))}</p></div></div></div>
    <div class="p-stats"><div class="p-stat"><b>🔥 ${streak}</b><span>${esc(T("Day streak"))}</span></div><div class="p-stat"><b>✅ ${done.length}</b><span>${esc(T("Sessions"))}</span></div><div class="p-stat"><b>⭐ ${starsTotal}</b><span>${esc(T("Stars"))}</span></div></div>
    ${latest ? `<a class="p-msg ${unread ? "new" : ""}" href="#messages"><span class="mi">${(FB[latest.kind] || FB.note).ic}</span><div class="grow"><b>${esc(T(unread ? "New message from your therapist" : "Latest message from your therapist"))}</b>
      <p>${esc(latest.text.length > 110 ? latest.text.slice(0, 108) + "…" : latest.text)}</p><span class="tiny">${esc(relDay(latest.createdAt))}</span></div><span class="go">›</span></a>` : ""}
    <div class="section-title"><h2>${esc(T("Your exercises"))}</h2><span class="muted small">${esc(T("{n} of {m} games assigned by your therapist", { n: games.length, m: GAMES.length }))}</span></div>
    <div class="p-games">${games.map(g => `<a class="p-game g${GAMES.indexOf(g)}" href="okc.html?game=${g.id}"><span class="em">${g.emoji}</span><b>${esc(T(g.name))}</b><span>${esc(T(g.exercise))}</span>${starsHtml(best(g.id))}</a>`).join("")}</div>
    <a class="btn coral" href="okc.html" style="width:100%;margin-top:16px;padding:16px;font-size:18px;border-radius:18px">▶ ${esc(T("Start exercises"))}</a>
    <div class="tipcard"><span class="ti">🪑</span><div>${esc(T("Keep a sturdy chair nearby. Stop if you feel sharp pain or dizziness, and tell your therapist."))}</div></div>
    <div class="section-title"><h2>${esc(T("Recent sessions"))}</h2><a class="small" href="#progress">${esc(T("See progress"))} ›</a></div>
    <div class="p-recent">${recent.map(s => { const g = gameOf(s.game), f = fbBy[s.id];
      return `<div class="p-rec"><span class="em">${g.emoji}</span><div class="what"><b>${esc(T(g.name))}</b><span>${esc(relDay(sessionTime(s)))} · ${s.qualityPct ?? "—"}%${s.painBefore != null ? ` · ${esc(T("Pain"))} ${s.painBefore}→${s.painAfter ?? "—"}` : ""}</span>
        ${f ? `<a class="fbline" href="#messages">💬 ${esc(f[0].text.length > 70 ? f[0].text.slice(0, 68) + "…" : f[0].text)}</a>` : ""}</div>${starsHtml(s.stars)}</div>`; }).join("")
      || `<div class="p-rec"><span class="em">🌱</span><div class="what"><span>${esc(T("No sessions yet — your first one will appear here."))}</span></div></div>`}</div>
    ${demoNote()}${foot(true)}`;
}

// ── progress ─────────────────────────────────────────────────────────────────────────────────
const MEASURES = [
  { k:"womac", label:"WOMAC total (0–96)", get:a => a.womac && a.womac.total, better:"lower" },
  { k:"womacP", label:"WOMAC pain (0–20)", get:a => a.womac && a.womac.pain, better:"lower" },
  { k:"womacS", label:"WOMAC stiffness (0–8)", get:a => a.womac && a.womac.stiffness, better:"lower" },
  { k:"womacF", label:"WOMAC function (0–68)", get:a => a.womac && a.womac.function, better:"lower" },
  { k:"tug", label:"Timed Up and Go (seconds)", get:a => a.tug && a.tug.seconds, better:"lower" },
  { k:"bbs", label:"Berg Balance (0–56)", get:a => a.bbs && a.bbs.total, better:"higher" },
  { k:"vas", label:"Pain score VAS (0–100)", get:a => a.vas, better:"lower" },
  { k:"lf", label:"Left knee bending (°)", get:a => a.rom && a.rom.left && a.rom.left.flexion, better:"higher" },
  { k:"le", label:"Left knee straightening gap (°)", get:a => a.rom && a.rom.left && a.rom.left.extension, better:"lower" },
  { k:"rf", label:"Right knee bending (°)", get:a => a.rom && a.rom.right && a.rom.right.flexion, better:"higher" },
  { k:"re", label:"Right knee straightening gap (°)", get:a => a.rom && a.rom.right && a.rom.right.extension, better:"lower" },
];
const num = v => (v == null || v === "" || Number.isNaN(Number(v))) ? null : Number(v);
function tabProgress(cur){
  const done = (data.sessions || []).filter(s => isDone(s) && s.inputMode !== "mouse").sort((a, b) => sessionTime(a) - sessionTime(b));
  const as = ((data.profile && data.profile.assessments) || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const base = as[0], last = as[as.length - 1], weekly = weeklyCounts(done, 8);
  const q = avg(done.slice(-5).map(s => s.qualityPct)), pb = avg(done.slice(-10).map(s => s.painBefore)), pa = avg(done.slice(-10).map(s => s.painAfter));
  const cards = MEASURES.map(m => { const vals = as.map(a => num(m.get(a))).filter(v => v != null); if(!vals.length) return "";
    const l = vals[vals.length - 1], b = vals[0], dl = vals.length > 1 ? Math.round((l - b) * 10) / 10 : null, good = dl == null || dl === 0 ? "" : ((m.better === "lower") === (dl < 0) ? "better" : "worse");
    return `<div class="p-measure ${good}"><small>${esc(T(m.label))}</small><b>${Math.round(l * 10) / 10}</b>${dl != null ? `<span class="chg">${dl > 0 ? "▲" : dl < 0 ? "▼" : "•"} ${Math.abs(dl)} ${esc(T(good === "better" ? "better than at the start" : good === "worse" ? "worse than at the start" : "no change"))}</span>` : `<span class="chg">${esc(T("first measurement"))}</span>`}</div>`; }).join("");
  $("#view").innerHTML = `<div class="p-head2"><h1>📈 ${esc(T("My progress"))}</h1><p class="muted">${esc(T("Your exercise sessions and your therapist's measurements."))}</p></div>
    <div class="p-stats"><div class="p-stat"><b>${q == null ? "—" : Math.round(q) + "%"}</b><span>${esc(T("Avg quality (last 5)"))}</span></div><div class="p-stat"><b>${pb == null ? "—" : Math.round(pb * 10) / 10}→${pa == null ? "—" : Math.round(pa * 10) / 10}</b><span>${esc(T("Pain before → after"))}</span></div><div class="p-stat"><b>${done.length}</b><span>${esc(T("Sessions"))}</span></div></div>
    <div class="chartcard p-chart"><h3>${esc(T("Sessions per week"))}</h3><canvas id="pc0"></canvas></div>
    <div class="chartcard p-chart"><h3>${esc(T("Session quality (%)"))}</h3><canvas id="pc1"></canvas></div>
    <div class="chartcard p-chart"><h3>${esc(T("Pain before and after exercise (0–10)"))}</h3><canvas id="pc2"></canvas></div>
    <div class="section-title" style="margin-top:18px"><h2>🩺 ${esc(T("Results from your therapist"))}</h2><span class="muted small">${as.length ? esc(T("Last check: {d}", { d: last.timepoint + " · " + last.date })) : ""}</span></div>
    ${as.length ? `<div class="p-measures">${cards}</div>
      ${as.length > 1 ? `<div class="chartcard p-chart"><h3>${esc(T("WOMAC total (lower is better)"))}</h3><canvas id="pc3"></canvas></div>` : ""}
      <div class="pcard" style="padding:14px"><h3>${esc(T("All check-ups"))}</h3>${as.slice().reverse().map(a => `<div class="p-rec" style="margin-bottom:8px"><span class="em">📋</span><div class="what"><b>${esc(a.timepoint)}</b><span>${esc(a.date)}${a.womac && a.womac.total != null ? ` · WOMAC ${a.womac.total}` : ""}${a.tug && a.tug.seconds ? ` · TUG ${a.tug.seconds}s` : ""}${a.vas != null ? ` · VAS ${a.vas}` : ""}</span>${a.notes ? `<span class="fbline" style="pointer-events:none">📝 ${esc(a.notes)}</span>` : ""}</div></div>`).join("")}</div>`
      : `<div class="pcard center muted">📋 ${esc(T("Your therapist has not recorded any check-up results yet."))}</div>`}
    ${foot(true)}`;
  const lab = done.map(s => new Date(sessionTime(s)).toLocaleDateString(undefined, { day: "numeric", month: "short" }));
  redraw = () => { barChart($("#pc0"), { labels: weekly.map(w => w.label), values: weekly.map(w => w.n), ref: DEFAULTS.prescribedPerWeek, height: 170 });
    lineChart($("#pc1"), { labels: lab, series: [{ label: "Quality", data: done.map(s => s.qualityPct) }], min: 0, max: 100, height: 170 });
    lineChart($("#pc2"), { labels: lab, series: [{ label: T("Before"), color: COLORS[1], data: done.map(s => s.painBefore) }, { label: T("After"), color: COLORS[0], data: done.map(s => s.painAfter) }], min: 0, max: 10, height: 170 });
    if($("#pc3")) lineChart($("#pc3"), { labels: as.map(a => a.timepoint), series: [{ label: "WOMAC", data: as.map(a => num(a.womac && a.womac.total)) }], min: 0, max: 96, height: 170 }); };
  redraw();
}

// ── my health ────────────────────────────────────────────────────────────────────────────────
function tabHealth(cur){
  const prof = data.profile || {}, p = prof.participant || {}, d = p.demographics || {}, id = prof.identity || {}, dx = latestDx(prof.diagnoses || []);
  const games = ((Array.isArray(p.games) && p.games.length ? p.games : cur.games) || GAMES.map(g => g.id)).map(gameOf);
  const pdur = m => m == null ? "—" : m >= 12 ? `${Math.floor(m/12)} ${T("years")}${m%12 ? " " + (m%12) + " " + T("months") : ""}` : `${m} ${T("months")}`;
  const side = dx && (DX_SIDES.find(s => s.v === dx.side) || {}).label, type = dx && (dx.type === "other" ? dx.otherText : (DX_TYPES.find(t => t.v === dx.type) || {}).label);
  const L = dx && (dx.side === "left" || dx.side === "bilateral"), R = dx && (dx.side === "right" || dx.side === "bilateral");
  const knee = (on, kl, label) => `<div class="knee ${on ? "on" : ""}"><small>${esc(T(label))}</small><b>${on ? (kl ?? "–") : "—"}</b><small>${esc(T(on ? "KL grade" : "not affected"))}</small></div>`;
  $("#view").innerHTML = `<div class="p-head2"><h1>🩺 ${esc(T("My health"))}</h1><p class="muted">${esc(T("Everything your therapist has recorded for you."))}</p></div>
    <div class="pcard"><div class="row" style="flex-wrap:nowrap;gap:14px;margin-bottom:12px"><span class="avatar lg c1">${esc((id.name || cur.studyId).trim().charAt(0).toUpperCase())}</span><div><h2 style="margin:0">${esc(id.name || T("Patient"))}</h2><span class="muted small">${esc(T("Study ID"))}: <b>${esc(cur.studyId)}</b>${p.group ? ` · ${esc(p.group)}` : ""}</span></div></div>
      <h3>👤 ${esc(T("Personal details"))}</h3>${kv([["Name", esc(id.name)], ["CNIC number", esc(id.cnic)], ["Age", d.age ? esc(d.age) + " " + esc(T("years")) : ""], ["Gender", esc(T(d.gender || ""))], ["Residence", esc(d.residence)],
        ["Education", esc(d.education)], ["Occupation", esc(d.occupation)], ["Marital status", esc(T(d.marital || ""))], ["Knee pain for", esc(pdur(d.painDurationMonths))], ["Knee OA grade (KL)", esc(d.klGrade)],
        ["Enrolled on", esc(dateStr(p.enrolledAt))], ["Consent given", esc(dateStr(prof.consentAt))]])}</div>
    <div class="pcard"><h3>🦵 ${esc(T("My diagnosis"))}</h3>
      ${dx ? `<h2 style="margin:4px 0 8px;font-size:19px">${esc(type)}</h2><div class="chips" style="margin-bottom:12px">${dx.icd10 ? `<span class="dx-icd">ICD-10 ${esc(dx.icd10)}</span>` : ""}${side ? `<span class="pill coral">${esc(T(side))}</span>` : ""}${dx.imaging ? `<span class="pill navy">📷 ${esc(dx.imaging)}</span>` : ""}</div>
        <div class="knees" style="margin-bottom:12px">${knee(R, dx.klRight, "Right knee")}${knee(L, dx.klLeft, "Left knee")}</div>
        ${kv([["Diagnosed on", esc(dx.diagnosedOn)], ["Diagnosed by", esc(dx.diagnosedBy)], ["Height", dx.heightCm ? esc(dx.heightCm) + " cm" : ""], ["Weight", dx.weightKg ? esc(dx.weightKg) + " kg" : ""],
          ["BMI", dx.bmi != null ? `${esc(dx.bmi)} <span class="muted small">${esc(T(bmiClass(dx.bmi)))}</span>` : ""],
          ["Other conditions", [...(dx.comorbidities || []), ...(dx.comorbidityOther ? [dx.comorbidityOther] : [])].map(c => `<span class="pill navy">${esc(T(c))}</span>`).join(" ") || esc(T("None recorded"))],
          ["Medicines", esc(dx.medications)]])}
        ${(dx.precautions || []).length ? `<div class="tipcard" style="background:#FEE2E2;border-color:#FCA5A5;color:#7F1D1D;margin:14px 0 0"><span class="ti">⚠️</span><div><b>${esc(T("Take care while exercising"))}</b><br>${dx.precautions.map(c => esc(T(c))).join(" · ")}</div></div>` : ""}
        ${dx.notes ? `<h3 style="margin-top:14px">📝 ${esc(T("Therapist's notes"))}</h3><p style="white-space:pre-wrap">${esc(dx.notes)}</p>` : ""}`
        : `<p class="muted">${esc(T("Your therapist has not recorded a diagnosis yet."))}</p>`}</div>
    <div class="pcard"><h3>🎮 ${esc(T("My exercise plan"))}</h3><p class="muted small">${esc(T("{n} of {m} games assigned by your therapist", { n: games.length, m: GAMES.length }))} · ${esc(T("Aim for {n} sessions a week.", { n: DEFAULTS.prescribedPerWeek }))}</p>
      <div class="gamelist">${games.map(g => `<a href="okc.html?game=${g.id}" style="display:flex;gap:10px;align-items:center;text-decoration:none;color:inherit" class="p-rec"><span class="em">${g.emoji}</span><div class="what"><b>${esc(T(g.name))}</b><span>${esc(T(g.exercise))}</span></div><span class="go" style="color:var(--coral-d);font-weight:800">▶</span></a>`).join("")}</div></div>
    ${foot(true)}`;
}

// ── messages (therapist feedback) ────────────────────────────────────────────────────────────
function tabMessages(cur, fb){
  const ss = data.sessions || [], seen = seenAt(cur.studyId);
  $("#view").innerHTML = `<div class="p-head2"><h1>💬 ${esc(T("Messages"))}</h1><p class="muted">${esc(T("Feedback from your therapist on your exercises."))}</p></div>
    ${fb.length ? fb.map(f => { const k = FB[f.kind] || FB.note, s = f.sessionId && ss.find(x => x.id === f.sessionId), g = gameOf((s && s.game) || f.game);
      return `<div class="p-fb ${f.createdAt > seen ? "new" : ""}"><div class="row between" style="flex-wrap:nowrap"><span class="pill ${k.cls}">${k.ic} ${esc(T(k.t))}</span><span class="tiny muted">${esc(relDay(f.createdAt))}${f.createdAt > seen ? ` · <b style="color:var(--coral-d)">${esc(T("New"))}</b>` : ""}</span></div>
        <p class="txt">${esc(f.text)}</p>
        ${s || f.game ? `<div class="p-rec about"><span class="em">${g.emoji}</span><div class="what"><b>${esc(T(g.name))}</b><span>${s ? `${esc(dateStr(sessionTime(s)))} · ${s.qualityPct ?? "—"}% · ${s.repsDone ?? "—"}/${s.repsTarget ?? "—"} ${esc(T("reps"))}` : ""}</span></div>${s ? starsHtml(s.stars) : ""}</div>`
          : `<span class="tiny muted">${esc(T("General message"))}</span>`}</div>`; }).join("")
      : `<div class="pcard center"><div style="font-size:42px">📭</div><p class="muted">${esc(T("No messages yet. Your therapist's feedback on your games will appear here."))}</p></div>`}
    ${foot(true)}`;
  if(fb.length){ try{ localStorage.setItem(seenKey(cur.studyId), String(fb[0].createdAt)); }catch(e){} const dot = $("#pnav .dot"); if(dot) dot.remove(); }
}
