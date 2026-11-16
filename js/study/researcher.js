// researcher.js — Virtual Therapy research console (laptop + phone). Talks only to the store (local or cloud).
//   #/              Overview: KPIs, study activity, recent sessions, who needs attention
//   #/list          Participants
//   #/p/ID/(outcomes|games|diagnosis|details)   Participant profile
//   #/assess/ID[/aid] · #/add · #/export · #/settings
import { getStore } from "./store.js";
import * as S from "./schema.js";
import { lineChart, barChart, ring, COLORS } from "./charts.js";

const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const app = $("#app");
let store, settings, user, redraw = null;
const GAME_NAMES = Object.fromEntries(S.GAMES.map(g => [g.id, g.name])), GAME_EMOJI = Object.fromEntries(S.GAMES.map(g => [g.id, g.emoji]));
const gname = s => GAME_NAMES[s.game] || s.gameName || s.game;
// Checkbox grid for a participant's game prescription (used when adding a participant and on "Details & access").
const gamePicker = (selected) => `<div class="gamepick">${S.GAMES.map(g => `<label><input type="checkbox" name="game" value="${g.id}" ${selected.includes(g.id) ? "checked" : ""}><span>${g.emoji} ${esc(g.name)}<span class="hint">${esc(g.exercise)}</span></span></label>`).join("")}</div>`;
const pickedGames = root => $$('input[name="game"]:checked', root).map(el => el.value);

const toast = m => { const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toast._h); toast._h = setTimeout(() => t.classList.remove("on"), 2400); };
const fmtDate = t => t ? new Date(t).toLocaleDateString(undefined, { day:"numeric", month:"short", year:"numeric" }) : "—";
const fmtDT = t => t ? new Date(t).toLocaleString(undefined, { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" }) : "—";
const ago = t => { if(!t) return "never"; const d = Math.floor((Date.now()-t)/86400000); return d <= 0 ? "today" : d === 1 ? "yesterday" : d + " days ago"; };
const agoShort = t => { if(!t) return ""; const m = Math.round((Date.now()-t)/60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m/60) + " h ago" : Math.round(m/1440) + " d ago"; };
const r1 = v => v == null ? "—" : (Math.round(v*10)/10);
const stars = n => n == null ? "" : `<span class="stars">${"★".repeat(n)}${"☆".repeat(Math.max(0, 3-n))}</span>`;
const avatar = (id, cls = "") => { const n = parseInt(String(id).replace(/\D/g, ""), 10) || 0; return `<span class="avatar c${(n % 5) + 1} ${cls}">${esc(String(id).replace(/^P/, ""))}</span>`; };
// Inside the Android app a blob download goes nowhere, so the file is handed to the app (it opens the share sheet: Drive, WhatsApp, email…).
const droid = () => { const b = typeof window !== "undefined" && window.AndroidBridge; return b || null; };
const patientUrl = () => { try{ const b = droid(); if(b && b.getContext){ const c = JSON.parse(b.getContext() || "{}"); if(c.publicBase) return c.publicBase + "therapy.html"; } }catch(e){} return location.origin + location.pathname.replace(/researcher\.html$/, "therapy.html"); };
function download(name, text){ const b = droid(); if(b && b.saveFile){ try{ b.saveFile(name, "text/csv", text); return; }catch(e){} } const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type:"text/csv;charset=utf-8" })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
const pdur = m => m >= 12 ? `${Math.floor(m/12)} y${m%12 ? " " + (m%12) + " m" : ""}` : `${m} m`;
const camera = list => list.filter(s => s.inputMode !== "mouse");
const listDx = id => store.listDiagnoses ? store.listDiagnoses(id).catch(() => []) : Promise.resolve([]);
const adhClass = a => a >= 80 ? "" : a >= 40 ? "warn" : "bad";
const adhBar = a => `<div class="adh"><div class="bar ${adhClass(a)}" style="width:90px"><i style="width:${Math.max(3, a)}%"></i></div>${a}%</div>`;
const pageHead = (title, sub = "", actions = "") => `<div class="page-head"><div><h1>${title}</h1>${sub ? `<p class="muted">${sub}</p>` : ""}</div><div class="row">${actions}</div></div>`;

// ── boot / routing ───────────────────────────────────────────────────────────────────────────
(async function boot(){
  try{ localStorage.setItem("vt_role", "researcher"); }catch(e){}       // next launch of the app opens the researcher side
  const closeNav = () => document.body.classList.remove("nav-open");
  $("#hamb").onclick = () => document.body.classList.toggle("nav-open"); $("#backdrop").onclick = closeNav;
  $$("#nav a").forEach(a => a.addEventListener("click", closeNav));
  store = await getStore();
  $("#modeBadge").textContent = store.mode === "cloud" ? "Cloud · live" : "Local demo mode"; $("#modeBadge").className = "badge " + (store.mode === "cloud" ? "good" : "warn");
  $("#signOut").onclick = async () => { await store.researcher.signOut(); user = null; route(); };
  store.researcher.onChange(async u => { user = u; const cloud = store.mode === "cloud";
    $("#userLabel").textContent = u ? u.email : ""; $("#whoBox").hidden = !(u && cloud); $("#whoAv").textContent = u && u.email ? u.email[0].toUpperCase() : "R";
    $("#signOut").hidden = !(u && cloud); if(u) settings = await store.getSettings(); route(); });
  addEventListener("hashchange", route);
  let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => redraw && redraw(), 150); });
})();

