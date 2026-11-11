// cloudstore.js — Firebase (Auth + Firestore) implementation of the study store. Same interface as
// localstore.js. Access control lives in cloud/firestore.rules — this file only talks to the database.
//
//   Researchers  : email + password; allowed only if researchers/{uid} exists (created in the Firebase console).
//   Participants : anonymous Firebase sign-in + a "link" document {studyId, code}. The rules accept the link
//                  only when the code matches the participant's access code, and re-check it on every access —
//                  so issuing a new code instantly signs old devices out.
//   Data         : participants/ (demographics, no names) · identities/ (name, CNIC; researchers only) ·
//                  assessments/ (researchers only) · sessions/ (written by the participant) · consents/ · meta/study.
import { DEFAULTS, formatStudyId, makeAccessCode, normalizeCode, prettyCode, normalizeCnic, finalizeAssessment, validateParticipant } from "./schema.js";

const FB_VERSION = "10.14.1", PKEY = "movelab_participant_v1";
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));

async function loadSdk(){
  const b = `https://www.gstatic.com/firebasejs/${FB_VERSION}/`;
  const [app, auth, fs] = await Promise.all([import(b + "firebase-app.js"), import(b + "firebase-auth.js"), import(b + "firebase-firestore.js")]);
  return { ...app, ...auth, ...fs };
}

