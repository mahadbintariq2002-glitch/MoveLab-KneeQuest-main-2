// therapy.js — "Virtual Therapy" entry point (web and Android app). One question: patient or researcher?
// The choice is remembered on the device, so the next launch goes straight to that side; every page links
// back here with ?choose=1 ("Change role").
//   Patient    -> participant.html (Study ID + access code -> consent -> assigned games)
//   Researcher -> researcher.html  (email + password in cloud mode -> dashboard)
import { getStore } from "./store.js";
import { T, setLang, getLang, initLang } from "../okc/i18n.js";

const ROLE_KEY = "vt_role", PKEY = "movelab_participant_v1";
const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const get = k => { try{ return localStorage.getItem(k); }catch(e){ return null; } };
const set = (k, v) => { try{ localStorage.setItem(k, v); }catch(e){} };
const patientSignedIn = () => { try{ const s = JSON.parse(get(PKEY)); return !!(s && s.studyId); }catch(e){ return false; } };

const q = new URLSearchParams(location.search);
const remembered = get(ROLE_KEY);
if(!q.get("choose") && (remembered === "patient" || remembered === "researcher")){
  location.replace(remembered === "patient" ? "participant.html" : "researcher.html");
}else{
  initLang(q.get("lang"));
  document.querySelectorAll(".langbar button").forEach(b => b.onclick = () => { setLang(b.dataset.l); render(); });
  render();
}

function render(){
  document.querySelectorAll(".langbar button").forEach(b => b.classList.toggle("on", b.dataset.l === getLang()));
  document.title = T("Virtual Therapy");
  $("#view").innerHTML = `<div class="pcard" style="text-align:center">
      <div class="vt-logo">🦵</div><h1 class="vt-title">${esc(T("Virtual Therapy"))}</h1>
      <p class="muted">${esc(T("Knee exercise games, guided by your phone's camera."))}</p>
      <h2 style="margin-top:18px">${esc(T("Who is using the app?"))}</h2>
      <div id="err"></div>
      <button class="rolebtn" id="rPatient"><span class="ri">🧑‍🦳</span><span><b>${esc(T("Patient"))}</b><small>${esc(T("Sign in with your Study ID and play your exercise games."))}</small></span></button>
      <button class="rolebtn" id="rResearcher"><span class="ri">🩺</span><span><b>${esc(T("Researcher"))}</b><small>${esc(T("Register patients, record assessments and follow their progress."))}</small></span></button>
    </div>`;
  $("#rPatient").onclick = () => choose("patient");
  $("#rResearcher").onclick = () => choose("researcher");
}

async function choose(role){
  document.querySelectorAll(".rolebtn").forEach(b => b.disabled = true);
  try{
    const store = await getStore();
    // In cloud mode one phone holds one Firebase sign-in at a time, so switching role signs the other side out.
    if(store.mode === "cloud"){
      if(role === "researcher" && patientSignedIn()){
        if(!confirm(T("This will sign the patient out on this phone. Continue?"))){ render(); return; }
        await store.participant.logout();
      }
      if(role === "patient" && await researcherSignedIn(store)) await store.researcher.signOut();
    }
  }catch(e){ /* offline or no cloud yet: the next page shows its own message */ }
  set(ROLE_KEY, role);
  location.href = role === "patient" ? "participant.html" : "researcher.html";
}

function researcherSignedIn(store){
  return new Promise(res => { let done = false, un = null;
    un = store.researcher.onChange(u => { if(done) return; done = true; res(!!u); setTimeout(() => { try{ un && un(); }catch(e){} }, 0); });
    setTimeout(() => { if(!done){ done = true; res(false); } }, 4000); });
}
