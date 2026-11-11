// localstore.js — study data kept in this browser's localStorage. Same interface as the cloud store,
// so the whole app runs (and can be demonstrated/tested) before a cloud project exists. In this mode
// the researcher dashboard and the participant app share one device — it is NOT remote tracking.
import { DEFAULTS, formatStudyId, makeAccessCode, normalizeCode, normalizeCnic, finalizeAssessment, validateParticipant, sessionTime } from "./schema.js";

const KEY = "movelab_study_v1", PKEY = "movelab_participant_v1";
const blank = () => ({ participants:{}, identities:{}, assessments:[], sessions:[], consents:{}, settings:{...DEFAULTS}, counter:0 });
const read = () => { try{ const d = JSON.parse(localStorage.getItem(KEY)); return d ? {...blank(), ...d, settings:{...DEFAULTS, ...(d.settings||{})}} : blank(); }catch(e){ return blank(); } };
const write = db => localStorage.setItem(KEY, JSON.stringify(db));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "x" + Date.now().toString(36) + Math.random().toString(36).slice(2,8));
const clone = o => JSON.parse(JSON.stringify(o));

export function createLocalStore(){
  const store = {
    mode: "local",

    researcher: {                                              // no login in local mode
      async signIn(){ return this.current(); }, async signOut(){}, current(){ return { email:"Local mode (this device only)" }; },
      onChange(cb){ cb(this.current()); return () => {}; },
    },

    async getSettings(){ return clone(read().settings); },
    async saveSettings(s){ const db = read(); db.settings = {...db.settings, ...s}; write(db); return clone(db.settings); },

    async listParticipants(){
      const db = read();
      return Object.values(db.participants).sort((a,b)=>a.studyId.localeCompare(b.studyId)).map(p => ({...clone(p), consentAt:(db.consents[p.studyId]||{}).at||null}));
    },
    async getParticipant(id){ const db = read(), p = db.participants[id]; return p ? {...clone(p), consentAt:(db.consents[id]||{}).at||null} : null; },
    async registerParticipant({ name, cnic, demographics, group }){
      const errs = validateParticipant({ name, cnic, demographics }); if(errs.length) throw new Error(errs.join(" "));
      const db = read(); db.counter++; const studyId = formatStudyId(db.counter), accessCode = makeAccessCode();
      db.participants[studyId] = { studyId, group: group||null, demographics: clone(demographics), accessCode, enrolledAt: Date.now() };
      db.identities[studyId] = { studyId, name: name.trim(), cnic: normalizeCnic(cnic) };
      write(db); return { studyId, accessCode };
    },
    async updateParticipant(id, patch){ const db = read(); if(!db.participants[id]) throw new Error("Unknown participant."); db.participants[id] = {...db.participants[id], ...clone(patch)}; write(db); },
    async resetAccessCode(id){ const db = read(); if(!db.participants[id]) throw new Error("Unknown participant."); db.participants[id].accessCode = makeAccessCode(); write(db); return db.participants[id].accessCode; },
    async getIdentity(id){ return clone(read().identities[id] || null); },
    async listIdentities(){ return Object.values(clone(read().identities)); },

    async saveAssessment(studyId, a){
      const db = read(), rec = finalizeAssessment({ ...a, studyId }); rec.id = rec.id || uid(); rec.createdAt = rec.createdAt || Date.now(); rec.updatedAt = Date.now();
      const i = db.assessments.findIndex(x => x.id === rec.id); if(i >= 0) db.assessments[i] = rec; else db.assessments.push(rec); write(db); return rec;
    },
    async listAssessments(studyId){ const all = read().assessments; return clone(studyId ? all.filter(a => a.studyId === studyId) : all); },
    async deleteAssessment(id){ const db = read(); db.assessments = db.assessments.filter(a => a.id !== id); write(db); },
    async listSessions(studyId){ const all = read().sessions; return clone(studyId ? all.filter(s => s.studyId === studyId) : all); },

    participant: {
      async login(studyId, code){
        const db = read(), id = String(studyId||"").trim().toUpperCase(), p = db.participants[id];
        if(!p || normalizeCode(p.accessCode) !== normalizeCode(code)) throw new Error("Study ID or access code not recognised.");
        const prev = this.current(); let dl = null; try{ dl = localStorage.getItem("movelab_lang"); }catch(e){}
        const sess = { studyId: id, lang: (prev && prev.lang) || dl || "en", consented: !!db.consents[id], at: Date.now() };
        localStorage.setItem(PKEY, JSON.stringify(sess)); return sess;
      },
      current(){ try{ return JSON.parse(localStorage.getItem(PKEY)); }catch(e){ return null; } },
      async setLang(lang){ const s = this.current(); if(s){ s.lang = lang; localStorage.setItem(PKEY, JSON.stringify(s)); } },
      async logout(){ localStorage.removeItem(PKEY); },
      async hasConsent(){ const s = this.current(); return !!(s && read().consents[s.studyId]); },
      async saveConsent(c){ const s = this.current(); if(!s) throw new Error("Not signed in."); const db = read(); db.consents[s.studyId] = { ...c, at: Date.now() }; write(db);
        s.consented = true; localStorage.setItem(PKEY, JSON.stringify(s)); },
      async saveSession(rec){
        const s = this.current(); if(!s) throw new Error("Not signed in.");
        const db = read(); if(db.sessions.some(x => x.id === rec.id)) return; db.sessions.push({ ...clone(rec), studyId: s.studyId }); write(db);
      },
      async listMySessions(){ const s = this.current(); return s ? clone(read().sessions.filter(x => x.studyId === s.studyId)) : []; },
    },

    demo: {
      async generate(){ const db = read(); const n = generateDemo(db); write(db); return n; },
      async clear(){ const db = read(), ids = new Set(Object.values(db.participants).filter(p=>p.demo).map(p=>p.studyId));
        for(const id of ids){ delete db.participants[id]; delete db.identities[id]; delete db.consents[id]; }
        db.assessments = db.assessments.filter(a => !ids.has(a.studyId)); db.sessions = db.sessions.filter(s => !ids.has(s.studyId)); write(db); return ids.size; },
      async wipeAll(){ localStorage.removeItem(KEY); localStorage.removeItem(PKEY); },
    },
  };
  return store;
}

