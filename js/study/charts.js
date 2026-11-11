// charts.js — tiny dependency-free canvas charts (line + bar) for the researcher dashboard.
export const COLORS = ["#0f6cbd", "#e65100", "#2e7d32", "#7b1fa2", "#00838f", "#c62828"];

function setup(canvas, h){
  const w = Math.max(240, Math.floor((canvas.parentElement ? canvas.parentElement.clientWidth : 320) - 2)), dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.height = h + "px";
  const g = canvas.getContext("2d"); g.setTransform(dpr,0,0,dpr,0,0); g.clearRect(0,0,w,h); return { g, w, h };
}
function frame(g, w, h, lo, hi, unit, pad){
  g.font = "11px system-ui,sans-serif"; g.fillStyle = "#64748b"; g.strokeStyle = "#e5ebf3"; g.lineWidth = 1; g.textAlign = "right";
  for(let i = 0; i <= 4; i++){ const v = lo + (hi-lo)*i/4, y = pad.t + (h-pad.t-pad.b)*(1 - i/4); g.beginPath(); g.moveTo(pad.l, y); g.lineTo(w-pad.r, y); g.stroke(); g.fillText((Math.round(v*10)/10)+unit, pad.l-5, y+4); }
}
const nice = (lo, hi) => { if(lo === hi){ lo -= 1; hi += 1; } const span = hi - lo, step = Math.pow(10, Math.floor(Math.log10(span))); return [Math.floor((lo-span*0.08)/step)*step, Math.ceil((hi+span*0.08)/step)*step]; };

// series: [{label, color?, data:[number|null ...]}] aligned to labels
export function lineChart(canvas, { labels, series, height = 190, unit = "", min = null, max = null, ref = null }){
  const { g, w, h } = setup(canvas, height), pad = { l: 40, r: 12, t: series.length > 1 ? 26 : 14, b: 30 };
  const vals = series.flatMap(s => s.data).filter(v => v != null && !Number.isNaN(v));
  if(!vals.length){ g.fillStyle = "#94a3b8"; g.font = "13px system-ui,sans-serif"; g.textAlign = "center"; g.fillText("No data yet", w/2, h/2); return; }
  let [lo, hi] = nice(Math.min(...vals, ref ?? Infinity), Math.max(...vals, ref ?? -Infinity)); if(min != null) lo = min; if(max != null) hi = max;
  frame(g, w, h, lo, hi, unit, pad);
  const X = i => labels.length === 1 ? (pad.l + w - pad.r)/2 : pad.l + (w-pad.l-pad.r) * i/(labels.length-1), Y = v => pad.t + (h-pad.t-pad.b) * (1 - (v-lo)/(hi-lo));
  g.textAlign = "center"; g.fillStyle = "#64748b"; labels.forEach((l, i) => { const t = String(l); g.fillText(t.length > 11 ? t.slice(0,10)+"…" : t, X(i), h-10); });
  if(ref != null){ g.setLineDash([5,4]); g.strokeStyle = "#94a3b8"; g.beginPath(); g.moveTo(pad.l, Y(ref)); g.lineTo(w-pad.r, Y(ref)); g.stroke(); g.setLineDash([]); }
  series.forEach((s, si) => {
    const c = s.color || COLORS[si % COLORS.length]; g.strokeStyle = c; g.fillStyle = c; g.lineWidth = 2.2; g.beginPath(); let pen = false;
    s.data.forEach((v, i) => { if(v == null){ pen = false; return; } if(!pen){ g.moveTo(X(i), Y(v)); pen = true; } else g.lineTo(X(i), Y(v)); }); g.stroke();
    s.data.forEach((v, i) => { if(v == null) return; g.beginPath(); g.arc(X(i), Y(v), 3.6, 0, 7); g.fill(); });
    if(series.length > 1){ g.font = "12px system-ui,sans-serif"; g.textAlign = "left"; const lx = pad.l + si*110; g.fillRect(lx, 7, 12, 4); g.fillStyle = "#1d2733"; g.fillText(s.label, lx+16, 13); }
  });
}
export function barChart(canvas, { labels, values, height = 170, color = COLORS[0], ref = null }){
  const { g, w, h } = setup(canvas, height), pad = { l: 34, r: 12, t: 14, b: 30 };
  const hi = Math.max(1, ...values, ref ?? 0); const top = Math.ceil(hi * 1.15); frame(g, w, h, 0, top, "", pad);
  const slot = (w-pad.l-pad.r) / values.length, bw = Math.min(34, slot*0.62), Y = v => pad.t + (h-pad.t-pad.b) * (1 - v/top);
  values.forEach((v, i) => { const x = pad.l + slot*i + (slot-bw)/2; g.fillStyle = color; g.fillRect(x, Y(v), bw, (h-pad.b) - Y(v)); g.fillStyle = "#1d2733"; g.font = "11px system-ui,sans-serif"; g.textAlign = "center"; if(v) g.fillText(v, x+bw/2, Y(v)-4); g.fillStyle = "#64748b"; g.fillText(labels[i], x+bw/2, h-10); });
  if(ref != null){ g.setLineDash([5,4]); g.strokeStyle = "#c62828"; g.beginPath(); g.moveTo(pad.l, Y(ref)); g.lineTo(w-pad.r, Y(ref)); g.stroke(); g.setLineDash([]); }
}
