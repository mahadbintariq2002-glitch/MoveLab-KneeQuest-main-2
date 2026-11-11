// schema.js — study constants, outcome-measure scoring, validation, analytics helpers and CSV
// builders. Pure functions: no DOM, no storage, no network — so they can be unit-tested and
// reused by both the local and the cloud store.

export const DEFAULTS = {
  timepoints: ["Baseline", "Week 2", "Week 4", "Post-treatment", "Follow-up"],
  groups: ["Game-based", "Conventional"],
  prescribedPerWeek: 3,
};
export const GENDERS   = ["Male", "Female", "Other"];
export const EDUCATION = ["No formal education", "Primary", "Middle", "Matric / Secondary", "Intermediate", "Graduate", "Postgraduate"];
export const MARITAL   = ["Single", "Married", "Widowed", "Divorced"];
export const KL_GRADES = [ {v:1,label:"Grade 1 (doubtful)"}, {v:2,label:"Grade 2 (mild)"}, {v:3,label:"Grade 3 (moderate)"}, {v:4,label:"Grade 4 (severe)"} ];
export const TUG_DEVICES = ["None", "Cane", "Walker", "Crutches", "Other"];

// ── WOMAC (LK 3.1, 0–4 per item): Pain 5 + Stiffness 2 + Function 17 = 24 items, total 0–96, higher = worse.
// Item wording is licensed, so the form uses the standard item numbering only; the researcher enters the
// scores from their licensed form. (Domain order and counts are the instrument's own structure.)
export const WOMAC_PAIN  = Array.from({length:5},  (_,i)=>"A"+(i+1));
export const WOMAC_STIFF = Array.from({length:2},  (_,i)=>"B"+(i+1));
export const WOMAC_FUNC  = Array.from({length:17}, (_,i)=>"C"+(i+1));
export const WOMAC_IDS   = [...WOMAC_PAIN, ...WOMAC_STIFF, ...WOMAC_FUNC];
export const WOMAC_LABEL = id => ({A:"Pain",B:"Stiffness",C:"Function"}[id[0]]) + " " + id.slice(1);

// ── Berg Balance Scale: 14 items, 0–4 each, total 0–56, higher = better.
export const BBS_ITEMS = [
  "Sitting to standing", "Standing unsupported", "Sitting unsupported", "Standing to sitting", "Transfers",
  "Standing with eyes closed", "Standing with feet together", "Reaching forward with outstretched arm",
  "Picking up an object from the floor", "Turning to look behind", "Turning 360 degrees",
  "Placing alternate foot on stool", "Standing with one foot in front", "Standing on one foot",
];
export const BBS_IDS = BBS_ITEMS.map((_,i)=>"b"+(i+1));

const isNum = v => v !== null && v !== undefined && v !== "" && !Number.isNaN(Number(v));

export function womacScore(items = {}){
  const sum = ids => { let s = 0, n = 0; for(const id of ids){ if(isNum(items[id])){ s += Number(items[id]); n++; } } return {s, n}; };
  const P = sum(WOMAC_PAIN), S = sum(WOMAC_STIFF), F = sum(WOMAC_FUNC);
  const complete = P.n === 5 && S.n === 2 && F.n === 17;
  const total = complete ? P.s + S.s + F.s : null;
  return { pain: P.n===5?P.s:null, stiffness: S.n===2?S.s:null, function: F.n===17?F.s:null, total,
           normalized: total==null ? null : Math.round(total/96*1000)/10, answered: P.n+S.n+F.n, complete };
}
export function bbsScore(items = {}){
  let s = 0, n = 0; for(const id of BBS_IDS){ if(isNum(items[id])){ s += Number(items[id]); n++; } }
  return { total: n===14 ? s : null, answered: n, complete: n===14 };
}

// ── Validation ───────────────────────────────────────────────────────────────────────────────
export function normalizeCnic(s){ const d = String(s||"").replace(/\D/g,""); return d.length===13 ? `${d.slice(0,5)}-${d.slice(5,12)}-${d.slice(12)}` : null; }

