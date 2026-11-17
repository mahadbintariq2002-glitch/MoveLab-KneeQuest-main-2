// ptui.js — shared pieces of the patient / entry screens: the brand panel of the split sign-in layout and the language switch.
import { T, getLang } from "../okc/i18n.js";
import { icon } from "./icons.js";

export const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));

export const langSeg = () => `<div class="seg" role="group" aria-label="Language"><button data-l="en" class="${getLang() === "en" ? "on" : ""}">English</button><button data-l="ur" class="${getLang() === "ur" ? "on" : ""}">اردو</button></div>`;

export function brandPane(){
  const feat = (ic, t, s) => `<div class="bp-feat">${icon(ic, 20)}<div><b>${esc(T(t))}</b><span>${esc(T(s))}</span></div></div>`;
  return `<section class="brandpane"><div class="bp-logo"><span class="m">${icon("mark", 24)}</span>${esc(T("Virtual Therapy"))}</div>
    <div class="bp-copy"><h1>${esc(T("Knee rehabilitation, guided at home."))}</h1><p>${esc(T("Camera-guided exercise programmes for knee osteoarthritis, prescribed and followed by your physiotherapy team."))}</p>
      <div class="bp-feats">${feat("camera", "Camera-guided movement", "Your phone tracks the knee angle — no wearables needed.")}
        ${feat("clipboard", "Prescribed by your therapist", "Only the exercises chosen for you, at your level.")}
        ${feat("shield", "Private and secure", "Your sessions are shared only with your research team.")}</div></div>
    <div class="bp-foot">© ${new Date().getFullYear()} Virtual Therapy · ${esc(T("Knee OA rehabilitation study"))}</div></section>`;
}
