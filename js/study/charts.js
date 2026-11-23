// charts.js — tiny dependency-free canvas charts (line + bar) for the researcher console. Virtual Therapy palette:
// teal first, then coral, navy, amber, violet, sky. Lines get a soft gradient fill; bars are rounded.
export const COLORS = ["#14B8A6", "#FF7A59", "#1E4A73", "#F59E0B", "#8B5CF6", "#0EA5E9"];
const FONT = '600 11px "Plus Jakarta Sans",system-ui,sans-serif';
let INK = "#0F1F2E", MUTED = "#7B8A9A", GRID = "#EDF2F7", EMPTY = "#A0AEC0", DOT = "#fff";
// Patient app uses a dark theme: light text, faint grid, dark dot centres.
export function setChartTheme(theme){ if(theme === "dark"){ INK = "#E7F2EC"; MUTED = "#8FA39A"; GRID = "rgba(255,255,255,.07)"; EMPTY = "#6F837A"; DOT = "#0E1513"; } }

function setup(canvas, h){
  const w = Math.max(240, Math.floor((canvas.parentElement ? canvas.parentElement.clientWidth : 320) - 2)), dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.height = h + "px";
  const g = canvas.getContext("2d"); g.setTransform(dpr,0,0,dpr,0,0); g.clearRect(0,0,w,h); return { g, w, h };
}
function frame(g, w, h, lo, hi, unit, pad){
  g.font = FONT; g.fillStyle = MUTED; g.strokeStyle = GRID; g.lineWidth = 1; g.textAlign = "right";
  for(let i = 0; i <= 4; i++){ const v = lo + (hi-lo)*i/4, y = Math.round(pad.t + (h-pad.t-pad.b)*(1 - i/4)) + .5; g.beginPath(); g.moveTo(pad.l, y); g.lineTo(w-pad.r, y); g.stroke(); g.fillText((Math.round(v*10)/10)+unit, pad.l-7, y+4); }
}
const nice = (lo, hi) => { if(lo === hi){ lo -= 1; hi += 1; } const span = hi - lo, step = Math.pow(10, Math.floor(Math.log10(span))); return [Math.floor((lo-span*0.08)/step)*step, Math.ceil((hi+span*0.08)/step)*step]; };
const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`; };
function empty(g, w, h){ g.fillStyle = EMPTY; g.font = '600 13px "Plus Jakarta Sans",system-ui,sans-serif'; g.textAlign = "center"; g.fillText("No data yet", w/2, h/2); }

// series: [{label, color?, data:[number|null ...]}] aligned to labels
export function lineChart(canvas, { labels, series, height = 200, unit = "", min = null, max = null, ref = null }){
  const { g, w, h } = setup(canvas, height), pad = { l: 42, r: 14, t: series.length > 1 ? 30 : 14, b: 30 };
  const vals = series.flatMap(s => s.data).filter(v => v != null && !Number.isNaN(v));
  if(!vals.length) return empty(g, w, h);
  let [lo, hi] = nice(Math.min(...vals, ref ?? Infinity), Math.max(...vals, ref ?? -Infinity)); if(min != null) lo = min; if(max != null) hi = max;
  frame(g, w, h, lo, hi, unit, pad);
  const X = i => labels.length === 1 ? (pad.l + w - pad.r)/2 : pad.l + (w-pad.l-pad.r) * i/(labels.length-1), Y = v => pad.t + (h-pad.t-pad.b) * (1 - (v-lo)/(hi-lo));
  g.textAlign = "center"; g.fillStyle = MUTED; const every = Math.ceil(labels.length / Math.max(1, Math.floor((w-pad.l-pad.r)/64)));
  labels.forEach((l, i) => { if(i % every) return; const t = String(l); g.fillText(t.length > 11 ? t.slice(0,10)+"…" : t, X(i), h-10); });
  if(ref != null){ g.setLineDash([5,4]); g.strokeStyle = "#A0AEC0"; g.beginPath(); g.moveTo(pad.l, Y(ref)); g.lineTo(w-pad.r, Y(ref)); g.stroke(); g.setLineDash([]); }
  series.forEach((s, si) => {
    const c = s.color || COLORS[si % COLORS.length], pts = s.data.map((v, i) => v == null ? null : [X(i), Y(v)]);
    // soft fill under the first series
    const run = pts.filter(Boolean);
    if(si === 0 && run.length > 1){ const grd = g.createLinearGradient(0, pad.t, 0, h-pad.b); grd.addColorStop(0, hexA(c, .22)); grd.addColorStop(1, hexA(c, 0));
      g.beginPath(); g.moveTo(run[0][0], h-pad.b); run.forEach(p => g.lineTo(p[0], p[1])); g.lineTo(run[run.length-1][0], h-pad.b); g.closePath(); g.fillStyle = grd; g.fill(); }
    g.strokeStyle = c; g.lineWidth = 2.6; g.lineJoin = "round"; g.lineCap = "round"; g.beginPath(); let pen = false;
    pts.forEach(p => { if(!p){ pen = false; return; } if(!pen){ g.moveTo(p[0], p[1]); pen = true; } else g.lineTo(p[0], p[1]); }); g.stroke();
    pts.forEach(p => { if(!p) return; g.beginPath(); g.arc(p[0], p[1], 4.2, 0, 7); g.fillStyle = DOT; g.fill(); g.lineWidth = 2.4; g.strokeStyle = c; g.stroke(); });
    if(series.length > 1){ g.font = '700 12px "Plus Jakarta Sans",system-ui,sans-serif'; g.textAlign = "left"; const lx = pad.l + si*110; g.fillStyle = c; g.beginPath(); g.arc(lx+5, 11, 5, 0, 7); g.fill(); g.fillStyle = INK; g.fillText(s.label, lx+15, 15); }
  });
}
export function barChart(canvas, { labels, values, height = 190, color = COLORS[0], ref = null }){
  const { g, w, h } = setup(canvas, height), pad = { l: 34, r: 14, t: 18, b: 30 };
  const hi = Math.max(1, ...values, ref ?? 0); const top = Math.ceil(hi * 1.2); frame(g, w, h, 0, top, "", pad);
  const slot = (w-pad.l-pad.r) / values.length, bw = Math.min(30, slot*0.58), Y = v => pad.t + (h-pad.t-pad.b) * (1 - v/top), every = Math.max(1, Math.ceil(50 / slot));
  values.forEach((v, i) => { const x = pad.l + slot*i + (slot-bw)/2, y = Y(v), bh = (h-pad.b) - y;
    if(v){ const grd = g.createLinearGradient(0, y, 0, h-pad.b); grd.addColorStop(0, color); grd.addColorStop(1, hexA(color, .55)); g.fillStyle = grd;
      const r = Math.min(8, bw/2, bh); g.beginPath(); g.moveTo(x, h-pad.b); g.lineTo(x, y+r); g.quadraticCurveTo(x, y, x+r, y); g.lineTo(x+bw-r, y); g.quadraticCurveTo(x+bw, y, x+bw, y+r); g.lineTo(x+bw, h-pad.b); g.closePath(); g.fill();
      g.fillStyle = INK; g.font = '800 11px "Plus Jakarta Sans",system-ui,sans-serif'; g.textAlign = "center"; g.fillText(v, x+bw/2, y-5); }
    if((values.length - 1 - i) % every === 0){ g.fillStyle = MUTED; g.font = FONT; g.textAlign = "center"; g.fillText(labels[i], x+bw/2, h-10); } });
  if(ref != null){ g.setLineDash([5,4]); g.strokeStyle = "#FF7A59"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(pad.l, Y(ref)); g.lineTo(w-pad.r, Y(ref)); g.stroke(); g.setLineDash([]); }
}
// SVG progress ring (returns markup). value 0..1
export function ring(value, { size = 92, stroke = 10, color = "#14B8A6", track = "#E6EEF3", label = "", sub = "" } = {}){
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, v = Math.max(0, Math.min(1, value || 0));
  return `<div class="ring" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}"><circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${track}" stroke-width="${stroke}"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c*(1-v)}" style="transition:stroke-dashoffset .8s"/></svg>
    <div class="lbl"><b>${label}</b><span>${sub}</span></div></div>`;
}

// Tiny inline SVG sparkline (no axes) for compact cards. values: number|null[]
export function sparkline(values, { w = 96, h = 30, color = "#4ADE80" } = {}){
  const v = values.filter(x => x != null && !Number.isNaN(x)); if(v.length < 2) return `<svg width="${w}" height="${h}" aria-hidden="true"></svg>`;
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1, pad = 3;
  const pts = v.map((x, i) => [pad + (w - 2 * pad) * i / (v.length - 1), h - pad - (h - 2 * pad) * (x - lo) / span]);
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" "), last = pts[pts.length - 1];
  const id = "sg" + Math.random().toString(36).slice(2, 8);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${d} L${last[0].toFixed(1)} ${h} L${pts[0][0].toFixed(1)} ${h} Z" fill="url(#${id})"/><path d="${d}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.6" fill="${color}"/></svg>`;
}
// Mini vertical bars (e.g. pain per session), last bar highlighted. values 0..max
export function miniBars(values, { w = 92, h = 34, max = 10, color = "#4ADE80" } = {}){
  const v = values.slice(-7); if(!v.length) return "";
  const bw = Math.max(4, Math.min(8, (w - (v.length - 1) * 5) / v.length)), gap = (w - v.length * bw) / Math.max(1, v.length - 1);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${v.map((x, i) => { const bh = Math.max(3, (h - 2) * Math.min(1, (x || 0) / max)), last = i === v.length - 1;
    return `<rect x="${(i * (bw + gap)).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${bw}" height="${bh.toFixed(1)}" rx="${bw / 2}" fill="${color}" opacity="${last ? 1 : .35}"/>`; }).join("")}</svg>`;
}