export function validateParticipant(p){
  const e = [];
  if(!String(p.name||"").trim()) e.push("Name is required.");
  if(!normalizeCnic(p.cnic)) e.push("CNIC must have 13 digits (e.g. 12345-1234567-1).");
  const d = p.demographics || {};
  if(!isNum(d.age) || d.age < 18 || d.age > 110) e.push("Age must be between 18 and 110.");
  if(!GENDERS.includes(d.gender)) e.push("Select a gender.");
  if(!String(d.residence||"").trim()) e.push("Residence is required.");
  if(!EDUCATION.includes(d.education)) e.push("Select an educational level.");
  if(!String(d.occupation||"").trim()) e.push("Occupation is required.");
  if(!MARITAL.includes(d.marital)) e.push("Select a marital status.");
  if(!isNum(d.painDurationMonths) || d.painDurationMonths < 0) e.push("Enter the duration of pain.");
  if(![1,2,3,4].includes(Number(d.klGrade))) e.push("Select the knee OA grade.");
  return e;
}
export function validateAssessment(a){
  const e = [], rng = (v,lo,hi,label) => { if(isNum(v) && (Number(v)<lo || Number(v)>hi)) e.push(`${label} must be between ${lo} and ${hi}.`); };
  if(!a.timepoint) e.push("Choose a time point.");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(a.date||"")) e.push("Enter the assessment date.");
  for(const [id,v] of Object.entries((a.womac&&a.womac.items)||{})) if(isNum(v)) rng(v,0,4,`WOMAC ${id}`);
  for(const [id,v] of Object.entries((a.bbs&&a.bbs.items)||{})) if(isNum(v)) rng(v,0,4,`BBS item ${id.slice(1)}`);
  if(a.tug) rng(a.tug.seconds,1,600,"TUG time (s)");
  rng(a.vas,0,100,"VAS (mm)");
  for(const side of ["left","right"]) if(a.rom&&a.rom[side]){ rng(a.rom[side].flexion,0,180,`${side} knee flexion`); rng(a.rom[side].extension,-30,60,`${side} knee extension`); }
  return e;
}

// Fill in computed scores so stored records are self-contained for export/analysis.
export function finalizeAssessment(a){
  const out = JSON.parse(JSON.stringify(a));
  if(out.womac) out.womac = { items: out.womac.items||{}, ...womacScore(out.womac.items) };
  if(out.bbs)   out.bbs   = { items: out.bbs.items||{},   ...bbsScore(out.bbs.items) };
  return out;
}

