// therapy.js — "Virtual Therapy" entry point (web and Android app). One question: patient or researcher?
// The choice is remembered on the device, so the next launch goes straight to that side; every page links
// back here with ?choose=1 ("Change role").
//   Patient    -> participant.html (Study ID + access code -> consent -> dashboard)
//   Researcher -> researcher.html  (email + password in cloud mode -> console)
import { getStore } from "./store.js";
import { T, setLang, initLang } from "../okc/i18n.js";
import { icon } from "./icons.js";
import { esc, langSeg, brandPane } from "./ptui.js";

const ROLE_KEY = "vt_role", PKEY = "movelab_participant_v1";
const $ = s => document.querySelector(s);
const get = k => { try{ return localStorage.getItem(k); }catch(e){ return null; } };
const set = (k, v) => { try{ localStorage.setItem(k, v); }catch(e){} };
const patientSignedIn = () => { try{ const s = JSON.parse(get(PKEY)); return !!(s && s.studyId); }catch(e){ return false; } };

const q = new URLSearchParams(location.search);
const remembered = get(ROLE_KEY);
if(!q.get("choose") && (remembered === "patient" || remembered === "researcher")){
  location.replace(remembered === "patient" ? "participant.html" : "researcher.html");
}else{
  initLang(q.get("lang"));
  render();
}

function render(){
  document.title = T("Virtual Therapy");
  $("#view").innerHTML = `<div class="auth-wrap">${brandPane()}
    <section class="formpane"><div class="topline">${langSeg()}</div><div class="inner">
      <h2>${esc(T("Welcome"))}</h2><p class="lead">${esc(T("Choose how you are using Virtual Therapy today."))}</p>
      <button class="choice" id="rPatient"><span class="ci">${icon("user", 24)}</span><span><b>${esc(T("I am a patient"))}</b><span>${esc(T("Sign in with your Study ID and play your exercise games."))}</span></span>${icon("chevron", 20, "chev")}</button>
      <button class="choice r" id="rResearcher"><span class="ci">${icon("steth", 24)}</span><span><b>${esc(T("I am a researcher"))}</b><span>${esc(T("Register patients, record assessments and follow their progress."))}</span></span>${icon("chevron", 20, "chev")}</button>
      <p class="note-sm">${icon("lock", 14)} ${esc(T("Your data is protected and only visible to your research team."))}</p>
    </div></section></div>`;
  document.querySelectorAll(".seg button").forEach(b => b.onclick = () => { setLang(b.dataset.l); render(); });
  $("#rPatient").onclick = () => choose("patient");
  $("#rResearcher").onclick = () => choose("researcher");
}

async function choose(role){
  document.querySelectorAll(".choice").forEach(b => b.disabled = true);
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
