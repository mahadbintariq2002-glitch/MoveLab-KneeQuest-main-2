// researcher.js — researcher dashboard (laptop + phone). Talks only to the store (local or cloud).
import { getStore } from "./store.js";
import * as S from "./schema.js";
import { lineChart, barChart } from "./charts.js";

const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const app = $("#app");
let store, settings, user, redraw = null;
const GAME_NAMES = { quad:"Quad Press", slr:"Lift-Off", heel:"Trace the Arc", tke:"Lock the Slot", tempo:"Tempo Lift", ham:"Reel It In", bal:"Steady Scales" };
const gname = s => GAME_NAMES[s.game] || s.gameName || s.game;

const toast = m => { const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toast._h); toast._h = setTimeout(() => t.classList.remove("on"), 2400); };
const fmtDate = t => t ? new Date(t).toLocaleDateString(undefined, { day:"numeric", month:"short", year:"numeric" }) : "—";
const fmtDT = t => t ? new Date(t).toLocaleString(undefined, { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" }) : "—";
const ago = t => { if(!t) return "never"; const d = Math.floor((Date.now()-t)/86400000); return d <= 0 ? "today" : d === 1 ? "yesterday" : d + " days ago"; };
const r1 = v => v == null ? "—" : (Math.round(v*10)/10);
function download(name, text){ const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type:"text/csv;charset=utf-8" })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
const pdur = m => m >= 12 ? `${Math.floor(m/12)} y${m%12 ? " " + (m%12) + " m" : ""}` : `${m} m`;
const camera = list => list.filter(s => s.inputMode !== "mouse");

// ── boot / routing ───────────────────────────────────────────────────────────────────────────
(async function boot(){
  store = await getStore();
  $("#modeBadge").textContent = store.mode === "cloud" ? "Cloud" : "Local demo mode"; $("#modeBadge").classList.toggle("warn", store.mode !== "cloud");
  $("#signOut").onclick = async () => { await store.researcher.signOut(); user = null; route(); };
  store.researcher.onChange(async u => { user = u; $("#userLabel").textContent = u ? u.email : ""; $("#signOut").hidden = !(u && store.mode === "cloud"); if(u) settings = await store.getSettings(); route(); });
  addEventListener("hashchange", route);
  let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => redraw && redraw(), 150); });
})();