export async function createCloudStore(cfg, injectedSdk){
  const sdk = injectedSdk || await loadSdk();
  const app = sdk.initializeApp(cfg), auth = sdk.getAuth(app);
  let db; try{ db = sdk.initializeFirestore(app, { localCache: sdk.persistentLocalCache({ tabManager: sdk.persistentMultipleTabManager() }) }); }catch(e){ db = sdk.getFirestore(app); }   // offline-first: writes queue on the phone and sync later
  const D = (c, id) => sdk.doc(db, c, id), C = c => sdk.collection(db, c);
  const snap = async ref => { const s = await sdk.getDoc(ref); return s.exists() ? s.data() : null; };
  const all = async (c, studyId) => { const q = studyId ? sdk.query(C(c), sdk.where("studyId", "==", studyId)) : C(c); const s = await sdk.getDocs(q); return s.docs.map(d => ({ ...d.data() })); };
  const readLocal = () => { try{ return JSON.parse(localStorage.getItem(PKEY)); }catch(e){ return null; } };
  const clone = o => JSON.parse(JSON.stringify(o));
  const nice = p => p && { ...p, accessCode: prettyCode(p.accessCode) };            // stored without the hyphen; shown as ABCD-EFGH

  let rUser = null;
  const isResearcher = async u => !!(u && !u.isAnonymous && await snap(D("researchers", u.uid)));
  const friendly = e => {
    const c = String((e && e.code) || "");
    if(/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c)) return new Error("Email or password is incorrect.");
    if(/network/.test(c)) return new Error("No internet connection.");
    return e;
  };

  const store = {
    mode: "cloud",

    researcher: {
      async signIn(email, password){
        let cred; try{ cred = await sdk.signInWithEmailAndPassword(auth, email, password); }catch(e){ throw friendly(e); }
        if(!(await isResearcher(cred.user))){ await sdk.signOut(auth); throw new Error("This account is not registered as a researcher."); }
        rUser = { email: cred.user.email, uid: cred.user.uid }; return rUser;
      },
      async signOut(){ rUser = null; await sdk.signOut(auth); },
      current(){ return rUser; },
      onChange(cb){ return sdk.onAuthStateChanged(auth, async u => { try{ rUser = (await isResearcher(u)) ? { email: u.email, uid: u.uid } : null; }catch(e){ rUser = null; } cb(rUser); }); },
    },

    async getSettings(){ const m = await snap(D("meta", "study")); return { ...clone(DEFAULTS), ...((m && m.settings) || {}) }; },
    async saveSettings(s){ const cur = await store.getSettings(), merged = { ...cur, ...s }; await sdk.setDoc(D("meta", "study"), { settings: merged }, { merge: true }); return merged; },

    async listParticipants(){
      const [ps, cs] = await Promise.all([all("participants"), all("consents")]); const consent = Object.fromEntries(cs.map(c => [c.studyId, c.at]));
      return ps.map(p => ({ ...nice(p), consentAt: consent[p.studyId] || null })).sort((a, b) => a.studyId.localeCompare(b.studyId));
    },
    async getParticipant(id){ const [p, c] = await Promise.all([snap(D("participants", id)), snap(D("consents", id))]); return p ? { ...nice(p), consentAt: (c && c.at) || null } : null; },

    async registerParticipant({ name, cnic, demographics, group }){
      const errs = validateParticipant({ name, cnic, demographics }); if(errs.length) throw new Error(errs.join(" "));
      const code = normalizeCode(makeAccessCode()), by = (auth.currentUser && auth.currentUser.uid) || null;
      const studyId = await sdk.runTransaction(db, async tx => {                                // sequential IDs, no duplicates even with two researchers
        const mref = D("meta", "study"), m = await tx.get(mref), n = ((m.exists() && m.data().counter) || 0) + 1, id = formatStudyId(n);
        tx.set(mref, { counter: n }, { merge: true });
        tx.set(D("participants", id), { studyId: id, group: group || null, demographics: clone(demographics), accessCode: code, enrolledAt: Date.now(), enrolledBy: by });
        tx.set(D("identities", id), { studyId: id, name: name.trim(), cnic: normalizeCnic(cnic) });
        return id;
      });
      return { studyId, accessCode: prettyCode(code) };
    },
    async updateParticipant(id, patch){ await sdk.updateDoc(D("participants", id), clone(patch)); },
    async resetAccessCode(id){ const code = normalizeCode(makeAccessCode()); await sdk.updateDoc(D("participants", id), { accessCode: code }); return prettyCode(code); },
    async getIdentity(id){ return await snap(D("identities", id)); },
    async listIdentities(){ return await all("identities"); },

    async saveAssessment(studyId, a){
      const rec = finalizeAssessment({ ...a, studyId }); rec.id = rec.id || uid(); rec.createdAt = rec.createdAt || Date.now(); rec.updatedAt = Date.now();
      Object.keys(rec).forEach(k => rec[k] === undefined && delete rec[k]);                        // Firestore rejects undefined
      await sdk.setDoc(D("assessments", rec.id), JSON.parse(JSON.stringify(rec))); return rec;
    },
    async listAssessments(studyId){ return await all("assessments", studyId); },
    async deleteAssessment(id){ await sdk.deleteDoc(D("assessments", id)); },
    async listSessions(studyId){ return await all("sessions", studyId); },

    participant: {
      async login(studyId, code){
        const id = String(studyId || "").trim().toUpperCase(), c = normalizeCode(code);
        const cur = auth.currentUser; if(cur && !cur.isAnonymous) throw new Error("A researcher is signed in on this browser. Use another browser, or sign out first.");
        if(!cur) await sdk.signInAnonymously(auth);
        try{ await sdk.setDoc(D("participantLinks", auth.currentUser.uid), { studyId: id, code: c, linkedAt: Date.now() }); }     // the rules check the code
        catch(e){ if(/permission|denied/i.test(String(e && (e.code || e.message)))) throw new Error("Study ID or access code not recognised."); throw friendly(e); }
        let consented = false; try{ consented = !!(await snap(D("consents", id))); }catch(e){}
        const prev = readLocal(); let dl = null; try{ dl = localStorage.getItem("movelab_lang"); }catch(e){}
        const sess = { studyId: id, lang: (prev && prev.lang) || dl || "en", consented, at: Date.now() };
        localStorage.setItem(PKEY, JSON.stringify(sess)); return sess;
      },
      current(){ return readLocal(); },
      async setLang(lang){ const s = readLocal(); if(s){ s.lang = lang; localStorage.setItem(PKEY, JSON.stringify(s)); } },
      async logout(){ localStorage.removeItem(PKEY); try{ await sdk.signOut(auth); }catch(e){} },
      async hasConsent(){ const s = readLocal(); return !!(s && s.consented); },
      async saveConsent(c){
        const s = readLocal(); if(!s) throw new Error("Not signed in.");
        await sdk.setDoc(D("consents", s.studyId), { studyId: s.studyId, version: c.version, lang: c.lang, at: Date.now() });
        s.consented = true; localStorage.setItem(PKEY, JSON.stringify(s));
      },
      async saveSession(rec){
        const s = readLocal(); if(!s) throw new Error("Not signed in.");
        const data = JSON.parse(JSON.stringify({ ...rec, studyId: s.studyId }));   // deterministic payload: a retry of the same record is byte-identical
        return sdk.setDoc(D("sessions", rec.id), data);            // idempotent: same id + same content = no-op (the rules allow an identical rewrite)
      },
      async listMySessions(){ const s = readLocal(); return s ? await all("sessions", s.studyId) : []; },
    },
  };
  return store;
}