// ── IDs / codes ──────────────────────────────────────────────────────────────────────────────
export const formatStudyId = n => "P" + String(n).padStart(3, "0");
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";          // no 0/O/1/I/L — easy to read out over the phone
export function makeAccessCode(){
  const bytes = new Uint8Array(8); (globalThis.crypto || {getRandomValues:a=>a.forEach((_,i)=>a[i]=Math.floor(Math.random()*256))}).getRandomValues(bytes);
  const c = Array.from(bytes, b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  return c.slice(0,4) + "-" + c.slice(4);
}
export const normalizeCode = s => String(s||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
export const prettyCode = s => { const c = normalizeCode(s); return c.length===8 ? c.slice(0,4)+"-"+c.slice(4) : c; };

// ── Analytics helpers ────────────────────────────────────────────────────────────────────────
const DAY = 86400000;
export const sessionTime = s => Date.parse(s.startedAt || s.endedAt || 0) || 0;
export const isPlayed = s => s.status === "completed" || s.status === "ended" || s.status === "abandoned";
export const isDone   = s => s.status === "completed";
export function lastActive(sessions){ let t = 0; for(const s of sessions) t = Math.max(t, sessionTime(s)); return t || null; }
export function sessionsInLastDays(sessions, days, now = Date.now()){ return sessions.filter(s => isDone(s) && now - sessionTime(s) <= days*DAY).length; }
export function mondayOf(t){ const d = new Date(t); d.setHours(0,0,0,0); const k = (d.getDay()+6)%7; return d.getTime() - k*DAY; }
export function weeklyCounts(sessions, weeks = 8, now = Date.now()){
  const end = mondayOf(now), out = [];
  for(let i = weeks-1; i >= 0; i--){ const start = end - i*7*DAY; out.push({ start, label: new Date(start).toLocaleDateString(undefined,{day:"numeric",month:"short"}), n: 0 }); }
  for(const s of sessions){ if(!isDone(s)) continue; const w = out.findIndex(x => sessionTime(s) >= x.start && sessionTime(s) < x.start + 7*DAY); if(w >= 0) out[w].n++; }
  return out;
}
export const avg = a => { const v = a.filter(x => x!=null && !Number.isNaN(x)); return v.length ? v.reduce((p,c)=>p+c,0)/v.length : null; };
export function flags(sessions, now = Date.now()){
  const f = [], la = lastActive(sessions);
  if(la == null) f.push({k:"none", t:"No sessions yet"});
  else if(now - la > 7*DAY) f.push({k:"inactive", t:`Inactive ${Math.floor((now-la)/DAY)} days`});
  const last = [...sessions].sort((a,b)=>sessionTime(b)-sessionTime(a))[0];
  if(last && (last.painAfter >= 7 || last.painBefore >= 7)) f.push({k:"pain", t:`High pain reported (${Math.max(last.painBefore??0,last.painAfter??0)}/10)`});
  return f;
}

// ── CSV ──────────────────────────────────────────────────────────────────────────────────────
const esc = v => { if(v==null) return ""; const s = String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s; };
export function toCsv(rows, cols){ return "﻿" + [cols.map(c=>esc(c.label)).join(","), ...rows.map(r => cols.map(c => esc(c.get(r))).join(","))].join("\r\n"); }
const ymd = t => t ? new Date(t).toISOString().slice(0,10) : "";

export function demographicsCsv(participants){
  return toCsv(participants, [
    {label:"study_id",get:p=>p.studyId}, {label:"group",get:p=>p.group}, {label:"age",get:p=>p.demographics.age}, {label:"gender",get:p=>p.demographics.gender},
    {label:"residence",get:p=>p.demographics.residence}, {label:"education",get:p=>p.demographics.education}, {label:"occupation",get:p=>p.demographics.occupation},
    {label:"marital_status",get:p=>p.demographics.marital}, {label:"pain_duration_months",get:p=>p.demographics.painDurationMonths},
    {label:"kl_grade",get:p=>p.demographics.klGrade}, {label:"enrolled_date",get:p=>ymd(p.enrolledAt)}, {label:"consent_date",get:p=>ymd(p.consentAt)},
  ]);
}
export function assessmentsCsv(participants, assessments, timepoints){
  const byId = Object.fromEntries(participants.map(p => [p.studyId, p]));
  const rows = [...assessments].sort((a,b)=> a.studyId.localeCompare(b.studyId) || timepoints.indexOf(a.timepoint)-timepoints.indexOf(b.timepoint) || a.date.localeCompare(b.date));
  const g = (a,path) => path.split(".").reduce((o,k)=>o==null?undefined:o[k], a);
  const cols = [
    {label:"study_id",get:a=>a.studyId}, {label:"group",get:a=>(byId[a.studyId]||{}).group}, {label:"timepoint",get:a=>a.timepoint}, {label:"date",get:a=>a.date},
    {label:"womac_pain",get:a=>g(a,"womac.pain")}, {label:"womac_stiffness",get:a=>g(a,"womac.stiffness")}, {label:"womac_function",get:a=>g(a,"womac.function")},
    {label:"womac_total",get:a=>g(a,"womac.total")}, {label:"womac_norm100",get:a=>g(a,"womac.normalized")},
    ...WOMAC_IDS.map(id => ({label:"womac_"+id.toLowerCase(), get:a=>g(a,"womac.items."+id)})),
    {label:"tug_seconds",get:a=>g(a,"tug.seconds")}, {label:"tug_device",get:a=>g(a,"tug.device")},
    {label:"bbs_total",get:a=>g(a,"bbs.total")}, ...BBS_IDS.map((id,i)=>({label:"bbs_item"+(i+1), get:a=>g(a,"bbs.items."+id)})),
    {label:"vas_mm",get:a=>a.vas},
    {label:"left_flexion_deg",get:a=>g(a,"rom.left.flexion")}, {label:"left_extension_deg",get:a=>g(a,"rom.left.extension")},
    {label:"right_flexion_deg",get:a=>g(a,"rom.right.flexion")}, {label:"right_extension_deg",get:a=>g(a,"rom.right.extension")},
    {label:"notes",get:a=>a.notes},
  ];
  return toCsv(rows, cols);
}
export function sessionsCsv(participants, sessions){
  const byId = Object.fromEntries(participants.map(p => [p.studyId, p]));
  const rows = [...sessions].sort((a,b)=>a.studyId.localeCompare(b.studyId) || sessionTime(a)-sessionTime(b));
  return toCsv(rows, [
    {label:"session_id",get:s=>s.id}, {label:"study_id",get:s=>s.studyId}, {label:"group",get:s=>(byId[s.studyId]||{}).group}, {label:"started_at",get:s=>s.startedAt},
    {label:"game",get:s=>s.game}, {label:"difficulty",get:s=>s.difficulty}, {label:"status",get:s=>s.status}, {label:"reps_target",get:s=>s.repsTarget}, {label:"reps_done",get:s=>s.repsDone},
    {label:"completed",get:s=>s.completed?1:0}, {label:"stars",get:s=>s.stars}, {label:"score",get:s=>s.score}, {label:"quality_pct",get:s=>s.qualityPct}, {label:"duration_sec",get:s=>s.durationSec},
    {label:"hold_secs",get:s=>s.holdSecs}, {label:"pace_mult",get:s=>s.paceMult}, {label:"ghost",get:s=>s.ghost==null?"":(s.ghost?1:0)}, {label:"input_mode",get:s=>s.inputMode},
    {label:"ext_ref_deg",get:s=>s.extRefDeg}, {label:"knee_min_deg",get:s=>s.kneeAngleMinDeg}, {label:"knee_max_deg",get:s=>s.kneeAngleMaxDeg}, {label:"peak_flexion_deg",get:s=>s.peakFlexionDeg},
    {label:"balance_shift_left",get:s=>s.balShiftMaxLeft}, {label:"balance_shift_right",get:s=>s.balShiftMaxRight},
    {label:"pain_before",get:s=>s.painBefore}, {label:"pain_after",get:s=>s.painAfter}, {label:"app_version",get:s=>s.appVersion}, {label:"language",get:s=>s.lang},
  ]);
}
export function identityCsv(identities){ return toCsv(identities, [{label:"study_id",get:r=>r.studyId},{label:"name",get:r=>r.name},{label:"cnic",get:r=>r.cnic}]); }