// ── Demo data (clearly fictional; flagged so it can be removed without touching real records) ─────────
function rng(seed){ return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed>>>15, 1|seed); t = t + Math.imul(t ^ t>>>7, 61|t) ^ t; return ((t ^ t>>>14) >>> 0) / 4294967296; }; }
const GAMES = ["quad","slr","heel","tke","tempo","ham","bal"], DIFFS = ["gentle","steady","champion"];
const NAMES = ["Demo Patient A","Demo Patient B","Demo Patient C","Demo Patient D","Demo Patient E","Demo Patient F"];
function generateDemo(db){
  const R = rng(20260911), pick = a => a[Math.floor(R()*a.length)], day = 86400000, now = Date.now();
  // [weeks enrolled, sessions per week, drift to inactivity?, high pain?, baseline severity 0..1, KL, group]
  const profiles = [ [7,3,false,false,0.62,2,"Game-based"], [7,2,false,false,0.7,3,"Game-based"], [6,3,true,false,0.66,3,"Conventional"],
                     [5,2,false,true,0.78,3,"Game-based"], [1,2,false,false,0.6,2,"Conventional"], [6,3,false,false,0.55,2,"Game-based"] ];
  const created = [];
  profiles.forEach((pr, i) => {
    const [weeks, perWeek, fade, painful, sev0, kl, group] = pr;
    db.counter++; const studyId = formatStudyId(db.counter); created.push(studyId);
    const enrolled = now - weeks*7*day;
    db.participants[studyId] = { studyId, group, demo:true, accessCode: makeAccessCode(), enrolledAt: enrolled, demographics: {
      age: 48 + Math.floor(R()*22), gender: i%3===0 ? "Male" : "Female", residence: pick(["Lahore (urban)","Faisalabad (urban)","Sheikhupura (rural)","Multan (urban)"]),
      education: pick(["Primary","Matric / Secondary","Intermediate","Graduate"]), occupation: pick(["Housewife","Shopkeeper","Teacher","Retired","Farmer"]),
      marital: "Married", painDurationMonths: 10 + Math.floor(R()*70), klGrade: kl } };
    db.identities[studyId] = { studyId, name: NAMES[i], cnic: `00000-00000${String(i+1).padStart(2,"0")}-${(i%9)+1}` };
    db.consents[studyId] = { at: enrolled + 3600000, version: "demo", lang: i%2 ? "ur" : "en" };

    // game sessions: quality and ROM improve, pain eases; adherence per profile
    for(let w = 0; w < weeks; w++){
      const n = fade && w >= weeks-2 ? 0 : Math.max(0, perWeek - (R() < 0.25 ? 1 : 0));
      for(let k = 0; k < n; k++){
        const t = enrolled + w*7*day + (1 + k*2)*day + (8 + Math.floor(R()*10))*3600000;
        if(t > now) continue; const prog = w / Math.max(1, weeks-1), game = pick(GAMES), q = Math.round(52 + prog*28 + R()*14), flex = Math.round(78 + prog*22 + R()*6);
        const pb = Math.max(0, Math.round((painful ? 7 : 5) - prog*(painful?1:2.5) + R()*2)), pa = Math.max(0, pb + Math.round(R()*2 - 1.3));
        db.sessions.push({ id: uid(), schema:1, studyId, source:"demo", lang:"en", appVersion:"demo", type:"session", status: "completed", game, gameName: game, exercise:"", difficulty: pick(DIFFS),
          repsTarget:5, repsDone:5, completed:true, stars: q>=85?3:q>=60?2:1, score: 300+Math.round(q*4), qualityPct:q, durationSec: 150+Math.floor(R()*120), holdSecs: ["quad","slr","tke","bal"].includes(game)?5:null,
          paceMult: ["tempo","ham"].includes(game)?1:null, ghost: game==="tempo"?true:null, inputMode:"camera", extRefDeg:178, kneeAngleMinDeg: 178-flex, kneeAngleMaxDeg:178, peakFlexionDeg: game==="bal"?null:flex,
          balShiftMaxLeft: game==="bal"?0.5:null, balShiftMaxRight: game==="bal"?-0.5:null, painBefore:pb, painAfter:pa, startedAt:new Date(t).toISOString(), endedAt:new Date(t+240000).toISOString() });
      }
    }
    // assessments at the time points the participant has reached; severity eases with treatment
    const tps = [["Baseline",0],["Week 4",4],["Post-treatment",6]].filter(([,w]) => w <= weeks);
    tps.forEach(([tp, w]) => {
      const sev = Math.max(0.12, sev0 - (w/6)*0.32 + (R()-0.5)*0.05), items = (ids) => Object.fromEntries(ids.map(id => [id, Math.max(0, Math.min(4, Math.round(sev*4 + (R()-0.5)*1.6)))]));
      const womacItems = items(["A1","A2","A3","A4","A5","B1","B2",...Array.from({length:17},(_,k)=>"C"+(k+1))]), bbsItems = Object.fromEntries(Array.from({length:14},(_,k)=>["b"+(k+1), Math.max(0,Math.min(4,Math.round((1-sev)*4 + (R()-0.5)*1.2)))]));
      db.assessments.push(finalizeAssessment({ id: uid(), studyId, timepoint: tp, date: new Date(enrolled + w*7*day).toISOString().slice(0,10), createdAt: enrolled + w*7*day,
        womac:{ items: womacItems }, bbs:{ items: bbsItems }, tug:{ seconds: Math.round((8 + sev*12 + R()*1.5)*10)/10, device: sev>0.7?"Cane":"None" }, vas: Math.round(sev*88 + R()*6),
        rom:{ left:{ flexion: Math.round(135 - sev*40 + R()*4), extension: Math.round(sev*12) }, right:{ flexion: Math.round(132 - sev*38 + R()*4), extension: Math.round(sev*9) } }, notes: "" }));
    });
  });
  return created.length;
}