async function route(){
  redraw = null;
  if(!store) return;
  if(store.mode === "cloud" && !user){ $$("#nav a[data-r]").forEach(a => a.classList.remove("on")); return viewLogin(); }
  if(!settings) settings = await store.getSettings();
  const parts = (location.hash.replace(/^#\/?/, "") || "").split("/");
  const nav = parts[0] === "p" || parts[0] === "assess" ? "list" : parts[0];
  $$("#nav a[data-r]").forEach(a => a.classList.toggle("on", a.dataset.r === nav));
  window.scrollTo(0, 0);
  try{
    switch(parts[0]){
      case "": return await viewOverview();
      case "list": return await viewList();
      case "add": return viewAdd();
      case "p": return await viewParticipant(parts[1], parts[2] || "outcomes");
      case "assess": return await viewAssess(parts[1], parts[2]);
      case "export": return await viewExport();
      case "settings": return await viewSettings();
      default: app.innerHTML = `<div class="card empty">Page not found. <a href="#/">Back to overview</a></div>`;
    }
  }catch(e){ console.error(e); app.innerHTML = `<div class="err">${esc(e.message || e)}</div><a href="#/">← Overview</a>`; }
}

function viewLogin(){
  app.innerHTML = `<div style="max-width:440px;margin:6vh auto 0"><div class="hero-r" style="text-align:center"><h1>Welcome back</h1><p>Sign in to the Virtual Therapy research console.</p></div>
    <div class="card" style="padding:24px"><div id="lerr"></div><form id="lf"><div class="field"><label>Email</label><input type="email" id="le" autocomplete="username" required></div>
    <div class="field"><label>Password</label><input type="password" id="lp" autocomplete="current-password" required></div>
    <button class="btn" style="width:100%;padding:12px">Sign in</button></form>
    <p class="muted small" style="margin:14px 0 0">Researcher accounts are created by the project owner in the Firebase console (see cloud/SETUP.md).</p></div></div>`;
  $("#lf").onsubmit = async e => { e.preventDefault(); $("#lerr").innerHTML = ""; const b = $("#lf button"); b.disabled = true; b.textContent = "Signing in…";
    try{ user = await store.researcher.signIn($("#le").value.trim(), $("#lp").value); settings = await store.getSettings(); route(); }
    catch(err){ b.disabled = false; b.textContent = "Sign in"; $("#lerr").innerHTML = `<div class="err">${esc(err.message)}</div>`; } };
}

// shared: per-participant analytics rows
function buildRows(ps, ss){
  const by = {}; for(const s of camera(ss)) (by[s.studyId] ||= []).push(s);
  return ps.map(p => { const sess = by[p.studyId] || [], n7 = S.sessionsInLastDays(sess, 7), fl = S.flags(sess);
    return { p, sess, n7, la: S.lastActive(sess), fl, alert: fl.some(f => f.k !== "none"), total: sess.filter(S.isDone).length, adh: Math.min(100, Math.round(n7 / (settings.prescribedPerWeek || 3) * 100)) }; });
}

// ── overview ─────────────────────────────────────────────────────────────────────────────────
async function viewOverview(){
  app.innerHTML = `<p class="muted">Loading…</p>`;
  const [ps, ss, dxs] = await Promise.all([store.listParticipants(), store.listSessions(), listDx()]);
  const rows = buildRows(ps, ss), cam = camera(ss), done = cam.filter(S.isDone);
  const active = rows.filter(r => r.n7 > 0).length, week = rows.reduce((a, r) => a + r.n7, 0), alerts = rows.filter(r => r.alert);
  const avgAdh = rows.length ? Math.round(rows.reduce((a, r) => a + r.adh, 0) / rows.length) : 0;
  const month = ps.filter(p => Date.now() - (p.enrolledAt || 0) < 30*86400000).length;
  const h = new Date().getHours(), greet = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const recent = [...cam].sort((a, b) => S.sessionTime(b) - S.sessionTime(a)).slice(0, 8);
  const byGame = S.GAMES.map(g => ({ g, n: done.filter(s => s.game === g.id).length })).sort((a, b) => b.n - a.n), maxG = Math.max(1, ...byGame.map(x => x.n));
  const latestBy = {}; for(const d of dxs){ if(!latestBy[d.studyId] || (d.createdAt || 0) > (latestBy[d.studyId].createdAt || 0)) latestBy[d.studyId] = d; }
  const sides = { right: 0, left: 0, bilateral: 0 }; Object.values(latestBy).forEach(d => { if(sides[d.side] != null) sides[d.side]++; });
  const kl = [1,2,3,4].map(g => ps.filter(p => Number(p.demographics && p.demographics.klGrade) === g).length);
  const pain = S.avg(done.slice(-30).map(s => s.painBefore)), painA = S.avg(done.slice(-30).map(s => s.painAfter)), q = S.avg(done.slice(-30).map(s => s.qualityPct));

  app.innerHTML = `
    <div class="hero-r"><div class="row between" style="align-items:flex-end;gap:18px">
      <div><p class="small" style="margin-bottom:6px;font-weight:700;letter-spacing:.04em">${esc(new Date().toLocaleDateString(undefined, { weekday:"long", day:"numeric", month:"long" }))}</p>
      <h1>${greet}${store.mode === "cloud" && user && user.email ? ", " + esc(user.email.split("@")[0]) : ""} 👋</h1>
      <p>${week} completed session${week === 1 ? "" : "s"} this week from ${active} of ${ps.length} participant${ps.length === 1 ? "" : "s"}.${alerts.length ? ` <b style="color:#FFD2C4">${alerts.length} need${alerts.length === 1 ? "s" : ""} attention.</b>` : ""}</p></div>
      <div class="row"><a class="btn coral" href="#/add">＋ Add participant</a><a class="btn ghost" href="#/list">View all</a></div></div></div>
    ${store.mode !== "cloud" ? `<div class="ok">Local demo mode — data stays in this browser (not remote tracking). <a href="#/settings">Settings</a></div>` : ""}
    <div class="tiles">
      <div class="tile"><span class="ic">👥</span><b>${ps.length}</b><span>Participants</span><div class="trend">${month ? "+" + month + " this month" : "&nbsp;"}</div></div>
      <div class="tile t-navy"><span class="ic">⚡</span><b>${active}<small class="muted" style="font-size:15px">/${ps.length}</small></b><span>Active in last 7 days</span></div>
      <div class="tile t-coral"><span class="ic">🎮</span><b>${week}</b><span>Sessions this week</span><div class="trend" style="color:var(--muted)">${done.length} completed in total</div></div>
      <div class="tile t-violet"><span class="ic">🎯</span><b>${avgAdh}%</b><span>Average adherence</span><div class="bar ${adhClass(avgAdh)}" style="margin-top:8px"><i style="width:${avgAdh}%"></i></div></div>
      <div class="tile t-amber"><span class="ic">⚠️</span><b style="color:${alerts.length ? "var(--bad)" : "inherit"}">${alerts.length}</b><span>Need attention</span></div>
    </div>
    <div class="grid-2">
      <div class="chartcard"><div class="section-title"><h2>Study activity</h2><span class="muted small">Completed sessions per week · target ${settings.prescribedPerWeek * Math.max(1, ps.length)}</span></div><canvas id="o0"></canvas></div>
      <div class="card" style="margin:0"><div class="section-title"><h2>Session quality & pain</h2><span class="muted small">last 30 sessions</span></div>
        <div class="row" style="justify-content:space-around;gap:20px;padding:6px 0">
          ${ring((q || 0)/100, { size:116, stroke:12, color:"#14B8A6", label: q == null ? "—" : Math.round(q) + "%", sub:"avg quality" })}
          ${ring(pain == null ? 0 : 1 - pain/10, { size:116, stroke:12, color:"#FF7A59", label: pain == null ? "—" : r1(pain) + "→" + r1(painA), sub:"pain before→after" })}
          ${ring(avgAdh/100, { size:116, stroke:12, color:"#1E4A73", label: avgAdh + "%", sub:"adherence" })}
        </div></div>
    </div>
    <div class="grid-2" style="margin-top:16px">
      <div class="card"><div class="section-title"><h2>Recent activity</h2><a class="small" href="#/list">All participants →</a></div>
        <div class="feed">${recent.map(s => `<a class="feed-item" href="#/p/${esc(s.studyId)}/games"><span class="gm">${GAME_EMOJI[s.game] || "🎮"}</span>
          <div class="what"><b>${esc(s.studyId)} · ${esc(gname(s))}</b><span>${s.status === "completed" ? `${s.qualityPct ?? "—"}% quality · ${s.repsDone ?? "—"}/${s.repsTarget ?? "—"} reps` : esc(String(s.status).replace("_", " "))}${s.painBefore != null ? ` · pain ${s.painBefore}→${s.painAfter ?? "—"}` : ""}</span></div>
          <div style="text-align:end">${stars(s.stars)}<div class="tiny muted">${agoShort(S.sessionTime(s))}</div></div></a>`).join("") || `<div class="empty">No sessions yet. They appear here as soon as a patient finishes a game.</div>`}</div></div>
      <div class="stack">
        <div class="card" style="margin:0"><div class="section-title"><h2>Needs attention</h2><span class="pill ${alerts.length ? "bad" : "good"}">${alerts.length || "All clear"}</span></div>
          ${alerts.length ? `<div class="feed">${alerts.slice(0, 6).map(r => `<a class="feed-item" href="#/p/${esc(r.p.studyId)}/games">${avatar(r.p.studyId)}<div class="what"><b>${esc(r.p.studyId)}</b><span>${r.fl.filter(f => f.k !== "none").map(f => esc(f.t)).join(" · ")}</span></div><span class="tiny muted">${ago(r.la)}</span></a>`).join("")}</div>`
            : `<div class="empty" style="padding:18px">🎉 Everyone is on track.</div>`}</div>
        <div class="card" style="margin:0"><div class="section-title"><h2>Games played</h2></div>
          ${byGame.map(x => `<div class="row" style="gap:10px;margin-bottom:8px;flex-wrap:nowrap"><span style="width:26px;font-size:18px">${x.g.emoji}</span><span style="width:120px;font-weight:700;font-size:13.5px">${esc(x.g.name)}</span><div class="bar grow"><i style="width:${x.n / maxG * 100}%"></i></div><b style="width:28px;text-align:end">${x.n}</b></div>`).join("")}</div>
      </div>
    </div>
    <div class="grid-2" style="margin-top:16px">
      <div class="card"><div class="section-title"><h2>Diagnosis mix</h2><span class="muted small">latest diagnosis per participant</span></div>
        <div class="knees" style="margin-bottom:14px"><div class="knee ${sides.left ? "on" : ""}"><b>${sides.left}</b><small>Left knee</small></div><div class="knee ${sides.bilateral ? "on" : ""}"><b>${sides.bilateral}</b><small>Both knees</small></div><div class="knee ${sides.right ? "on" : ""}"><b>${sides.right}</b><small>Right knee</small></div></div>
        <p class="muted small" style="margin:0">${ps.length - Object.keys(latestBy).length} participant(s) without a recorded diagnosis.</p></div>
      <div class="card"><div class="section-title"><h2>Kellgren–Lawrence grade</h2><span class="muted small">at enrolment</span></div>
        ${kl.map((n, i) => `<div class="row" style="gap:10px;margin-bottom:8px;flex-wrap:nowrap"><span class="pill navy" style="width:70px;justify-content:center">KL ${i+1}</span><div class="bar grow"><i style="width:${ps.length ? n/ps.length*100 : 0}%;background:linear-gradient(90deg,${["#5EEAD4","#14B8A6","#FF7A59","#DC2626"][i]},${["#99F6E4","#2DD4BF","#FFA48C","#F87171"][i]})"></i></div><b style="width:28px;text-align:end">${n}</b></div>`).join("")}</div>
    </div>`;
  const weekly = S.weeklyCounts(cam, 8);
  redraw = () => barChart($("#o0"), { labels: weekly.map(w => w.label), values: weekly.map(w => w.n), ref: settings.prescribedPerWeek * Math.max(1, ps.length), height: 230 }); redraw();
}

// ── participants list ────────────────────────────────────────────────────────────────────────
async function viewList(){
  app.innerHTML = `<p class="muted">Loading…</p>`;
  const [ps, ss, dxs] = await Promise.all([store.listParticipants(), store.listSessions(), listDx()]);
  const rows = buildRows(ps, ss), latest = {}; for(const d of dxs){ if(!latest[d.studyId] || (d.createdAt || 0) > (latest[d.studyId].createdAt || 0)) latest[d.studyId] = d; }
  const groups = [...new Set(ps.map(p => p.group).filter(Boolean))];
  app.innerHTML = pageHead("Participants", `${ps.length} enrolled · camera sessions only · prescribed ${settings.prescribedPerWeek}/week`, `<a class="btn" href="#/add">＋ Add participant</a>`) + `
    <div class="card"><div class="row" style="margin-bottom:14px"><input id="q" placeholder="🔍  Search study ID…" style="max-width:240px">
      <select id="gf" style="max-width:200px"><option value="">All groups</option>${groups.map(g => `<option>${esc(g)}</option>`).join("")}</select>
      <label style="margin:0;display:flex;gap:8px;align-items:center"><input type="checkbox" id="af"> Needs attention only</label></div>
      <div class="tablewrap"><table class="cards"><thead><tr><th>Participant</th><th>Diagnosis</th><th>Group</th><th>Age · Sex</th><th>KL</th><th>Last active</th><th>7-day</th><th>Adherence</th><th>Alerts</th></tr></thead><tbody id="tb"></tbody></table></div>
      <div id="none" class="empty" hidden>No participants yet. <a href="#/add">Add the first participant</a>${store.mode === "local" ? ` or <a href="#/settings">load demo data</a>` : ""}.</div></div>`;
  const draw = () => { const q = $("#q").value.trim().toUpperCase(), g = $("#gf").value, a = $("#af").checked;
    const list = rows.filter(r => (!q || r.p.studyId.includes(q)) && (!g || r.p.group === g) && (!a || r.alert));
    $("#tb").innerHTML = list.map(r => `<tr class="click" data-id="${r.p.studyId}"><td data-label="Participant"><div class="idcell">${avatar(r.p.studyId)}<div><b>${r.p.studyId}</b><div class="tiny muted">enrolled ${fmtDate(r.p.enrolledAt)}</div></div></div></td>
      <td data-label="Diagnosis">${latest[r.p.studyId] ? `<span class="pill navy">${esc(S.dxShort(latest[r.p.studyId]))}</span>` : `<span class="muted small">—</span>`}</td>
      <td data-label="Group">${r.p.group ? `<span class="pill">${esc(r.p.group)}</span>` : "—"}</td>
      <td data-label="Age · Sex">${esc(r.p.demographics.age)} · ${esc((r.p.demographics.gender || "")[0] || "")}</td><td data-label="KL">${esc(r.p.demographics.klGrade)}</td>
      <td data-label="Last active">${ago(r.la)}</td><td data-label="7-day" class="num">${r.n7}</td><td data-label="Adherence">${adhBar(r.adh)}</td>
      <td data-label="Alerts">${r.fl.filter(f => f.k !== "none").map(f => `<span class="pill ${f.k === "pain" ? "bad" : "warn"}">${esc(f.t)}</span>`).join("") || (r.fl.length ? `<span class="muted small">No sessions yet</span>` : `<span class="pill good">OK</span>`)}</td></tr>`).join("");
    $("#none").hidden = rows.length > 0; $$("#tb tr").forEach(tr => tr.onclick = () => location.hash = "#/p/" + tr.dataset.id); };
  ["input", "change"].forEach(ev => { $("#q").addEventListener(ev, draw); $("#gf").addEventListener(ev, draw); $("#af").addEventListener(ev, draw); }); draw();
}

// ── add participant ──────────────────────────────────────────────────────────────────────────
function viewAdd(){
  const opt = (a, f = x => x) => a.map(x => `<option value="${esc(typeof x === "object" ? x.v : x)}">${esc(f(x))}</option>`).join("");
  app.innerHTML = pageHead("Add participant", "The name and CNIC are stored separately from the research data and are never included in the de-identified exports.") + `<div id="msg"></div>
  <form id="f"><div class="card"><h3>🪪 Identity <span class="hint">(kept separate; shown to researchers only)</span></h3><div class="form-grid">
    <div class="field"><label>Name</label><input name="name" autocomplete="off" required></div>
    <div class="field"><label>CNIC number <span class="hint">13 digits</span></label><input name="cnic" inputmode="numeric" placeholder="12345-1234567-1" autocomplete="off" required></div></div></div>
    <div class="card"><h3>📋 Demographics</h3><div class="form-grid">
    <div class="field"><label>Age (years)</label><input name="age" type="number" min="18" max="110" required></div>
    <div class="field"><label>Gender</label><select name="gender" required><option value="">Select…</option>${opt(S.GENDERS)}</select></div>
    <div class="field"><label>Residence</label><input name="residence" list="resl" autocomplete="off" required><datalist id="resl"><option>Urban</option><option>Rural</option></datalist></div>
    <div class="field"><label>Educational level</label><select name="education" required><option value="">Select…</option>${opt(S.EDUCATION)}</select></div>
    <div class="field"><label>Occupation</label><input name="occupation" autocomplete="off" required></div>
    <div class="field"><label>Marital status</label><select name="marital" required><option value="">Select…</option>${opt(S.MARITAL)}</select></div>
    <div class="field"><label>Duration of pain</label><div class="row" style="flex-wrap:nowrap"><input name="pd" type="number" min="0" step="0.5" required><select name="pdu" style="max-width:110px"><option value="months">months</option><option value="years">years</option></select></div></div>
    <div class="field"><label>Knee OA grade (Kellgren–Lawrence)</label><select name="klGrade" required><option value="">Select…</option>${opt(S.KL_GRADES, g => g.label)}</select></div>
    <div class="field"><label>Study group <span class="hint">(optional)</span></label><select name="group"><option value="">Not assigned</option>${opt(settings.groups)}</select></div></div></div>
    <div class="card"><h3>🎮 Games for this patient <span class="hint">(only these appear in the patient's app; you can change them later)</span></h3>${gamePicker(S.GAME_IDS)}</div>
    <div class="row"><button class="btn">Create participant</button><a class="btn ghost" href="#/list">Cancel</a></div></form>`;
  $("#f").onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target), g = k => String(f.get(k) || "").trim(); $("#msg").innerHTML = "";
    const pd = Number(g("pd")), months = Math.round(g("pdu") === "years" ? pd * 12 : pd);
    const input = { name: g("name"), cnic: g("cnic"), group: g("group") || null, demographics: { age: Number(g("age")), gender: g("gender"), residence: g("residence"), education: g("education"),
      occupation: g("occupation"), marital: g("marital"), painDurationMonths: months, klGrade: Number(g("klGrade")) }, games: pickedGames(e.target) };
    const errs = S.validateParticipant(input); if(!input.games.length) errs.push("Choose at least one game for this patient."); if(errs.length){ $("#msg").innerHTML = `<div class="err">${errs.map(esc).join("<br>")}</div>`; window.scrollTo(0, 0); return; }
    const btn = $("#f button.btn"); btn.disabled = true; btn.textContent = "Creating…";
    try{ const r = await store.registerParticipant(input); showCreated(r.studyId, r.accessCode); }
    catch(err){ btn.disabled = false; btn.textContent = "Create participant"; $("#msg").innerHTML = `<div class="err">${esc(err.message)}</div>`; } };
}
function showCreated(id, code){
  app.innerHTML = `<div class="card" style="max-width:580px;margin:20px auto;text-align:center;padding:28px">${avatar(id, "lg")}<h1 style="margin-top:12px">Participant created 🎉</h1>
    <p class="muted">Give these to the participant. In the <b>Virtual Therapy</b> app (or at <b>${esc(patientUrl())}</b>) they choose <b>Patient</b> and sign in.</p>
    <p class="muted small" style="margin:14px 0 4px">Study ID</p><div class="codebox" style="margin-bottom:10px">${esc(id)}</div>
    <p class="muted small" style="margin:6px 0 4px">Access code</p><div class="codebox">${esc(code)}</div>
    <div class="row" style="justify-content:center;margin-top:18px"><button class="btn ghost" id="cp">📤 Share / copy</button><button class="btn ghost" id="pr">🖨 Print card</button><a class="btn navy" href="#/p/${id}/diagnosis">🩺 Add diagnosis</a><a class="btn" href="#/assess/${id}">Record baseline</a></div>
    <p class="muted small" style="margin-top:14px">You can see this code again under the participant's “Details & access” tab.</p></div>`;
  $("#cp").onclick = () => { const msg = `Virtual Therapy\nStudy ID: ${id}\nAccess code: ${code}`; const b = droid(); if(b && b.shareText){ try{ b.shareText("Virtual Therapy access", msg + "\nOpen the app, choose Patient, and sign in. Web: " + patientUrl()); return; }catch(e){} } navigator.clipboard && navigator.clipboard.writeText(msg); toast("Copied"); };
  $("#pr").onclick = () => { if(droid()){ $("#cp").click(); return; } const w = open("", "_blank"); w.document.write(`<body style="font:20px system-ui;padding:30px"><h2>Virtual Therapy</h2><p>Study ID: <b>${esc(id)}</b></p><p>Access code: <b style="letter-spacing:.12em">${esc(code)}</b></p><p>Open the Virtual Therapy app, choose <b>Patient</b>, and sign in.<br>Web: ${esc(patientUrl())}</p></body>`); w.print(); };
}

// ── participant profile ──────────────────────────────────────────────────────────────────────
const MEASURES = [
  { k:"womac",  label:"WOMAC total (0–96)",     get:a => a.womac && a.womac.total,       better:"lower" },
  { k:"womacP", label:"  Pain (0–20)",          get:a => a.womac && a.womac.pain,        better:"lower" },
  { k:"womacS", label:"  Stiffness (0–8)",      get:a => a.womac && a.womac.stiffness,   better:"lower" },
  { k:"womacF", label:"  Function (0–68)",      get:a => a.womac && a.womac.function,    better:"lower" },
  { k:"tug",    label:"TUG (seconds)",          get:a => a.tug && a.tug.seconds,         better:"lower" },
  { k:"bbs",    label:"Berg Balance (0–56)",    get:a => a.bbs && a.bbs.total,           better:"higher" },
  { k:"vas",    label:"VAS pain (0–100 mm)",    get:a => a.vas,                          better:"lower" },
  { k:"lf",     label:"Left knee flexion (°)",  get:a => a.rom && a.rom.left && a.rom.left.flexion,    better:"higher" },
  { k:"le",     label:"Left knee extension (°)",get:a => a.rom && a.rom.left && a.rom.left.extension,  better:"lower" },
  { k:"rf",     label:"Right knee flexion (°)", get:a => a.rom && a.rom.right && a.rom.right.flexion,  better:"higher" },
  { k:"re",     label:"Right knee extension (°)",get:a => a.rom && a.rom.right && a.rom.right.extension,better:"lower" },
];
const orderAssess = as => [...as].sort((a, b) => { const o = settings.timepoints, ia = o.indexOf(a.timepoint), ib = o.indexOf(b.timepoint); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.date.localeCompare(b.date); });

async function viewParticipant(id, tab){
  const [p, as, ss, dx] = await Promise.all([store.getParticipant(id), store.listAssessments(id), store.listSessions(id), listDx(id)]);
  if(!p) throw new Error("Unknown participant " + id);
  const cam = camera(ss), fl = S.flags(cam).filter(f => f.k !== "none"), d = p.demographics, ldx = S.latestDx(dx);
  const n7 = S.sessionsInLastDays(cam, 7), adh = Math.min(100, Math.round(n7 / (settings.prescribedPerWeek || 3) * 100));
  const lastW = orderAssess(as).map(a => a.womac && a.womac.total).filter(v => v != null).pop();
  const T = (k, l) => `<a href="#/p/${id}/${k}" class="${tab === k ? "on" : ""}">${l}</a>`;
  app.innerHTML = `<a href="#/list" class="crumb">← Participants</a>
    <div class="card" style="margin-top:10px"><div class="p-head">${avatar(p.studyId, "lg")}<div class="grow">
      <h1>${esc(p.studyId)} <span class="pill">${esc(p.group || "No group")}</span><span class="pill navy">KL ${esc(d.klGrade)}</span>${ldx ? `<span class="pill coral">🩺 ${esc(S.dxShort(ldx))}</span>` : ""}${fl.map(f => `<span class="pill ${f.k === "pain" ? "bad" : "warn"}">${esc(f.t)}</span>`).join("")}</h1>
      <span class="muted">${esc(d.age)} y · ${esc(d.gender)} · ${esc(d.residence)} · pain for ${pdur(d.painDurationMonths)} · enrolled ${fmtDate(p.enrolledAt)}</span></div>
      <div class="row"><a class="btn navy" href="#/p/${id}/diagnosis">🩺 Diagnosis</a><a class="btn" href="#/assess/${id}">＋ Assessment</a></div></div>
      <div class="minis"><div class="mini"><small>Completed sessions</small><b>${cam.filter(S.isDone).length}</b></div><div class="mini"><small>This week</small><b>${n7} / ${settings.prescribedPerWeek}</b></div>
        <div class="mini"><small>Adherence</small><b>${adh}%</b></div><div class="mini"><small>Last active</small><b>${ago(S.lastActive(cam))}</b></div>
        <div class="mini"><small>Latest WOMAC</small><b>${lastW ?? "—"}</b></div><div class="mini"><small>Assigned games</small><b>${S.assignedGames(p).length} / ${S.GAMES.length}</b></div></div></div>
    <div class="tabs">${T("outcomes", "📈 Outcome measures")}${T("games", "🎮 Game progress")}${T("diagnosis", "🩺 Diagnosis")}${T("details", "🔐 Details & access")}</div><div id="tab"></div>`;
  if(tab === "games") tabGames(p, ss); else if(tab === "details") await tabDetails(p, as); else if(tab === "diagnosis") tabDiagnosis(p, dx); else tabOutcomes(p, as);
}

function tabOutcomes(p, asRaw){
  const as = orderAssess(asRaw), box = $("#tab");
  if(!as.length){ box.innerHTML = `<div class="card empty">📋 No assessments recorded yet.<br><br><a class="btn" href="#/assess/${p.studyId}">Record baseline assessment</a></div>`; return; }
  const num = v => (v == null || v === "" || Number.isNaN(Number(v))) ? null : Number(v), base = as[0], last = as[as.length - 1];
  const head = as.map(a => `<th><a href="#/assess/${p.studyId}/${a.id}" title="Edit">${esc(a.timepoint)}</a><div class="muted small" style="text-transform:none;font-weight:500">${esc(a.date)}</div></th>`).join("");
  const body = MEASURES.map(m => { const vals = as.map(a => num(m.get(a))), b = num(m.get(base)), l = num(m.get(last));
    const dl = (as.length > 1 && b != null && l != null) ? Math.round((l - b) * 10) / 10 : null, good = dl == null || dl === 0 ? "" : ((m.better === "lower") === (dl < 0) ? "better" : "worse");
    return `<tr><td><b style="${m.label.startsWith("  ") ? "font-weight:500;padding-inline-start:12px" : ""}">${esc(m.label.trim())}</b></td>${vals.map(v => `<td class="num">${v == null ? "—" : r1(v)}</td>`).join("")}<td class="num delta ${good}">${dl == null ? "—" : (dl > 0 ? "+" : "") + dl}</td></tr>`; }).join("");
  box.innerHTML = `<div class="card"><div class="tablewrap"><table><thead><tr><th>Measure</th>${head}<th>Change<div class="muted small" style="text-transform:none;font-weight:500">last vs first</div></th></tr></thead><tbody>${body}</tbody></table></div>
    <p class="muted small" style="margin:10px 0 0">Green = improved, red = worsened. Lower is better for WOMAC, TUG, VAS and extension deficit; higher is better for BBS and flexion.</p></div>
    <div class="charts" id="ch">${["WOMAC total", "TUG (s)", "Berg Balance", "VAS pain (mm)", "Knee flexion (°)", "Knee extension (°)"].map((t, i) => `<div class="chartcard"><h3>${t}</h3><canvas id="c${i}"></canvas></div>`).join("")}</div>`;
  const labels = as.map(a => a.timepoint), ser = (...ms) => ms.map(([l, k]) => ({ label: l, data: as.map(a => num(MEASURES.find(m => m.k === k).get(a))) }));
  redraw = () => { lineChart($("#c0"), { labels, series: ser(["WOMAC", "womac"]), min: 0, max: 96 }); lineChart($("#c1"), { labels, series: ser(["TUG", "tug"]) }); lineChart($("#c2"), { labels, series: ser(["BBS", "bbs"]), min: 0, max: 56 });
    lineChart($("#c3"), { labels, series: ser(["VAS", "vas"]), min: 0, max: 100 }); lineChart($("#c4"), { labels, series: ser(["Left", "lf"], ["Right", "rf"]) }); lineChart($("#c5"), { labels, series: ser(["Left", "le"], ["Right", "re"]) }); }; redraw();
}

function tabGames(p, ssAll){
  const box = $("#tab"); let incl = false;
  const render = () => {
    const ss = (incl ? ssAll : camera(ssAll)).slice().sort((a, b) => S.sessionTime(a) - S.sessionTime(b)), done = ss.filter(S.isDone);
    const q5 = done.slice(-5).map(s => s.qualityPct), pb = S.avg(done.map(s => s.painBefore)), pa = S.avg(done.map(s => s.painAfter)), la = S.lastActive(ss);
    const weekly = S.weeklyCounts(ss, 8), byGame = {}; for(const s of ss){ (byGame[s.game] ||= []).push(s); }
    box.innerHTML = `<div class="card" style="padding:14px 18px"><div class="row between"><div><b>Assigned games:</b> ${S.assignedGames(p).map(id => `<span class="pill">${GAME_EMOJI[id]} ${esc(GAME_NAMES[id])}</span>`).join("")} <a href="#/p/${p.studyId}/details" class="small">change</a></div>
      <label style="margin:0;display:flex;gap:8px;align-items:center"><input type="checkbox" id="incl" ${incl ? "checked" : ""}> Include test sessions${ssAll.length - camera(ssAll).length ? ` (${ssAll.length - camera(ssAll).length})` : ""}</label></div></div>
      <div class="tiles"><div class="tile"><span class="ic">✅</span><b>${done.length}</b><span>Completed sessions</span></div><div class="tile t-navy"><span class="ic">📅</span><b>${S.sessionsInLastDays(ss, 7)}<small class="muted" style="font-size:15px">/${settings.prescribedPerWeek}</small></b><span>Last 7 days</span></div>
      <div class="tile t-violet"><span class="ic">⭐</span><b>${r1(S.avg(q5))}${q5.length ? "%" : ""}</b><span>Avg quality, last 5</span></div><div class="tile t-amber"><span class="ic">🕒</span><b style="font-size:22px">${ago(la)}</b><span>Last active</span></div>
      <div class="tile t-coral"><span class="ic">💢</span><b>${r1(pb)} → ${r1(pa)}</b><span>Avg pain before → after</span></div></div>
      <div class="charts"><div class="chartcard"><h3>Completed sessions per week</h3><canvas id="g0"></canvas></div><div class="chartcard"><h3>Quality % per session</h3><canvas id="g1"></canvas></div>
      <div class="chartcard"><h3>Pain before vs after (0–10)</h3><canvas id="g2"></canvas></div><div class="chartcard"><h3>Peak knee flexion (°, camera-estimated)</h3><canvas id="g3"></canvas></div></div>
      <div class="card" style="margin-top:16px"><h3>By game</h3><div class="tablewrap"><table><thead><tr><th>Game</th><th>Sessions</th><th>Avg quality</th><th>Avg stars</th><th>Last played</th></tr></thead><tbody>
      ${Object.entries(byGame).map(([g, a]) => { const dn = a.filter(S.isDone); return `<tr><td><b>${GAME_EMOJI[g] || "🎮"} ${esc(gname(a[0]))}</b></td><td class="num">${dn.length}</td><td class="num">${r1(S.avg(dn.map(s => s.qualityPct)))}</td><td class="num">${r1(S.avg(dn.map(s => s.stars)))}</td><td>${fmtDate(S.lastActive(a))}</td></tr>`; }).join("") || `<tr><td colspan="5" class="muted">No sessions yet</td></tr>`}</tbody></table></div></div>
      <div class="card"><h3>Recent sessions</h3><div class="tablewrap"><table class="cards"><thead><tr><th>When</th><th>Game</th><th>Level</th><th>Status</th><th>Reps</th><th>Quality</th><th>Pain</th><th>Mode</th></tr></thead><tbody>
      ${[...ss].reverse().slice(0, 15).map(s => `<tr><td data-label="When">${fmtDT(S.sessionTime(s))}</td><td data-label="Game"><b>${GAME_EMOJI[s.game] || ""} ${esc(gname(s))}</b></td><td data-label="Level">${esc(s.difficulty || "—")}</td>
        <td data-label="Status"><span class="pill ${s.status === "completed" ? "good" : s.status === "abandoned" ? "warn" : s.status === "skipped_pain" ? "bad" : ""}">${esc(String(s.status).replace("_", " "))}</span></td>
        <td data-label="Reps" class="num">${s.repsDone ?? "—"}/${s.repsTarget ?? "—"}</td><td data-label="Quality" class="num">${s.qualityPct ?? "—"} ${stars(s.stars)}</td><td data-label="Pain" class="num">${s.painBefore ?? "—"} → ${s.painAfter ?? "—"}</td><td data-label="Mode">${esc(s.inputMode || "—")}</td></tr>`).join("") || `<tr><td colspan="8" class="muted">No sessions yet</td></tr>`}</tbody></table></div></div>`;
    $("#incl").onchange = e => { incl = e.target.checked; render(); };
    const lab = done.map(s => new Date(S.sessionTime(s)).toLocaleDateString(undefined, { day: "numeric", month: "short" })), flexS = done.filter(s => s.peakFlexionDeg != null);
    redraw = () => { barChart($("#g0"), { labels: weekly.map(w => w.label), values: weekly.map(w => w.n), ref: settings.prescribedPerWeek });
      lineChart($("#g1"), { labels: lab, series: [{ label: "Quality", data: done.map(s => s.qualityPct) }], min: 0, max: 100 });
      lineChart($("#g2"), { labels: lab, series: [{ label: "Before", color: COLORS[1], data: done.map(s => s.painBefore) }, { label: "After", color: COLORS[0], data: done.map(s => s.painAfter) }], min: 0, max: 10 });
      lineChart($("#g3"), { labels: flexS.map(s => new Date(S.sessionTime(s)).toLocaleDateString(undefined, { day: "numeric", month: "short" })), series: [{ label: "Peak flexion", color: COLORS[2], data: flexS.map(s => s.peakFlexionDeg) }] }); }; redraw();
  };
  render();
}

// ── diagnosis ────────────────────────────────────────────────────────────────────────────────
function tabDiagnosis(p, list){
  const box = $("#tab"), hist = list.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)), cur = hist[0] || null;
  const kneeCard = (side, kl, label) => `<div class="knee ${side ? "on" : ""}"><small>${label}</small><b>${side ? (kl ?? "–") : "—"}</b><small>${side ? "KL grade" : "not affected"}</small></div>`;
  const summary = d => { const t = S.DX_TYPES.find(x => x.v === d.type) || {}, L = d.side === "left" || d.side === "bilateral", R = d.side === "right" || d.side === "bilateral";
    return `<div class="card"><div class="dx-head"><div class="grow"><p class="small muted" style="margin:0 0 4px;font-weight:700;letter-spacing:.05em;text-transform:uppercase">Current diagnosis</p>
        <h2 style="margin:0 0 6px;font-size:21px">${esc(d.type === "other" ? d.otherText : t.label)}</h2>
        <div class="chips">${d.icd10 ? `<span class="dx-icd">ICD-10 ${esc(d.icd10)}</span>` : ""}<span class="pill coral">${esc((S.DX_SIDES.find(s => s.v === d.side) || {}).label || "")}</span>${d.imaging ? `<span class="pill navy">📷 ${esc(d.imaging)}${d.imagingDate ? " · " + esc(d.imagingDate) : ""}</span>` : ""}</div></div>
        <div class="knees" style="min-width:220px">${kneeCard(R, d.klRight, "Right knee")}${kneeCard(L, d.klLeft, "Left knee")}</div></div>
      <div class="dx-grid"><div><small>Diagnosed on</small><b>${esc(d.diagnosedOn || "—")}</b></div><div><small>Diagnosed by</small><b>${esc(d.diagnosedBy || "—")}</b></div>
        <div><small>BMI</small><b>${d.bmi ?? "—"}</b> <span class="muted small">${esc(S.bmiClass(d.bmi))}</span></div><div><small>Height · weight</small><b>${d.heightCm ? esc(d.heightCm) + " cm" : "—"} · ${d.weightKg ? esc(d.weightKg) + " kg" : "—"}</b></div></div>
      <div class="grid-2" style="gap:14px"><div><h3>Comorbidities</h3><div class="chips">${[...(d.comorbidities || []), ...(d.comorbidityOther ? [d.comorbidityOther] : [])].map(c => `<span class="pill navy">${esc(c)}</span>`).join("") || `<span class="muted small">None recorded</span>`}</div></div>
        <div><h3>⚠️ Precautions for exercise</h3><div class="chips">${(d.precautions || []).map(c => `<span class="pill bad">${esc(c)}</span>`).join("") || `<span class="pill good">None recorded</span>`}</div></div></div>
      ${d.medications ? `<h3 style="margin-top:14px">💊 Medications</h3><p>${esc(d.medications)}</p>` : ""}${d.notes ? `<h3 style="margin-top:10px">📝 Clinical notes</h3><p style="white-space:pre-wrap">${esc(d.notes)}</p>` : ""}
      <p class="muted tiny" style="margin:12px 0 0">Recorded ${fmtDT(d.createdAt)}${d.by ? " by " + esc(d.by) : ""} · visible to researchers only</p></div>`; };
  box.innerHTML = `${cur ? summary(cur) : `<div class="card empty">🩺 No diagnosis recorded for ${esc(p.studyId)} yet.</div>`}
    <details ${cur ? "" : "open"} id="dxd"><summary>${cur ? "✏️ Update diagnosis (saved as a new entry; history is kept)" : "➕ Record diagnosis"}</summary><div class="body" id="dxform"></div></details>
    ${hist.length ? `<div class="card"><h3>🕘 History</h3><div class="timeline">${hist.map(d => `<div class="tl"><div class="row between"><div><b>${esc(S.dxShort(d))}</b> ${d.icd10 ? `<span class="pill navy">${esc(d.icd10)}</span>` : ""}
      <div class="muted small">${fmtDT(d.createdAt)} · KL R ${d.klRight ?? "–"} / L ${d.klLeft ?? "–"}${d.by ? " · " + esc(d.by) : ""}</div></div><button class="btn small danger" data-del="${esc(d.id)}">Delete</button></div></div>`).join("")}</div></div>` : ""}`;
  dxForm($("#dxform"), p, cur);
  $$("[data-del]").forEach(b => b.onclick = async () => { if(!confirm("Delete this diagnosis entry? This cannot be undone.")) return; await store.deleteDiagnosis(b.dataset.del); toast("Diagnosis entry deleted"); viewParticipant(p.studyId, "diagnosis"); });
}
function dxForm(el, p, prev){
  const v = prev || { side: p.demographics && p.demographics.klGrade ? "" : "", klLeft: null, klRight: null }, sel = (n, val) => `<select id="${n}"><option value="">Not assessed</option>${[0,1,2,3,4].map(g => `<option ${String(val) === String(g) ? "selected" : ""}>${g}</option>`).join("")}</select>`;
  const checks = (name, items, picked, red) => `<div class="checkgrid ${red ? "red" : ""}">${items.map(c => `<label><input type="checkbox" name="${name}" value="${esc(c)}" ${(picked || []).includes(c) ? "checked" : ""}> ${esc(c)}</label>`).join("")}</div>`;
  el.innerHTML = `<div id="dxmsg"></div><div class="form-grid">
      <div class="field"><label>Diagnosis</label><select id="dxType"><option value="">Select…</option>${S.DX_TYPES.map(t => `<option value="${t.v}" ${v.type === t.v ? "selected" : ""}>${esc(t.label)}</option>`).join("")}</select>
        <input id="dxOther" placeholder="Describe the diagnosis" style="margin-top:6px;${v.type === "other" ? "" : "display:none"}" value="${esc(v.otherText || "")}"></div>
      <div class="field"><label>Affected knee</label><select id="dxSide"><option value="">Select…</option>${S.DX_SIDES.map(s => `<option value="${s.v}" ${v.side === s.v ? "selected" : ""}>${s.label}</option>`).join("")}</select></div>
      <div class="field"><label>ICD-10 code <span class="hint">(filled automatically; editable)</span></label><input id="dxIcd" value="${esc(v.icd10 || "")}" placeholder="M17.x"></div>
      <div class="field"><label>KL grade — right knee</label>${sel("dxKlR", v.klRight)}</div><div class="field"><label>KL grade — left knee</label>${sel("dxKlL", v.klLeft)}</div>
      <div class="field"><label>Date of diagnosis</label><input type="date" id="dxOn" value="${esc(v.diagnosedOn || "")}"></div>
      <div class="field"><label>Diagnosed by</label><input id="dxBy" value="${esc(v.diagnosedBy || "")}" placeholder="e.g. Dr. A. Khan, orthopaedics"></div>
      <div class="field"><label>Basis / imaging</label><select id="dxImg"><option value="">Select…</option>${S.IMAGING.map(x => `<option ${v.imaging === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
      <div class="field"><label>Imaging date</label><input type="date" id="dxImgOn" value="${esc(v.imagingDate || "")}"></div>
      <div class="field"><label>Height (cm)</label><input type="number" id="dxH" min="100" max="220" value="${esc(v.heightCm ?? "")}"></div>
      <div class="field"><label>Weight (kg)</label><input type="number" id="dxW" min="25" max="250" step="0.1" value="${esc(v.weightKg ?? "")}"></div>
      <div class="field"><label>BMI</label><div class="mini" style="padding:9px 12px"><b id="dxBmi">—</b> <span class="muted small" id="dxBmiC"></span></div></div></div>
    <h3>Comorbidities</h3>${checks("cm", S.COMORBIDITIES, v.comorbidities)}<div class="field" style="margin-top:10px"><input id="dxCmO" placeholder="Other comorbidity (optional)" value="${esc(v.comorbidityOther || "")}"></div>
    <h3>⚠️ Precautions / red flags for exercise</h3>${checks("pc", S.PRECAUTIONS, v.precautions, true)}
    <div class="form-grid" style="margin-top:14px"><div class="field"><label>Current medications</label><textarea id="dxMed" rows="2">${esc(v.medications || "")}</textarea></div>
      <div class="field"><label>Clinical notes</label><textarea id="dxNotes" rows="2">${esc(v.notes || "")}</textarea></div></div>
    <div class="row"><button class="btn navy" id="dxSave">💾 Save diagnosis</button><span class="muted small">Researcher-only. Never shown in the patient app.</span></div>`;
  const icd = () => { const c = S.icd10For($("#dxType").value, $("#dxSide").value); if(c) $("#dxIcd").value = c; else if($("#dxType").value === "other") $("#dxIcd").value = $("#dxIcd").value; };
  const bmi = () => { const b = S.bmiOf($("#dxH").value, $("#dxW").value); $("#dxBmi").textContent = b ?? "—"; $("#dxBmiC").textContent = S.bmiClass(b); };
  $("#dxType").onchange = () => { $("#dxOther").style.display = $("#dxType").value === "other" ? "" : "none"; icd(); };
  $("#dxSide").onchange = () => { const s = $("#dxSide").value; if(s === "left") $("#dxKlR").value = ""; if(s === "right") $("#dxKlL").value = ""; icd(); };
  $("#dxH").oninput = bmi; $("#dxW").oninput = bmi; bmi();
  $("#dxSave").onclick = async () => {
    const num = id => $(id).value === "" ? null : Number($(id).value), picked = n => $$(`input[name="${n}"]:checked`, el).map(x => x.value);
    const d = { type: $("#dxType").value, otherText: $("#dxOther").value.trim(), side: $("#dxSide").value, icd10: $("#dxIcd").value.trim().toUpperCase(), klRight: num("#dxKlR"), klLeft: num("#dxKlL"),
      diagnosedOn: $("#dxOn").value, diagnosedBy: $("#dxBy").value.trim(), imaging: $("#dxImg").value, imagingDate: $("#dxImgOn").value, heightCm: num("#dxH"), weightKg: num("#dxW"),
      bmi: S.bmiOf($("#dxH").value, $("#dxW").value), comorbidities: picked("cm"), comorbidityOther: $("#dxCmO").value.trim(), precautions: picked("pc"), medications: $("#dxMed").value.trim(), notes: $("#dxNotes").value.trim() };
    const errs = S.validateDiagnosis(d); if(errs.length){ $("#dxmsg").innerHTML = `<div class="err">${errs.map(esc).join("<br>")}</div>`; return; }
    const b = $("#dxSave"); b.disabled = true; b.textContent = "Saving…";
    try{ await store.saveDiagnosis(p.studyId, d); toast("Diagnosis saved"); viewParticipant(p.studyId, "diagnosis"); }
    catch(err){ b.disabled = false; b.textContent = "💾 Save diagnosis"; $("#dxmsg").innerHTML = `<div class="err">${esc(err.message || err)}</div>`; }
  };
}

async function tabDetails(p, as){
  const d = p.demographics, box = $("#tab");
  box.innerHTML = `<div class="grid-2"><div class="card"><h3>📋 Demographics</h3><dl class="kv"><dt>Age</dt><dd>${esc(d.age)}</dd><dt>Gender</dt><dd>${esc(d.gender)}</dd><dt>Residence</dt><dd>${esc(d.residence)}</dd><dt>Education</dt><dd>${esc(d.education)}</dd>
    <dt>Occupation</dt><dd>${esc(d.occupation)}</dd><dt>Marital status</dt><dd>${esc(d.marital)}</dd><dt>Duration of pain</dt><dd>${pdur(d.painDurationMonths)}</dd><dt>Knee OA grade</dt><dd>Kellgren–Lawrence ${esc(d.klGrade)}</dd>
    <dt>Consent</dt><dd>${p.consentAt ? `<span class="pill good">Given ${fmtDate(p.consentAt)}</span>` : `<span class="pill warn">Not yet given</span>`}</dd></dl>
    <div class="field" style="margin-top:14px"><label>Study group</label><select id="grp"><option value="">Not assigned</option>${settings.groups.map(g => `<option ${p.group === g ? "selected" : ""}>${esc(g)}</option>`).join("")}</select></div></div>
    <div class="card"><h3>🪪 Identity <span class="hint">(restricted)</span></h3><div id="idbox"><button class="btn ghost" id="reveal">Show name & CNIC</button></div>
    <h3 style="margin-top:20px">🔑 Participant access</h3><p class="muted small">Study ID and access code for signing in to the patient app.</p>
    <div class="row"><div><div class="muted small">Study ID</div><div class="codebox" style="font-size:20px;padding:8px 12px">${esc(p.studyId)}</div></div><div><div class="muted small">Access code</div><div class="codebox" style="font-size:20px;padding:8px 12px" id="codev">${esc(p.accessCode)}</div></div></div>
    <div class="row" style="margin-top:12px"><button class="btn small ghost" id="cpc">📤 Share / copy</button><button class="btn small danger" id="newc">Issue new code</button></div>
    <p class="muted small" style="margin-top:8px">A new code signs the participant out of their devices; they enter the new code to continue.</p></div></div>
    <div class="card" id="gcard"><h3>🎮 Assigned games</h3><p class="muted small">Only the ticked games appear in this patient's app. Changes reach their phone the next time they open the app.</p>
    ${gamePicker(S.assignedGames(p))}<div class="row" style="margin-top:12px"><button class="btn small" id="gsave">Save games</button><span class="muted small" id="gmsg"></span></div></div>`;
  $("#gsave").onclick = async () => { const games = pickedGames($("#gcard")); if(!games.length){ $("#gmsg").textContent = "Choose at least one game."; return; }
    await store.updateParticipant(p.studyId, { games }); p.games = games; $("#gmsg").textContent = ""; toast("Games updated"); };
  $("#grp").onchange = async e => { await store.updateParticipant(p.studyId, { group: e.target.value || null }); toast("Group updated"); };
  $("#reveal").onclick = async () => { const i = await store.getIdentity(p.studyId); $("#idbox").innerHTML = i ? `<dl class="kv"><dt>Name</dt><dd>${esc(i.name)}</dd><dt>CNIC</dt><dd>${esc(i.cnic)}</dd></dl>` : `<span class="muted">Not found</span>`; };
  $("#cpc").onclick = () => { const b = droid(); if(b && b.shareText){ try{ b.shareText("Virtual Therapy access", `Virtual Therapy\nStudy ID: ${p.studyId}\nAccess code: ${$("#codev").textContent}\nOpen the app, choose Patient, and sign in. Web: ${patientUrl()}`); return; }catch(e){} } navigator.clipboard && navigator.clipboard.writeText(`Study ID: ${p.studyId}\nAccess code: ${$("#codev").textContent}`); toast("Copied"); };
  $("#newc").onclick = async () => { if(!confirm("Issue a new access code? The old one stops working.")) return; $("#codev").textContent = await store.resetAccessCode(p.studyId); toast("New code issued"); };
}

// ── assessment form ──────────────────────────────────────────────────────────────────────────
async function viewAssess(id, aid){
  const p = await store.getParticipant(id); if(!p) throw new Error("Unknown participant " + id);
  const old = aid ? (await store.listAssessments(id)).find(a => a.id === aid) : null, v = old || {}, tps = settings.timepoints;
  const sel = (attr, key, max = 4, val) => `<select data-${attr}="${key}"><option value="">–</option>${Array.from({ length: max + 1 }, (_, i) => `<option ${String(val) === String(i) ? "selected" : ""}>${i}</option>`).join("")}</select>`;
  const wi = (v.womac && v.womac.items) || {}, bi = (v.bbs && v.bbs.items) || {}, rom = v.rom || {}, L = rom.left || {}, R = rom.right || {};
  const known = !v.timepoint || tps.includes(v.timepoint);
  app.innerHTML = `<div id="af"><a href="#/p/${id}" class="crumb">← ${esc(id)}</a>${pageHead(`${old ? "Edit" : "Record"} assessment — ${esc(id)}`, "Outcome measures: WOMAC, TUG, Berg Balance, VAS and knee range of motion.")}<div id="msg"></div>
  <details open><summary>🗓 Visit</summary><div class="body"><div class="form-grid"><div class="field"><label>Time point</label><select id="tp">${tps.map(t => `<option ${v.timepoint === t ? "selected" : ""}>${esc(t)}</option>`).join("")}<option value="__other" ${known ? "" : "selected"}>Other…</option></select>
    <input id="tpo" placeholder="Custom time point" style="margin-top:6px;${known ? "display:none" : ""}" value="${known ? "" : esc(v.timepoint)}"></div>
    <div class="field"><label>Date</label><input type="date" id="dt" value="${esc(v.date || new Date().toISOString().slice(0, 10))}"></div></div></div></details>
  <details><summary>🦵 WOMAC <span class="muted small" id="wsum"></span></summary><div class="body"><p class="muted small">Enter each item's 0–4 score from your licensed WOMAC form (0 none … 4 extreme). Items are numbered as on the form.</p>
    ${[["Pain (5 items)", S.WOMAC_PAIN], ["Stiffness (2 items)", S.WOMAC_STIFF], ["Physical function (17 items)", S.WOMAC_FUNC]].map(([t, ids]) => `<h3>${t}</h3><div class="items" style="margin-bottom:12px">${ids.map(i => `<div class="field"><label>${S.WOMAC_LABEL(i)}</label>${sel("womac", i, 4, wi[i])}</div>`).join("")}</div>`).join("")}</div></details>
  <details><summary>⏱ Timed Up and Go (TUG) <span class="muted small" id="tsum"></span></summary><div class="body"><div class="row" style="align-items:flex-start"><div><div class="stopwatch" id="sw">0.0 s</div><div class="row"><button type="button" class="btn small" id="sws">Start</button><button type="button" class="btn small ghost" id="swr">Reset</button></div></div>
    <div class="grow form-grid"><div class="field"><label>Time (seconds)</label><input type="number" step="0.1" min="1" id="tugs" value="${esc(v.tug ? v.tug.seconds : "")}"></div><div class="field"><label>Assistive device</label><select id="tugd">${S.TUG_DEVICES.map(x => `<option ${v.tug && v.tug.device === x ? "selected" : ""}>${x}</option>`).join("")}</select></div></div></div></div></details>
  <details><summary>⚖️ Berg Balance Scale <span class="muted small" id="bsum"></span></summary><div class="body"><div class="items">${S.BBS_ITEMS.map((n, i) => `<div class="field"><label>${i + 1}. ${esc(n)}</label>${sel("bbs", "b" + (i + 1), 4, bi["b" + (i + 1)])}</div>`).join("")}</div></div></details>
  <details><summary>💢 VAS pain</summary><div class="body"><div class="form-grid"><div class="field"><label>Pain (0 = none, 100 mm = worst)</label><input type="range" min="0" max="100" id="vasr" value="${esc(v.vas ?? 0)}"><input type="number" min="0" max="100" id="vas" placeholder="not recorded" value="${esc(v.vas ?? "")}" style="margin-top:6px"></div></div></div></details>
  <details><summary>📐 Knee range of motion (goniometer)</summary><div class="body"><p class="muted small">Flexion in degrees. Extension: 0 = fully straight; enter a lag as a positive number (10 = 10° short of straight); hyperextension as negative.</p>
    <div class="form-grid"><div class="field"><label>Left knee — flexion (°)</label><input type="number" id="lf" min="0" max="180" value="${esc(L.flexion ?? "")}"></div><div class="field"><label>Left knee — extension (°)</label><input type="number" id="le" min="-30" max="60" value="${esc(L.extension ?? "")}"></div>
    <div class="field"><label>Right knee — flexion (°)</label><input type="number" id="rf" min="0" max="180" value="${esc(R.flexion ?? "")}"></div><div class="field"><label>Right knee — extension (°)</label><input type="number" id="re" min="-30" max="60" value="${esc(R.extension ?? "")}"></div></div></div></details>
  <div class="card"><div class="field"><label>Notes</label><textarea id="nt" rows="2">${esc(v.notes || "")}</textarea></div><div class="row"><button class="btn" id="save">💾 Save assessment</button><a class="btn ghost" href="#/p/${id}">Cancel</a>${old ? `<button class="btn danger right" id="del">Delete</button>` : ""}</div></div></div>`;

  $("#tp").onchange = e => $("#tpo").style.display = e.target.value === "__other" ? "" : "none";
  const items = attr => Object.fromEntries($$(`[data-${attr}]`).map(el => [el.dataset[attr], el.value]).filter(([, x]) => x !== ""));
  const live = () => { const w = S.womacScore(items("womac")), b = S.bbsScore(items("bbs"));
    $("#wsum").textContent = w.answered ? (w.complete ? `— total ${w.total}/96 (pain ${w.pain}, stiffness ${w.stiffness}, function ${w.function})` : `— ${w.answered}/24 answered`) : "";
    $("#bsum").textContent = b.answered ? (b.complete ? `— total ${b.total}/56` : `— ${b.answered}/14 answered`) : ""; $("#tsum").textContent = $("#tugs").value ? `— ${$("#tugs").value} s` : ""; };
  $("#af").addEventListener("change", live); live();
  $("#vasr").oninput = e => $("#vas").value = e.target.value; $("#vas").oninput = e => { if(e.target.value !== "") $("#vasr").value = e.target.value; };
  let t0 = null, timer = null; const sw = $("#sw");
  $("#sws").onclick = () => { if(t0 == null){ t0 = performance.now(); $("#sws").textContent = "Stop"; timer = setInterval(() => sw.textContent = ((performance.now() - t0) / 1000).toFixed(1) + " s", 100); }
    else { clearInterval(timer); const s = (performance.now() - t0) / 1000; t0 = null; $("#sws").textContent = "Start"; sw.textContent = s.toFixed(1) + " s"; $("#tugs").value = s.toFixed(1); live(); } };
  $("#swr").onclick = () => { clearInterval(timer); t0 = null; $("#sws").textContent = "Start"; sw.textContent = "0.0 s"; };
  if(old && $("#del")) $("#del").onclick = async () => { if(!confirm("Delete this assessment?")) return; await store.deleteAssessment(old.id); toast("Deleted"); location.hash = "#/p/" + id; };
  $("#save").onclick = async () => {
    const num = el => el.value === "" ? undefined : Number(el.value), a = { id: old && old.id, timepoint: $("#tp").value === "__other" ? $("#tpo").value.trim() : $("#tp").value, date: $("#dt").value, notes: $("#nt").value.trim() };
    const wI = items("womac"), bI = items("bbs"); if(Object.keys(wI).length) a.womac = { items: wI }; if(Object.keys(bI).length) a.bbs = { items: bI };
    if($("#tugs").value !== "") a.tug = { seconds: Number($("#tugs").value), device: $("#tugd").value }; if($("#vas").value !== "") a.vas = Number($("#vas").value);
    const rm = { left: { flexion: num($("#lf")), extension: num($("#le")) }, right: { flexion: num($("#rf")), extension: num($("#re")) } };
    if(Object.values(rm).some(s => Object.values(s).some(x => x !== undefined))) a.rom = rm;
    const errs = S.validateAssessment(a); if(!a.womac && !a.bbs && !a.tug && a.vas === undefined && !a.rom) errs.push("Enter at least one outcome measure.");
    if(errs.length){ $("#msg").innerHTML = `<div class="err">${errs.map(esc).join("<br>")}</div>`; window.scrollTo(0, 0); return; }
    try{ await store.saveAssessment(id, a); toast("Assessment saved"); location.hash = "#/p/" + id + "/outcomes"; }catch(err){ $("#msg").innerHTML = `<div class="err">${esc(err.message)}</div>`; }
  };
}

// ── export ───────────────────────────────────────────────────────────────────────────────────
async function viewExport(){
  const [ps, as, ss, dx] = await Promise.all([store.listParticipants(), store.listAssessments(), store.listSessions(), listDx()]); const stamp = new Date().toISOString().slice(0, 10);
  const card = (ic, t, sub, body) => `<div class="card"><h3><span class="avatar c1" style="width:34px;height:34px;font-size:16px">${ic}</span>${t}</h3><p class="muted small">${sub}</p>${body}</div>`;
  app.innerHTML = pageHead("Export data", "CSV files (UTF-8, open directly in Excel or import into SPSS). Research files use the study ID only.") + `<div class="grid-3">
    ${card("📋", "Demographics", `One row per participant · ${ps.length} rows · de-identified`, `<button class="btn" id="e1">Download</button>`)}
    ${card("📈", "Outcome assessments", `One row per participant × time point · ${as.length} rows · WOMAC items & subscales, TUG, BBS items, VAS, knee ROM`, `<button class="btn" id="e2">Download</button>`)}
    ${card("🎮", "Game sessions", `One row per session · <span id="sc">${camera(ss).length}</span> rows · adherence, quality, pain, peak knee angle`, `<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="cam" checked> Camera sessions only</label><button class="btn" id="e3" style="margin-top:8px">Download</button>`)}
    ${card("🩺", "Diagnoses", `One row per diagnosis entry (history) · ${dx.length} rows · ICD-10, side, KL per knee, BMI, comorbidities, precautions`, `<button class="btn" id="e5">Download</button>`)}
    <div class="card" style="border-color:#F7D79B"><h3><span class="avatar c5" style="width:34px;height:34px;font-size:16px">🔐</span>Identity key (restricted)</h3><p class="muted small">Links study IDs to names and CNIC numbers. Store separately from research data.</p><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="ack"> I understand this file is identifiable</label><button class="btn danger" id="e4" disabled style="margin-top:8px">Download</button></div></div>`;
  $("#e1").onclick = () => download(`virtualtherapy_demographics_${stamp}.csv`, S.demographicsCsv(ps));
  $("#e2").onclick = () => download(`virtualtherapy_assessments_${stamp}.csv`, S.assessmentsCsv(ps, as, settings.timepoints));
  $("#cam").onchange = e => $("#sc").textContent = (e.target.checked ? camera(ss) : ss).length;
  $("#e3").onclick = () => download(`virtualtherapy_sessions_${stamp}.csv`, S.sessionsCsv(ps, $("#cam").checked ? camera(ss) : ss));
  $("#e5").onclick = () => download(`virtualtherapy_diagnoses_${stamp}.csv`, S.diagnosesCsv(dx));
  $("#ack").onchange = e => $("#e4").disabled = !e.target.checked;
  $("#e4").onclick = async () => download(`virtualtherapy_identity_key_${stamp}.csv`, S.identityCsv(await store.listIdentities()));
}

// ── settings ─────────────────────────────────────────────────────────────────────────────────
async function viewSettings(){
  const demo = store.mode === "local";
  app.innerHTML = pageHead("Settings", "Study configuration and data storage.") + `<div id="msg"></div><div class="card"><h3>⚙️ Study</h3><div class="form-grid">
    <div class="field"><label>Time points <span class="hint">(one per line, in order)</span></label><textarea id="tps" rows="6">${esc(settings.timepoints.join("\n"))}</textarea></div>
    <div class="field"><label>Study groups <span class="hint">(one per line)</span></label><textarea id="grs" rows="6">${esc(settings.groups.join("\n"))}</textarea></div>
    <div class="field"><label>Prescribed game sessions per week</label><input type="number" id="ppw" min="1" max="14" value="${esc(settings.prescribedPerWeek)}"><p class="muted small">Used for the adherence % on the dashboard.</p></div></div><button class="btn" id="sv">Save settings</button></div>
  <div class="card"><h3>☁️ Data storage</h3>${demo ? `<p><span class="badge warn">Local demo mode</span> Everything is stored in this browser only. The patient app on a patient's phone cannot reach this data, so remote tracking needs the cloud setup.</p><p class="muted small">Setup guide: <code>cloud/SETUP.md</code>. After pasting the Firebase config into <code>js/study/cloud-config.js</code> this page switches to cloud mode automatically.</p>
    <div class="row"><button class="btn ghost" id="dg">Load demo data</button><button class="btn danger" id="dc">Remove demo data</button></div><p class="muted small" style="margin-top:8px">Demo participants are clearly fictional and are removed without touching real records.</p>`
    : `<p><span class="badge good">Cloud mode</span> Connected to Firebase. Signed in as <b>${esc(user ? user.email : "")}</b>.</p>`}</div>`;
  $("#sv").onclick = async () => { const lines = id => $(id).value.split("\n").map(x => x.trim()).filter(Boolean), tps = lines("#tps"), grs = lines("#grs");
    if(!tps.length){ $("#msg").innerHTML = `<div class="err">Add at least one time point.</div>`; return; }
    settings = await store.saveSettings({ timepoints: tps, groups: grs, prescribedPerWeek: Math.max(1, Number($("#ppw").value) || 3) }); toast("Settings saved"); };
  if(demo){ $("#dg").onclick = async () => { const n = await store.demo.generate(); toast(n + " demo participants added"); }; $("#dc").onclick = async () => { const n = await store.demo.clear(); toast(n + " demo participants removed"); }; }
}
