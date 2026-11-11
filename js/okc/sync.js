// sync.js — patient context + session hand-off.
//
// The games run in two places: the public web page (anonymous demo) and inside the Android
// app's WebView (a logged-in study participant). This module is the only seam between them.
//
//   Android app exposes a JavaScript interface named "AndroidBridge":
//     getContext()        -> JSON string  {"studyId":"P001","lang":"ur"}
//     saveSession(json)   -> stores the session on the phone (Room) and syncs it to the cloud
//   Web testing: open okc.html?pid=P001&lang=ur  (records go to a local outbox, not the cloud).
//
// No study ID = anonymous visitor = nothing is recorded and no research prompts are shown,
// so the public demo is unchanged. Records carry the study ID only — never a name or CNIC.
const OUTBOX_KEY = "movelab_outbox_v1";
export const APP_VERSION = "okc-1.0";

const native = () => (typeof window !== "undefined" && window.AndroidBridge) || null;
const rid = () => (crypto.randomUUID ? crypto.randomUUID() : "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));

export const Sync = {
  // Re-read each call so a bridge attached after page load is still honoured.
  context(){
    let c = {};
    try{ const b = native(); if(b && b.getContext) c = JSON.parse(b.getContext() || "{}"); }catch(e){}
    let q = null; try{ q = new URLSearchParams(location.search); }catch(e){}
    const studyId = (c.studyId || (q && q.get("pid")) || "").trim() || null;
    const lang = c.lang || (q && q.get("lang")) || "en";
    return { studyId, lang, source: native() ? "android" : "web" };
  },
  get active(){ return !!this.context().studyId; },

  // Deliver one session record. Returns "native" | "queued" | "ignored".
  submit(session){
    const ctx = this.context();
    if(!ctx.studyId) return "ignored";
    const rec = { id: rid(), schema: 1, studyId: ctx.studyId, source: ctx.source, lang: ctx.lang, appVersion: APP_VERSION, ...session };
    const b = native();
    if(b && b.saveSession){ try{ b.saveSession(JSON.stringify(rec)); return "native"; }catch(e){} }
    try{ const q = this.outbox(); q.push(rec); localStorage.setItem(OUTBOX_KEY, JSON.stringify(q)); }catch(e){}
    return "queued";
  },
  outbox(){ try{ return JSON.parse(localStorage.getItem(OUTBOX_KEY)) || []; }catch(e){ return []; } },
  clearOutbox(){ try{ localStorage.removeItem(OUTBOX_KEY); }catch(e){} },
};

// Pain advisory thresholds on the 0–10 scale. Placeholders for clinical sign-off by the supervisor.
export const PAIN = { adviseBefore: 7, adviseAfter: 7 };