async function route(){
  redraw = null;
  if(!store) return;
  if(store.mode === "cloud" && !user) return viewLogin();
  if(!settings) settings = await store.getSettings();
  const parts = (location.hash.replace(/^#\/?/, "") || "").split("/");
  $$("#nav a[data-r]").forEach(a => a.classList.toggle("on", a.dataset.r === (parts[0] === "p" || parts[0] === "assess" ? "" : parts[0])));
  window.scrollTo(0, 0);
  try{
    switch(parts[0]){
      case "": return await viewList();
      case "add": return viewAdd();
      case "p": return await viewParticipant(parts[1], parts[2] || "outcomes");
      case "assess": return await viewAssess(parts[1], parts[2]);
      case "export": return await viewExport();
      case "settings": return await viewSettings();
      default: app.innerHTML = `<div class="card empty">Page not found. <a href="#/">Back to participants</a></div>`;
    }
  }catch(e){ console.error(e); app.innerHTML = `<div class="err">${esc(e.message || e)}</div><a href="#/">← Participants</a>`; }
}

function viewLogin(){
  app.innerHTML = `<div class="card" style="max-width:420px;margin:40px auto"><h2>Researcher sign-in</h2>
    <div id="lerr"></div><form id="lf"><div class="field"><label>Email</label><input type="email" id="le" autocomplete="username" required></div>
    <div class="field"><label>Password</label><input type="password" id="lp" autocomplete="current-password" required></div>
    <button class="btn" style="width:100%">Sign in</button></form>
    <p class="muted small" style="margin-top:12px">Researcher accounts are created by the project owner in the Firebase console (see cloud/SETUP.md).</p></div>`;
  $("#lf").onsubmit = async e => { e.preventDefault(); $("#lerr").innerHTML = "";
    try{ user = await store.researcher.signIn($("#le").value.trim(), $("#lp").value); settings = await store.getSettings(); route(); }
    catch(err){ $("#lerr").innerHTML = `<div class="err">${esc(err.message)}</div>`; } };
}

// ── participants list ────────────────────────────────────────────────────────────────────────
async function viewList(){
  app.innerHTML = `<p class="muted">Loading…</p>`;
  const [ps, ss] = await Promise.all([store.listParticipants(), store.listSessions()]);
  const by = {}; for(const s of camera(ss)) (by[s.studyId] ||= []).push(s);
  const rows = ps.map(p => { const sess = by[p.studyId] || [], n7 = S.sessionsInLastDays(sess, 7), fl = S.flags(sess);
    return { p, n7, la: S.lastActive(sess), fl, total: sess.filter(S.isDone).length, adh: Math.min(100, Math.round(n7 / (settings.prescribedPerWeek || 3) * 100)) }; });
  const active = rows.filter(r => r.n7 > 0).length, week = rows.reduce((a, r) => a + r.n7, 0), alerts = rows.filter(r => r.fl.some(f => f.k !== "none")).length;
  const groups = [...new Set(ps.map(p => p.group).filter(Boolean))];
  app.innerHTML = `
    ${store.mode !== "cloud" ? `<div class="ok">Local demo mode — data stays in this browser (not remote tracking). <a href="#/settings">Turn on cloud tracking</a></div>` : ""}
    <div class="row between" style="margin-bottom:12px"><div><h1>Participants</h1><span class="muted">Camera sessions only · prescribed ${settings.prescribedPerWeek}/week</span></div><a class="btn" href="#/add">+ Add participant</a></div>
    <div class="tiles"><div class="tile"><b>${ps.length}</b><span>Participants</span></div><div class="tile"><b>${active}</b><span>Active in last 7 days</span></div>
      <div class="tile"><b>${week}</b><span>Sessions in last 7 days</span></div><div class="tile"><b style="color:${alerts?'var(--bad)':'inherit'}">${alerts}</b><span>Need attention</span></div></div>
    <div class="card"><div class="row" style="margin-bottom:12px"><input id="q" placeholder="Search study ID…" style="max-width:220px">
      <select id="gf" style="max-width:200px"><option value="">All groups</option>${groups.map(g => `<option>${esc(g)}</option>`).join("")}</select>
      <label style="margin:0;display:flex;gap:6px;align-items:center;font-weight:600"><input type="checkbox" id="af" style="width:auto"> Needs attention only</label></div>
      <div class="tablewrap"><table class="cards"><thead><tr><th>Study ID</th><th>Group</th><th>Age · Sex</th><th>KL</th><th>Enrolled</th><th>Last active</th><th>7-day</th><th>Adherence</th><th>Alerts</th></tr></thead><tbody id="tb"></tbody></table></div>
      <div id="none" class="empty" hidden>No participants yet. <a href="#/add">Add the first participant</a>${store.mode === "local" ? ` or <a href="#/settings">load demo data</a>` : ""}.</div></div>`;
  const draw = () => { const q = $("#q").value.trim().toUpperCase(), g = $("#gf").value, a = $("#af").checked;
    const list = rows.filter(r => (!q || r.p.studyId.includes(q)) && (!g || r.p.group === g) && (!a || r.fl.some(f => f.k !== "none")));
    $("#tb").innerHTML = list.map(r => `<tr class="click" data-id="${r.p.studyId}"><td data-label="Study ID"><b>${r.p.studyId}</b></td><td data-label="Group">${esc(r.p.group || "—")}</td>
      <td data-label="Age · Sex">${esc(r.p.demographics.age)} · ${esc((r.p.demographics.gender || "")[0] || "")}</td><td data-label="KL">${esc(r.p.demographics.klGrade)}</td><td data-label="Enrolled">${fmtDate(r.p.enrolledAt)}</td>
      <td data-label="Last active">${ago(r.la)}</td><td data-label="7-day" class="num">${r.n7}</td><td data-label="Adherence"><span class="pill ${r.adh >= 80 ? "good" : r.adh >= 40 ? "warn" : "bad"}">${r.adh}%</span></td>
      <td data-label="Alerts">${r.fl.filter(f => f.k !== "none").map(f => `<span class="pill ${f.k === "pain" ? "bad" : "warn"}">${esc(f.t)}</span>`).join("") || (r.fl.length ? `<span class="muted small">No sessions yet</span>` : "—")}</td></tr>`).join("");
    $("#none").hidden = rows.length > 0; $$("#tb tr").forEach(tr => tr.onclick = () => location.hash = "#/p/" + tr.dataset.id); };
  ["input", "change"].forEach(ev => { $("#q").addEventListener(ev, draw); $("#gf").addEventListener(ev, draw); $("#af").addEventListener(ev, draw); }); draw();
}

// ── add participant ──────────────────────────────────────────────────────────────────────────
function viewAdd(){
  const opt = (a, f = x => x) => a.map(x => `<option value="${esc(typeof x === "object" ? x.v : x)}">${esc(f(x))}</option>`).join("");
  app.innerHTML = `<h1>Add participant</h1><p class="muted">The name and CNIC are stored separately from the research data and are never included in the de-identified exports.</p><div id="msg"></div>
  <form id="f" class="card"><h3>Identity <span class="hint">(kept separate; shown to researchers only)</span></h3><div class="form-grid">
    <div class="field"><label>Name</label><input name="name" autocomplete="off" required></div>
    <div class="field"><label>CNIC number <span class="hint">13 digits</span></label><input name="cnic" inputmode="numeric" placeholder="12345-1234567-1" autocomplete="off" required></div></div>
    <h3 style="margin-top:8px">Demographics</h3><div class="form-grid">
    <div class="field"><label>Age (years)</label><input name="age" type="number" min="18" max="110" required></div>
    <div class="field"><label>Gender</label><select name="gender" required><option value="">Select…</option>${opt(S.GENDERS)}</select></div>
    <div class="field"><label>Residence</label><input name="residence" list="resl" autocomplete="off" required><datalist id="resl"><option>Urban</option><option>Rural</option></datalist></div>
    <div class="field"><label>Educational level</label><select name="education" required><option value="">Select…</option>${opt(S.EDUCATION)}</select></div>
    <div class="field"><label>Occupation</label><input name="occupation" autocomplete="off" required></div>
    <div class="field"><label>Marital status</label><select name="marital" required><option value="">Select…</option>${opt(S.MARITAL)}</select></div>
    <div class="field"><label>Duration of pain</label><div class="row" style="flex-wrap:nowrap"><input name="pd" type="number" min="0" step="0.5" required><select name="pdu" style="max-width:110px"><option value="months">months</option><option value="years">years</option></select></div></div>
    <div class="field"><label>Knee OA grade (Kellgren–Lawrence)</label><select name="klGrade" required><option value="">Select…</option>${opt(S.KL_GRADES, g => g.label)}</select></div>
    <div class="field"><label>Study group <span class="hint">(optional)</span></label><select name="group"><option value="">Not assigned</option>${opt(settings.groups)}</select></div></div>
    <div class="row" style="margin-top:8px"><button class="btn">Create participant</button><a class="btn ghost" href="#/">Cancel</a></div></form>`;
  $("#f").onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target), g = k => String(f.get(k) || "").trim(); $("#msg").innerHTML = "";
    const pd = Number(g("pd")), months = Math.round(g("pdu") === "years" ? pd * 12 : pd);
    const input = { name: g("name"), cnic: g("cnic"), group: g("group") || null, demographics: { age: Number(g("age")), gender: g("gender"), residence: g("residence"), education: g("education"),
      occupation: g("occupation"), marital: g("marital"), painDurationMonths: months, klGrade: Number(g("klGrade")) } };
    const errs = S.validateParticipant(input); if(errs.length){ $("#msg").innerHTML = `<div class="err">${errs.map(esc).join("<br>")}</div>`; window.scrollTo(0, 0); return; }
    try{ const r = await store.registerParticipant(input); showCreated(r.studyId, r.accessCode, input.demographics); }
    catch(err){ $("#msg").innerHTML = `<div class="err">${esc(err.message)}</div>`; } };
}
function showCreated(id, code){
  app.innerHTML = `<div class="card" style="max-width:560px;margin:20px auto;text-align:center"><div class="ok">Participant created</div>
    <p class="muted">Give these to the participant. They sign in at <b>${esc(location.origin + location.pathname.replace(/researcher\.html$/, "participant.html"))}</b></p>
    <p class="muted small" style="margin:0">Study ID</p><div class="codebox" style="margin-bottom:10px">${esc(id)}</div>
    <p class="muted small" style="margin:0">Access code</p><div class="codebox">${esc(code)}</div>
    <div class="row" style="justify-content:center;margin-top:16px"><button class="btn ghost" id="cp">Copy both</button><button class="btn ghost" id="pr">Print card</button><a class="btn" href="#/assess/${id}">Record baseline</a><a class="btn ghost" href="#/p/${id}">Open participant</a></div>
    <p class="muted small" style="margin-top:12px">You can see this code again under the participant's “Details & access” tab.</p></div>`;
  $("#cp").onclick = () => { navigator.clipboard && navigator.clipboard.writeText(`Study ID: ${id}\nAccess code: ${code}`); toast("Copied"); };
  $("#pr").onclick = () => { const w = open("", "_blank"); w.document.write(`<body style="font:20px system-ui;padding:30px"><h2>MoveLab study</h2><p>Study ID: <b>${esc(id)}</b></p><p>Access code: <b style="letter-spacing:.12em">${esc(code)}</b></p><p>Sign in at: ${esc(location.origin + location.pathname.replace(/researcher\.html$/, "participant.html"))}</p></body>`); w.print(); };
}

