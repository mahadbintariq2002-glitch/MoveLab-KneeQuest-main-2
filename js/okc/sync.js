// sync.js — participant context + session hand-off.
//
// The games run in three situations:
//   1. Anonymous visitor on the public page  -> nothing is recorded, no research prompts (demo unchanged).
//   2. Participant signed in via participant.html (web)  -> sessions go to the study store (local or cloud).
//   3. Inside the Android app's WebView      -> same as (2), plus a safety copy through "AndroidBridge":
//        getContext()        -> JSON string  {"app":"patient","preview":false,"publicBase":"https://…/"}  (studyId only if the app owns sign-in)
//        saveSession(json)   -> stores the session in the phone's SQLite database
//        saveFile(name, mime, text) / shareText(title, text) -> researcher app: CSV export + access-code sharing
//        setLang(lang)       -> remembers the chosen language
//   Testing shortcut: okc.html?pid=P001&lang=ur records to a local outbox without signing in.
//
// Records carry the study ID only — never a name or CNIC.
const OUTBOX_KEY = "movelab_outbox_v1", PKEY = "movelab_participant_v1";
export const APP_VERSION = "okc-1.1";

const native = () => (typeof window !== "undefined" && window.AndroidBridge) || null;
const rid = () => (crypto.randomUUID ? crypto.randomUUID() : "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
const stored = () => { try{ return JSON.parse(localStorage.getItem(PKEY)); }catch(e){ return null; } };

export const Sync = {
  // Re-read each call so a bridge attached after page load is still honoured.
  context(){
    let c = {};
    try{ const b = native(); if(b && b.getContext) c = JSON.parse(b.getContext() || "{}"); }catch(e){}
    let q = null; try{ q = new URLSearchParams(location.search); }catch(e){}
    const demo = !!(q && q.get("demo"));                                   // researcher's "Preview games": never recorded
    const st = demo ? null : stored(), signedIn = !!(st && st.studyId);
    if(demo) c = {};
    const studyId = (c.studyId || (signedIn && st.consented ? st.studyId : null) || (q && q.get("pid")) || "").trim() || null;
    let dev = null; try{ dev = localStorage.getItem("movelab_lang"); }catch(e){}                 // the latest language chosen on this device
    const lang = (q && q.get("lang")) || c.lang || dev || (signedIn && st.lang) || null;      // URL > Android app > device choice > signed-in default
    const games = (signedIn && Array.isArray(st.games) && st.games.length) ? st.games : null;   // researcher's prescription (null = all games)
    return { studyId, lang, games, source: native() ? "android" : "web", preview: !!c.preview, needsConsent: !c.studyId && signedIn && !st.consented, viaStore: !c.studyId && signedIn && !!st.consented };
  },
  get active(){ return !!this.context().studyId; },

  // Deliver one session record. Returns "native" | "stored" | "queued" | "ignored".
  submit(session){
    const ctx = this.context();
    if(!ctx.studyId) return "ignored";
    const rec = { id: rid(), schema: 1, studyId: ctx.studyId, source: ctx.source, lang: ctx.lang || "en", appVersion: APP_VERSION, ...session };
    const b = native(); let kept = false;
    // Inside the app every session is first written to the phone's own database (a safety copy that survives
    // sign-out/reinstall of the web layer); the study store below stays the route to the researcher.
    if(b && b.saveSession){ try{ b.saveSession(JSON.stringify(rec)); kept = true; }catch(e){} }
    if(ctx.viaStore){                                          // signed-in participant on the web -> study store (retry from the outbox on failure)
      import("../study/store.js").then(m => m.getStore()).then(s => s.participant.saveSession(rec)).catch(() => this._queue(rec));
      return "stored";
    }
    if(kept) return "native";
    this._queue(rec); return "queued";
  },
  _queue(rec){ try{ const q = this.outbox(); q.push(rec); localStorage.setItem(OUTBOX_KEY, JSON.stringify(q)); }catch(e){} },
  outbox(){ try{ return JSON.parse(localStorage.getItem(OUTBOX_KEY)) || []; }catch(e){ return []; } },
  clearOutbox(){ try{ localStorage.removeItem(OUTBOX_KEY); }catch(e){} },
  // Re-send anything that failed earlier (call when the participant is signed in and online).
  async flush(){
    const q = this.outbox(); if(!q.length || !this.context().viaStore) return 0;
    const s = await (await import("../study/store.js")).getStore(); let n = 0, rest = [];
    for(const r of q){ try{ await s.participant.saveSession(r); n++; }catch(e){ rest.push(r); } }
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(rest)); return n;
  },
};

// Pain advisory thresholds on the 0–10 scale. Placeholders for clinical sign-off by the supervisor.
export const PAIN = { adviseBefore: 7, adviseAfter: 7 };
