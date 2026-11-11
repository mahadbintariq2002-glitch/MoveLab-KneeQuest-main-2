// participant.js — participant sign-in (study ID + access code), consent and safety notice, then the games.
import { getStore } from "./store.js";
import { T, setLang, getLang, initLang } from "../okc/i18n.js";
import { normalizeCode } from "./schema.js";

const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const CONSENT_VERSION = "draft-1";     // bump when the approved wording changes
let store;

(async function boot(){
  store = await getStore();
  const q = new URLSearchParams(location.search);
  if(q.get("signout")){ await store.participant.logout(); history.replaceState(null, "", location.pathname); }
  const cur = store.participant.current();
  initLang(q.get("lang") || (cur && cur.lang));
  document.querySelectorAll(".langbar button").forEach(b => b.onclick = async () => { setLang(b.dataset.l); if(store.participant.setLang) await store.participant.setLang(b.dataset.l); render(); });
  render();
})();

function chrome(){
  document.querySelectorAll(".langbar button").forEach(b => b.classList.toggle("on", b.dataset.l === getLang()));
  $("#rlink").textContent = T("Researcher sign-in");
}
function render(){
  chrome();
  const cur = store.participant.current();
  if(!cur) return viewLogin();
  if(!cur.consented) return viewConsent(cur);
  return viewReady(cur);
}

const demoNote = () => store.mode === "local" ? `<p class="muted small" style="margin-top:14px">${esc(T("Demo mode: your data stays on this device."))}</p>` : "";

function viewLogin(){
  $("#view").innerHTML = `<div class="pcard"><h1 style="text-align:center">🦵 ${esc(T("MoveLab exercise study"))}</h1>
    <p class="muted" style="text-align:center">${esc(T("Enter the Study ID and access code your therapist gave you."))}</p><div id="err"></div>
    <form id="f"><div class="field"><label>${esc(T("Study ID"))}</label><input id="sid" placeholder="P001" autocomplete="username" autocapitalize="characters" required></div>
    <div class="field"><label>${esc(T("Access code"))}</label><input id="code" placeholder="ABCD-EFGH" autocomplete="current-password" autocapitalize="characters" required></div>
    <button class="btn">${esc(T("Sign in"))}</button></form>${demoNote()}</div>`;
  $("#f").onsubmit = async e => { e.preventDefault(); $("#err").innerHTML = ""; const btn = $("#f button"); btn.disabled = true;
    try{ await store.participant.login($("#sid").value.trim(), normalizeCode($("#code").value)); render(); }
    catch(err){ btn.disabled = false; $("#err").innerHTML = `<div class="err">${esc(T(err.message))}</div>`; } };
}

function viewConsent(cur){
  const pts = ["This is a research study about exercise games for people with knee osteoarthritis.",
    "Taking part is voluntary. You can stop at any time without any effect on your treatment.",
    "The app records your exercise sessions (which game, when, your score, and your knee movement as estimated by the camera) and your pain ratings. It uses your Study ID — not your name.",
    "The camera is used on your phone to follow your movement. Video is not recorded or sent anywhere.",
    "Stop exercising and tell your therapist if you feel sharp or severe pain, dizziness, or feel unsafe.",
    "Keep a sturdy chair or counter within reach, especially for the balance game."];
  $("#view").innerHTML = `<div class="pcard"><h1 style="text-align:center">${esc(T("Before you start"))}</h1><p class="muted" style="text-align:center">${esc(T("Study ID"))}: <b>${esc(cur.studyId)}</b></p>
    <div class="consentbox"><ul style="margin:0;padding-inline-start:20px">${pts.map(p => `<li style="margin-bottom:8px">${esc(T(p))}</li>`).join("")}</ul></div>
    <label style="display:flex;gap:10px;align-items:flex-start;font-size:15px;font-weight:600"><input type="checkbox" id="ok" style="width:22px;height:22px;margin-top:2px"> <span>${esc(T("I have read this and agree to take part."))}</span></label>
    <button class="btn" id="go" disabled style="margin-top:14px">${esc(T("Continue"))}</button>
    <p style="text-align:center;margin-top:10px"><a href="?signout=1">${esc(T("Not you? Sign out"))}</a></p></div>`;
  $("#ok").onchange = e => $("#go").disabled = !e.target.checked;
  $("#go").onclick = async () => { await store.participant.saveConsent({ version: CONSENT_VERSION, lang: getLang() }); render(); };
}

function viewReady(cur){
  $("#view").innerHTML = `<div class="pcard" style="text-align:center"><h1>${esc(T("Welcome"))}</h1><p class="muted" style="font-size:18px">${esc(T("Study ID"))}: <b>${esc(cur.studyId)}</b></p>
    <p>${esc(T("Do your exercises with the camera on, and tell us honestly how your knee feels."))}</p><a class="btn" href="okc.html">${esc(T("Start exercises"))}</a>
    <p style="margin-top:14px"><a href="?signout=1">${esc(T("Sign out"))}</a></p>${demoNote()}</div>`;
}