// ── participant detail ───────────────────────────────────────────────────────────────────────
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
  const [p, as, ss] = await Promise.all([store.getParticipant(id), store.listAssessments(id), store.listSessions(id)]);
  if(!p) throw new Error("Unknown participant " + id);
  const fl = S.flags(camera(ss)).filter(f => f.k !== "none"), d = p.demographics;
  app.innerHTML = `<div class="row between" style="margin-bottom:6px"><div><a href="#/" class="small">← Participants</a><h1>${esc(p.studyId)} <span class="pill">${esc(p.group || "No group")}</span><span class="pill">KL ${esc(d.klGrade)}</span>${fl.map(f => `<span class="pill ${f.k === "pain" ? "bad" : "warn"}">${esc(f.t)}</span>`).join("")}</h1>
    <span class="muted">${esc(d.age)} y · ${esc(d.gender)} · enrolled ${fmtDate(p.enrolledAt)}</span></div><a class="btn" href="#/assess/${id}">+ Record assessment</a></div>
    <div class="tabs"><a href="#/p/${id}/outcomes" class="${tab === "outcomes" ? "on" : ""}">Outcome measures</a><a href="#/p/${id}/games" class="${tab === "games" ? "on" : ""}">Game progress</a><a href="#/p/${id}/details" class="${tab === "details" ? "on" : ""}">Details & access</a></div><div id="tab"></div>`;
  if(tab === "games") tabGames(p, ss); else if(tab === "details") await tabDetails(p, as); else tabOutcomes(p, as);
}

