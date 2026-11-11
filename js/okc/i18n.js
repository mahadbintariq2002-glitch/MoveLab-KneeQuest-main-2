// i18n.js — English / Urdu for everything a participant sees. English text IS the key:
//   T("Hold it steady…")                       -> Urdu when LANG === "ur", else unchanged
//   T("Your pain is {n}/10 today.", { n: 8 })  -> {placeholders} are filled after lookup
// Text the games build themselves (cue banners, canvas labels, many with numbers) goes through TX():
// exact entries first, then regex patterns from lang-ur.js. A missing translation falls back to
// English, so nothing ever renders blank.
import UR from "./lang-ur.js";

const KEY = "movelab_lang";
let LANG = "en";
export const getLang = () => LANG;
export const isRtl = () => LANG === "ur";

export function setLang(l){
  LANG = l === "ur" ? "ur" : "en";
  try{ localStorage.setItem(KEY, LANG); }catch(e){}
  if(typeof document !== "undefined"){ document.documentElement.lang = LANG; document.documentElement.dir = LANG === "ur" ? "rtl" : "ltr"; }
  return LANG;
}
// Starting language: explicit preference, else the device's saved choice, else English.
export function initLang(pref){
  let l = pref;
  if(!l){ try{ l = localStorage.getItem(KEY); }catch(e){} }
  return setLang(l === "ur" ? "ur" : "en");
}

// Translate one string (no placeholders).
export function TX(s){
  if(LANG !== "ur" || typeof s !== "string" || !s) return s;
  const hit = UR.exact[s]; if(hit != null) return hit;
  for(const [re, fn] of UR.patterns){ const m = re.exec(s); if(m) return fn(m); }
  return s;
}
export function T(s, vars){
  let out = TX(s);
  if(vars) out = out.replace(/\{(\w+)\}/g, (m, k) => vars[k] != null ? vars[k] : m);
  return out;
}

// Static markup: data-t (text), data-th (html), data-ph (placeholder) — original English is kept in data-en.
export function applyDom(root = document){
  root.querySelectorAll("[data-t]").forEach(el => { if(el.dataset.en == null) el.dataset.en = el.textContent.trim(); el.textContent = T(el.dataset.en); });
  root.querySelectorAll("[data-th]").forEach(el => { if(el.dataset.en == null) el.dataset.en = el.innerHTML.trim(); el.innerHTML = T(el.dataset.en); });
  root.querySelectorAll("[data-ph]").forEach(el => { if(el.dataset.enph == null) el.dataset.enph = el.getAttribute("placeholder") || ""; el.setAttribute("placeholder", T(el.dataset.enph)); });
}

// Canvas text (cues, labels, readouts) is drawn by the games in English; translate it as it is drawn.
export function patchCanvas(ctx){
  if(!ctx || ctx.__i18n) return; ctx.__i18n = true;
  const f = ctx.fillText.bind(ctx), s = ctx.strokeText.bind(ctx);
  ctx.fillText = (t, ...a) => f(TX(t), ...a); ctx.strokeText = (t, ...a) => s(TX(t), ...a);
}

// Speech: Urdu only when the device actually has an Urdu voice (otherwise stay silent rather than mispronounce).
export const speechLang = () => LANG === "ur" ? "ur-PK" : "en-US";
export function canSpeakCurrent(){
  if(LANG !== "ur") return true;
  try{ return speechSynthesis.getVoices().some(v => /^ur/i.test(v.lang)); }catch(e){ return false; }
}
