// kneeart.js — stylised anatomical knee (front view: femur, patella, tibia, fibula, glowing cartilage line) for the
// patient dashboard hero. Pure SVG, no images; decorative (aria-hidden). `small` drops the glow for compact cards.
export function kneeArt({ height = 230, small = false } = {}){
  const id = "k" + Math.random().toString(36).slice(2, 7);
  return `<svg class="kneeart" height="${height}" viewBox="0 0 200 270" aria-hidden="true" focusable="false">
  <defs>
    <radialGradient id="${id}g" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#4ADE80" stop-opacity=".38"/><stop offset=".55" stop-color="#22C55E" stop-opacity=".08"/><stop offset="1" stop-color="#22C55E" stop-opacity="0"/></radialGradient>
    <linearGradient id="${id}b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8ED8B2"/><stop offset=".45" stop-color="#4C9474"/><stop offset="1" stop-color="#21503D"/></linearGradient>
    <linearGradient id="${id}p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9FD9BC"/><stop offset="1" stop-color="#3E7A60"/></linearGradient>
    <linearGradient id="${id}c" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4ADE80" stop-opacity="0"/><stop offset=".5" stop-color="#86EFAC"/><stop offset="1" stop-color="#4ADE80" stop-opacity="0"/></linearGradient>
    <filter id="${id}f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.2"/></filter>
  </defs>
  ${small ? "" : `<ellipse cx="100" cy="140" rx="98" ry="112" fill="url(#${id}g)"/>`}
  <!-- femur -->
  <path d="M84 0 H116 L117 64 C121 80 141 88 148 106 C153 121 141 134 126 132 C115 131 109 124 100 124 C91 124 85 131 74 132 C59 134 47 121 52 106 C59 88 79 80 83 64 Z" fill="url(#${id}b)" stroke="rgba(190,255,220,.6)" stroke-width="1.2"/>
  <!-- tibia + fibula -->
  <path d="M62 152 C68 143 86 141 100 143 C114 141 132 143 138 152 C140 163 129 169 121 173 L117 270 H89 L85 173 C76 169 60 163 62 152 Z" fill="url(#${id}b)" stroke="rgba(190,255,220,.6)" stroke-width="1.2"/>
  <path d="M141 170 C143 175 141 182 139 186 L135 270 H127 L129 186 C128 180 133 172 141 170 Z" fill="url(#${id}b)" stroke="rgba(190,255,220,.5)" stroke-width="1"/>
  <!-- fine structure lines (trabecular texture) -->
  <g fill="none" stroke="rgba(187,247,208,.5)" stroke-width="1" stroke-linecap="round">
    <path d="M100 6 V60 C100 78 88 92 70 104"/><path d="M100 60 C100 78 112 92 130 104"/><path d="M92 20 C93 50 90 70 80 86"/><path d="M108 20 C107 50 110 70 120 86"/>
    <path d="M100 150 C100 170 102 200 103 266"/><path d="M78 156 C88 166 92 184 94 210"/><path d="M122 156 C112 166 108 184 106 210"/>
  </g>
  <!-- cartilage / joint line glow -->
  <ellipse cx="100" cy="139" rx="46" ry="4.5" fill="#4ADE80" opacity=".85" filter="url(#${id}f)"/>
  <rect x="56" y="137" width="88" height="3.2" rx="1.6" fill="url(#${id}c)"/>
  <!-- patella -->
  <ellipse cx="100" cy="110" rx="15" ry="18" fill="url(#${id}p)" stroke="rgba(220,255,236,.55)" stroke-width="1.1" opacity=".92"/>
  <path d="M93 104 C97 100 103 100 107 104" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="1.1" stroke-linecap="round"/>
</svg>`;
}