function tabOutcomes(p, asRaw){
  const as = orderAssess(asRaw), box = $("#tab");
  if(!as.length){ box.innerHTML = `<div class="card empty">No assessments recorded yet.<br><br><a class="btn" href="#/assess/${p.studyId}">Record baseline assessment</a></div>`; return; }
  const num = v => (v == null || v === "" || Number.isNaN(Number(v))) ? null : Number(v), base = as[0], last = as[as.length - 1];
  const head = as.map(a => `<th><a href="#/assess/${p.studyId}/${a.id}" title="Edit">${esc(a.timepoint)}</a><div class="muted small" style="text-transform:none;font-weight:400">${esc(a.date)}</div></th>`).join("");
  const body = MEASURES.map(m => { const vals = as.map(a => num(m.get(a))), b = num(m.get(base)), l = num(m.get(last));
    const dl = (as.length > 1 && b != null && l != null) ? Math.round((l - b) * 10) / 10 : null, good = dl == null || dl === 0 ? "" : ((m.better === "lower") === (dl < 0) ? "better" : "worse");
    return `<tr><td><b style="${m.label.startsWith("  ") ? "font-weight:500;padding-left:12px" : ""}">${esc(m.label.trim())}</b></td>${vals.map(v => `<td class="num">${v == null ? "—" : r1(v)}</td>`).join("")}<td class="num delta ${good}">${dl == null ? "—" : (dl > 0 ? "+" : "") + dl}</td></tr>`; }).join("");
  box.innerHTML = `<div class="card"><div class="tablewrap"><table><thead><tr><th>Measure</th>${head}<th>Change<div class="muted small" style="text-transform:none;font-weight:400">last vs first</div></th></tr></thead><tbody>${body}</tbody></table></div>
    <p class="muted small" style="margin:8px 0 0">Green = improved, red = worsened. Lower is better for WOMAC, TUG, VAS and extension deficit; higher is better for BBS and flexion.</p></div>
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
    box.innerHTML = `<div class="row between" style="margin-bottom:10px"><span class="muted small">${ssAll.length - camera(ssAll).length ? `${ssAll.length - camera(ssAll).length} mouse-preview/test session(s) excluded by default` : "&nbsp;"}</span>
      <label style="margin:0;display:flex;gap:6px;align-items:center;font-weight:600"><input type="checkbox" id="incl" style="width:auto" ${incl ? "checked" : ""}> Include test sessions</label></div>
      <div class="tiles"><div class="tile"><b>${done.length}</b><span>Completed sessions</span></div><div class="tile"><b>${S.sessionsInLastDays(ss, 7)}</b><span>Last 7 days (prescribed ${settings.prescribedPerWeek})</span></div>
      <div class="tile"><b>${r1(S.avg(q5))}${q5.length ? "%" : ""}</b><span>Avg quality, last 5</span></div><div class="tile"><b>${ago(la)}</b><span>Last active</span></div>
      <div class="tile"><b>${r1(pb)} → ${r1(pa)}</b><span>Avg pain before → after (0–10)</span></div></div>
      <div class="charts"><div class="chartcard"><h3>Completed sessions per week</h3><canvas id="g0"></canvas></div><div class="chartcard"><h3>Quality % per session</h3><canvas id="g1"></canvas></div>
      <div class="chartcard"><h3>Pain before vs after (0–10)</h3><canvas id="g2"></canvas></div><div class="chartcard"><h3>Peak knee flexion (°, camera-estimated)</h3><canvas id="g3"></canvas></div></div>
      <div class="card" style="margin-top:16px"><h3>By game</h3><div class="tablewrap"><table><thead><tr><th>Game</th><th>Sessions</th><th>Avg quality</th><th>Avg stars</th><th>Last played</th></tr></thead><tbody>
      ${Object.entries(byGame).map(([g, a]) => { const dn = a.filter(S.isDone); return `<tr><td>${esc(gname(a[0]))}</td><td class="num">${dn.length}</td><td class="num">${r1(S.avg(dn.map(s => s.qualityPct)))}</td><td class="num">${r1(S.avg(dn.map(s => s.stars)))}</td><td>${fmtDate(S.lastActive(a))}</td></tr>`; }).join("") || `<tr><td colspan="5" class="muted">No sessions yet</td></tr>`}</tbody></table></div></div>
      <div class="card"><h3>Recent sessions</h3><div class="tablewrap"><table class="cards"><thead><tr><th>When</th><th>Game</th><th>Level</th><th>Status</th><th>Reps</th><th>Quality</th><th>Pain</th><th>Mode</th></tr></thead><tbody>
      ${[...ss].reverse().slice(0, 15).map(s => `<tr><td data-label="When">${fmtDT(S.sessionTime(s))}</td><td data-label="Game">${esc(gname(s))}</td><td data-label="Level">${esc(s.difficulty || "—")}</td>
        <td data-label="Status"><span class="pill ${s.status === "completed" ? "good" : s.status === "abandoned" ? "warn" : s.status === "skipped_pain" ? "bad" : ""}">${esc(String(s.status).replace("_", " "))}</span></td>
        <td data-label="Reps" class="num">${s.repsDone ?? "—"}/${s.repsTarget ?? "—"}</td><td data-label="Quality" class="num">${s.qualityPct ?? "—"}</td><td data-label="Pain" class="num">${s.painBefore ?? "—"} → ${s.painAfter ?? "—"}</td><td data-label="Mode">${esc(s.inputMode || "—")}</td></tr>`).join("") || `<tr><td colspan="8" class="muted">No sessions yet</td></tr>`}</tbody></table></div></div>`;
    $("#incl").onchange = e => { incl = e.target.checked; render(); };
    const lab = done.map(s => new Date(S.sessionTime(s)).toLocaleDateString(undefined, { day: "numeric", month: "short" })), flexS = done.filter(s => s.peakFlexionDeg != null);
    redraw = () => { barChart($("#g0"), { labels: weekly.map(w => w.label), values: weekly.map(w => w.n), ref: settings.prescribedPerWeek });
      lineChart($("#g1"), { labels: lab, series: [{ label: "Quality", data: done.map(s => s.qualityPct) }], min: 0, max: 100 });
      lineChart($("#g2"), { labels: lab, series: [{ label: "Before", data: done.map(s => s.painBefore) }, { label: "After", data: done.map(s => s.painAfter) }], min: 0, max: 10 });
      lineChart($("#g3"), { labels: flexS.map(s => new Date(S.sessionTime(s)).toLocaleDateString(undefined, { day: "numeric", month: "short" })), series: [{ label: "Peak flexion", data: flexS.map(s => s.peakFlexionDeg) }] }); }; redraw();
  };
  render();
}

async function tabDetails(p, as){
  const d = p.demographics, box = $("#tab");
  box.innerHTML = `<div class="charts" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))"><div class="card"><h3>Demographics</h3><dl class="kv"><dt>Age</dt><dd>${esc(d.age)}</dd><dt>Gender</dt><dd>${esc(d.gender)}</dd><dt>Residence</dt><dd>${esc(d.residence)}</dd><dt>Education</dt><dd>${esc(d.education)}</dd>
    <dt>Occupation</dt><dd>${esc(d.occupation)}</dd><dt>Marital status</dt><dd>${esc(d.marital)}</dd><dt>Duration of pain</dt><dd>${pdur(d.painDurationMonths)}</dd><dt>Knee OA grade</dt><dd>Kellgren–Lawrence ${esc(d.klGrade)}</dd>
    <dt>Consent</dt><dd>${p.consentAt ? "Given " + fmtDate(p.consentAt) : `<span class="pill warn">Not yet given</span>`}</dd></dl>
    <div class="field" style="margin-top:12px"><label>Study group</label><select id="grp"><option value="">Not assigned</option>${settings.groups.map(g => `<option ${p.group === g ? "selected" : ""}>${esc(g)}</option>`).join("")}</select></div></div>
    <div class="card"><h3>Identity <span class="hint">(restricted)</span></h3><div id="idbox"><button class="btn ghost" id="reveal">Show name & CNIC</button></div>
    <h3 style="margin-top:18px">Participant access</h3><p class="muted small">Study ID and access code for signing in to the participant app.</p>
    <div class="row"><div><div class="muted small">Study ID</div><div class="codebox" style="font-size:20px;padding:8px 12px">${esc(p.studyId)}</div></div><div><div class="muted small">Access code</div><div class="codebox" style="font-size:20px;padding:8px 12px" id="codev">${esc(p.accessCode)}</div></div></div>
    <div class="row" style="margin-top:10px"><button class="btn small ghost" id="cpc">Copy</button><button class="btn small danger" id="newc">Issue new code</button></div>
    <p class="muted small" style="margin-top:8px">A new code signs the participant out of their devices; they enter the new code to continue.</p></div></div>`;
  $("#grp").onchange = async e => { await store.updateParticipant(p.studyId, { group: e.target.value || null }); toast("Group updated"); };
  $("#reveal").onclick = async () => { const i = await store.getIdentity(p.studyId); $("#idbox").innerHTML = i ? `<dl class="kv"><dt>Name</dt><dd>${esc(i.name)}</dd><dt>CNIC</dt><dd>${esc(i.cnic)}</dd></dl>` : `<span class="muted">Not found</span>`; };
  $("#cpc").onclick = () => { navigator.clipboard && navigator.clipboard.writeText(`Study ID: ${p.studyId}\nAccess code: ${$("#codev").textContent}`); toast("Copied"); };
  $("#newc").onclick = async () => { if(!confirm("Issue a new access code? The old one stops working.")) return; $("#codev").textContent = await store.resetAccessCode(p.studyId); toast("New code issued"); };
}

// ── assessment form ──────────────────────────────────────────────────────────────────────────
async function viewAssess(id, aid){
  const p = await store.getParticipant(id); if(!p) throw new Error("Unknown participant " + id);
  const old = aid ? (await store.listAssessments(id)).find(a => a.id === aid) : null, v = old || {}, tps = settings.timepoints;
  const sel = (attr, key, max = 4, val) => `<select data-${attr}="${key}"><option value="">–</option>${Array.from({ length: max + 1 }, (_, i) => `<option ${String(val) === String(i) ? "selected" : ""}>${i}</option>`).join("")}</select>`;
  const wi = (v.womac && v.womac.items) || {}, bi = (v.bbs && v.bbs.items) || {}, rom = v.rom || {}, L = rom.left || {}, R = rom.right || {};
  const known = !v.timepoint || tps.includes(v.timepoint);
  app.innerHTML = `<div id="af"><a href="#/p/${id}" class="small">← ${esc(id)}</a><h1>${old ? "Edit" : "Record"} assessment — ${esc(id)}</h1><div id="msg"></div>
  <details open><summary>Visit</summary><div class="body"><div class="form-grid"><div class="field"><label>Time point</label><select id="tp">${tps.map(t => `<option ${v.timepoint === t ? "selected" : ""}>${esc(t)}</option>`).join("")}<option value="__other" ${known ? "" : "selected"}>Other…</option></select>
    <input id="tpo" placeholder="Custom time point" style="margin-top:6px;${known ? "display:none" : ""}" value="${known ? "" : esc(v.timepoint)}"></div>
    <div class="field"><label>Date</label><input type="date" id="dt" value="${esc(v.date || new Date().toISOString().slice(0, 10))}"></div></div></div></details>
  <details><summary>WOMAC <span class="muted small" id="wsum"></span></summary><div class="body"><p class="muted small">Enter each item's 0–4 score from your licensed WOMAC form (0 none … 4 extreme). Items are numbered as on the form.</p>
    ${[["Pain (5 items)", S.WOMAC_PAIN], ["Stiffness (2 items)", S.WOMAC_STIFF], ["Physical function (17 items)", S.WOMAC_FUNC]].map(([t, ids]) => `<h3>${t}</h3><div class="items" style="margin-bottom:12px">${ids.map(i => `<div class="field"><label>${S.WOMAC_LABEL(i)}</label>${sel("womac", i, 4, wi[i])}</div>`).join("")}</div>`).join("")}</div></details>
  <details><summary>Timed Up and Go (TUG) <span class="muted small" id="tsum"></span></summary><div class="body"><div class="row" style="align-items:flex-start"><div><div class="stopwatch" id="sw">0.0 s</div><div class="row"><button type="button" class="btn small" id="sws">Start</button><button type="button" class="btn small ghost" id="swr">Reset</button></div></div>
    <div class="grow form-grid"><div class="field"><label>Time (seconds)</label><input type="number" step="0.1" min="1" id="tugs" value="${esc(v.tug ? v.tug.seconds : "")}"></div><div class="field"><label>Assistive device</label><select id="tugd">${S.TUG_DEVICES.map(x => `<option ${v.tug && v.tug.device === x ? "selected" : ""}>${x}</option>`).join("")}</select></div></div></div></div></details>
  <details><summary>Berg Balance Scale <span class="muted small" id="bsum"></span></summary><div class="body"><div class="items">${S.BBS_ITEMS.map((n, i) => `<div class="field"><label>${i + 1}. ${esc(n)}</label>${sel("bbs", "b" + (i + 1), 4, bi["b" + (i + 1)])}</div>`).join("")}</div></div></details>
  <details><summary>VAS pain</summary><div class="body"><div class="form-grid"><div class="field"><label>Pain (0 = none, 100 mm = worst)</label><input type="range" min="0" max="100" id="vasr" value="${esc(v.vas ?? 0)}"><input type="number" min="0" max="100" id="vas" placeholder="not recorded" value="${esc(v.vas ?? "")}" style="margin-top:6px"></div></div></div></details>
  <details><summary>Knee range of motion (goniometer)</summary><div class="body"><p class="muted small">Flexion in degrees. Extension: 0 = fully straight; enter a lag as a positive number (10 = 10° short of straight); hyperextension as negative.</p>
    <div class="form-grid"><div class="field"><label>Left knee — flexion (°)</label><input type="number" id="lf" min="0" max="180" value="${esc(L.flexion ?? "")}"></div><div class="field"><label>Left knee — extension (°)</label><input type="number" id="le" min="-30" max="60" value="${esc(L.extension ?? "")}"></div>
    <div class="field"><label>Right knee — flexion (°)</label><input type="number" id="rf" min="0" max="180" value="${esc(R.flexion ?? "")}"></div><div class="field"><label>Right knee — extension (°)</label><input type="number" id="re" min="-30" max="60" value="${esc(R.extension ?? "")}"></div></div></div></details>
  <div class="card"><div class="field"><label>Notes</label><textarea id="nt" rows="2">${esc(v.notes || "")}</textarea></div><div class="row"><button class="btn" id="save">Save assessment</button><a class="btn ghost" href="#/p/${id}">Cancel</a>${old ? `<button class="btn danger right" id="del">Delete</button>` : ""}</div></div></div>`;

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
  const [ps, as, ss] = await Promise.all([store.listParticipants(), store.listAssessments(), store.listSessions()]); const stamp = new Date().toISOString().slice(0, 10);
  app.innerHTML = `<h1>Export data</h1><p class="muted">CSV files (UTF-8, open directly in Excel or import into SPSS). Research files use the study ID only.</p><div class="charts" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
    <div class="card"><h3>Demographics</h3><p class="muted small">One row per participant · ${ps.length} rows · de-identified</p><button class="btn" id="e1">Download</button></div>
    <div class="card"><h3>Outcome assessments</h3><p class="muted small">One row per participant × time point · ${as.length} rows · WOMAC items & subscales, TUG, BBS items, VAS, knee ROM</p><button class="btn" id="e2">Download</button></div>
    <div class="card"><h3>Game sessions</h3><p class="muted small">One row per session · <span id="sc">${camera(ss).length}</span> rows · adherence, quality, pain, peak knee angle</p><label style="display:flex;gap:6px;align-items:center;font-weight:600"><input type="checkbox" id="cam" checked style="width:auto"> Camera sessions only</label><button class="btn" id="e3" style="margin-top:8px">Download</button></div>
    <div class="card" style="border-color:#f0c36d"><h3>Identity key (restricted)</h3><p class="muted small">Links study IDs to names and CNIC numbers. Store separately from research data.</p><label style="display:flex;gap:6px;align-items:center;font-weight:600"><input type="checkbox" id="ack" style="width:auto"> I understand this file is identifiable</label><button class="btn danger" id="e4" disabled style="margin-top:8px">Download</button></div></div>`;
  $("#e1").onclick = () => download(`movelab_demographics_${stamp}.csv`, S.demographicsCsv(ps));
  $("#e2").onclick = () => download(`movelab_assessments_${stamp}.csv`, S.assessmentsCsv(ps, as, settings.timepoints));
  $("#cam").onchange = e => $("#sc").textContent = (e.target.checked ? camera(ss) : ss).length;
  $("#e3").onclick = () => download(`movelab_sessions_${stamp}.csv`, S.sessionsCsv(ps, $("#cam").checked ? camera(ss) : ss));
  $("#ack").onchange = e => $("#e4").disabled = !e.target.checked;
  $("#e4").onclick = async () => download(`movelab_identity_key_${stamp}.csv`, S.identityCsv(await store.listIdentities()));
}

// ── settings ─────────────────────────────────────────────────────────────────────────────────
async function viewSettings(){
  const demo = store.mode === "local";
  app.innerHTML = `<h1>Settings</h1><div id="msg"></div><div class="card"><h3>Study</h3><div class="form-grid">
    <div class="field"><label>Time points <span class="hint">(one per line, in order)</span></label><textarea id="tps" rows="6">${esc(settings.timepoints.join("\n"))}</textarea></div>
    <div class="field"><label>Study groups <span class="hint">(one per line)</span></label><textarea id="grs" rows="6">${esc(settings.groups.join("\n"))}</textarea></div>
    <div class="field"><label>Prescribed game sessions per week</label><input type="number" id="ppw" min="1" max="14" value="${esc(settings.prescribedPerWeek)}"><p class="muted small">Used for the adherence % on the dashboard.</p></div></div><button class="btn" id="sv">Save settings</button></div>
  <div class="card"><h3>Data storage</h3>${demo ? `<p><span class="badge warn">Local demo mode</span> Everything is stored in this browser only. The participant app on a patient's phone cannot reach this data, so remote tracking needs the cloud setup.</p><p class="muted small">Setup guide: <code>cloud/SETUP.md</code>. After pasting the Firebase config into <code>js/study/cloud-config.js</code> this page switches to cloud mode automatically.</p>
    <div class="row"><button class="btn ghost" id="dg">Load demo data</button><button class="btn danger" id="dc">Remove demo data</button></div><p class="muted small">Demo participants are clearly fictional and are removed without touching real records.</p>`
    : `<p><span class="badge good">Cloud mode</span> Connected. Signed in as ${esc(user ? user.email : "")}.</p>`}</div>`;
  $("#sv").onclick = async () => { const lines = id => $(id).value.split("\n").map(x => x.trim()).filter(Boolean), tps = lines("#tps"), grs = lines("#grs");
    if(!tps.length){ $("#msg").innerHTML = `<div class="err">Add at least one time point.</div>`; return; }
    settings = await store.saveSettings({ timepoints: tps, groups: grs, prescribedPerWeek: Math.max(1, Number($("#ppw").value) || 3) }); toast("Settings saved"); };
  if(demo){ $("#dg").onclick = async () => { const n = await store.demo.generate(); toast(n + " demo participants added"); }; $("#dc").onclick = async () => { const n = await store.demo.clear(); toast(n + " demo participants removed"); }; }
}
