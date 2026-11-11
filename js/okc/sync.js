// sync.js — participant context + session hand-off.
//
// The games run in three situations:
//   1. Anonymous visitor on the public page  -> nothing is recorded, no research prompts (demo unchanged).
//   2. Participant signed in via participant.html (web)  -> sessions go to the study store (local or cloud).
//   3. Inside the Android app's WebView      -> sessions go to the app through "AndroidBridge":
//        getContext()        -> JSON string  {"studyId":"P001","lang":"ur"}
//        saveSession(json)   -> stores the session on the phone (Room) and syncs it to the cloud
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
    const st = stored(), signedIn = !!(st && st.studyId);
    const studyId = (c.studyId || (signedIn && st.consented ? st.studyId : null) || (q && q.get("pid")) || "").trim() || null;
    let dev = null; try{ dev = localStorage.getItem("movelab_lang"); }catch(e){}                 // the latest language chosen on this device
    const lang = (q && q.get("lang")) || c.lang || dev || (signedIn && st.lang) || null;      // URL > Android app > device choice > signed-in default
    return { studyId, lang, source: native() ? "android" : "web", needsConsent: !c.studyId && signedIn && !st.consented, viaStore: !c.studyId && signedIn && !!st.consented };
  },
  get active(){ return !!this.context().studyId; },

  // Deliver one session record. Returns "native" | "stored" | "queued" | "ignored".
  submit(session){
    const ctx = this.context();
    if(!ctx.studyId) return "ignored";
    const rec = { id: rid(), schema: 1, studyId: ctx.studyId, source: ctx.source, lang: ctx.lang || "en", appVersion: APP_VERSION, ...session };
    const b = native();
    if(b && b.saveSession){ try{ b.saveSession(JSON.stringify(rec)); return "native"; }catch(e){} }
    if(ctx.viaStore){                                           // signed-in participant on the web -> study store (retry from the outbox on failure)
      import("../study/store.js").then(m => m.getStore()).then(s => s.participant.saveSession(rec)).catch(() => this._queue(rec));
      return "stored";
    }
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
