// Builds every illustration on the site from one source, so they share a single painted style.
//   node tools/illustrations/build.js
// Writes: public/assets/art/*.svg (artworks), public/assets/totes/*.svg (product mockups + detail shots),
// public/assets/illustrations/*.svg (spot illustrations), public/assets/june-character.svg,
// public/assets/favicon.svg, and the hero tote inside views/index.html.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const out = (rel, text) => {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${text.trim()}\n`);
};

const C = {
  ink: '#221D19', inkSoft: '#4a413a', paper: '#FBF8F1', cream: '#F6EFE1', canvas: '#F1EADB',
  blue50: '#eef0f9', blue100: '#dfe3f0', blue300: '#8892c9', blue600: '#3A4CA6', blue800: '#26337a', blue900: '#18215a',
  cherry50: '#fbefed', cherry100: '#f2c9c5', cherry300: '#de8a83', cherry600: '#C1443C', cherry800: '#8f2d27', cherry900: '#5e1f1b',
  ochre50: '#faf3e3', ochre100: '#f1e0b8', ochre300: '#dfb664', ochre600: '#C98A2A', ochre800: '#8a5a17',
  sage50: '#f0f3ec', sage100: '#c9d4bd', sage300: '#9aa78a', sage600: '#6C7C5C', sage800: '#4f5d42',
};

// Deterministic randomness so rebuilds produce identical files.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r1 = (n) => Math.round(n * 10) / 10;

// ---------- Shared textures ----------
// p = id prefix, so several pieces can live inline on one page.
function paintDefs(p, seed = 3) {
  return `
  <filter id="${p}rough" x="-6%" y="-6%" width="112%" height="112%"><feTurbulence type="fractalNoise" baseFrequency=".045" numOctaves="2" seed="${seed}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" xChannelSelector="R" yChannelSelector="G"/></filter>
  <filter id="${p}grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="${seed + 5}" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .13  0 0 0 0 .11  0 0 0 0 .1  0 0 0 .2 -.02"/></filter>
  <filter id="${p}wash" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".011 .028" numOctaves="3" seed="${seed + 9}"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 .98  0 0 0 0 .94  0 0 0 .5 -.18"/></filter>
  <filter id="${p}soft" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="6"/></filter>`;
}
const finish = (p, w = 200, h = 250) => `<rect width="${w}" height="${h}" filter="url(#${p}wash)" opacity=".55"/><rect width="${w}" height="${h}" filter="url(#${p}grain)"/>`;

// ---------- Artworks (200 × 250; key subject kept in the middle band so 16:9 crops still read) ----------
const ART = {};

ART.sunday = (p) => ({
  defs: `<linearGradient id="${p}sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FCF5E6"/><stop offset=".7" stop-color="${C.ochre100}"/><stop offset="1" stop-color="#EFCF93"/></linearGradient>
  <radialGradient id="${p}sun" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#EDB54C"/><stop offset="1" stop-color="${C.ochre600}"/></radialGradient>
  <linearGradient id="${p}h1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9AA3D4"/><stop offset="1" stop-color="${C.blue300}"/></linearGradient>
  <linearGradient id="${p}h2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4A5BB5"/><stop offset="1" stop-color="${C.blue600}"/></linearGradient>`,
  body: `<rect width="200" height="250" fill="url(#${p}sky)"/>
  <circle cx="104" cy="104" r="62" fill="#F8E7C2" opacity=".75"/><circle cx="104" cy="104" r="44" fill="#F4D99F" opacity=".7"/>
  <g class="sun-rays" stroke="${C.ochre600}" stroke-width="2.4" stroke-linecap="round">${Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    return `<line class="ray" x1="${r1(104 + c * 31)}" y1="${r1(104 + s * 31)}" x2="${r1(104 + c * (i % 2 ? 37 : 41))}" y2="${r1(104 + s * (i % 2 ? 37 : 41))}"/>`;
  }).join('')}</g>
  <circle class="sun-core" cx="104" cy="104" r="24" fill="url(#${p}sun)" filter="url(#${p}rough)"/>
  <path d="M95 92 q6 -6 14 -4" stroke="#F6D894" stroke-width="2" fill="none" stroke-linecap="round" opacity=".9"/>
  <g class="cloud" fill="${C.paper}" opacity=".92"><ellipse cx="44" cy="70" rx="17" ry="6.5"/><ellipse cx="55" cy="65" rx="11" ry="6.5"/><ellipse cx="160" cy="58" rx="13" ry="5"/><ellipse cx="168" cy="54" rx="8" ry="5"/></g>
  <g class="bird" transform="translate(132 70)"><path d="M0 0 q4 -5 8 0 q4 -5 8 0" stroke="${C.ink}" stroke-width="1.5" fill="none" stroke-linecap="round"/></g>
  <g class="bird b2" transform="translate(150 80)"><path d="M0 0 q3 -4 6 0 q3 -4 6 0" stroke="${C.ink}" stroke-width="1.3" fill="none" stroke-linecap="round"/></g>
  <g filter="url(#${p}rough)">
    <path d="M0 164 Q34 138 74 152 Q116 126 156 146 Q182 136 200 142 V250 H0 Z" fill="url(#${p}h1)"/>
    <path d="M0 158 Q100 146 200 156" stroke="${C.cherry600}" stroke-width="2.2" fill="none" stroke-dasharray=".1 7" stroke-linecap="round"/>
    <path d="M0 190 Q46 156 98 174 Q150 194 200 164 V250 H0 Z" fill="url(#${p}h2)"/>
    <path d="M0 216 Q58 194 118 208 Q164 220 200 200 V250 H0 Z" fill="${C.blue800}"/>
  </g>
  <g stroke="#6676C9" stroke-width="1.5" fill="none" stroke-linecap="round" opacity=".8"><path d="M22 180 q10 -8 22 -8"/><path d="M128 184 q12 -2 22 -8"/><path d="M60 226 q12 -6 26 -6"/></g>
  <g fill="${C.paper}">${[[30, 222], [44, 230], [140, 224], [168, 214], [96, 236]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.8"/>`).join('')}</g>
  <g fill="${C.ochre300}">${[[36, 226], [150, 228], [104, 232]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.4"/>`).join('')}</g>`,
});

ART.movie = (p) => {
  const r = rng(11);
  const stars = Array.from({ length: 34 }, () => `<circle cx="${r1(r() * 200)}" cy="${r1(r() * 120)}" r="${r1(0.4 + r() * 0.9)}" opacity="${r1(0.35 + r() * 0.6)}"/>`).join('');
  const bulbs = Array.from({ length: 11 }, (_, i) => {
    const t = (i + 0.5) / 11;
    const x = 200 * t;
    const y = (1 - t) * (1 - t) * 34 + 2 * (1 - t) * t * 70 + t * t * 30;
    const col = [C.ochre300, C.cherry300, C.paper][i % 3];
    return `<circle cx="${r1(x)}" cy="${r1(y + 4)}" r="5" fill="${col}" opacity=".25"/><circle cx="${r1(x)}" cy="${r1(y + 4)}" r="2.2" fill="${col}"/>`;
  }).join('');
  return {
    defs: `<linearGradient id="${p}sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.blue900}"/><stop offset=".65" stop-color="${C.blue600}"/><stop offset="1" stop-color="#6E7AC6"/></linearGradient>
    <linearGradient id="${p}film" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FBE9C4"/><stop offset="1" stop-color="#EDBE6E"/></linearGradient>
    <mask id="${p}moon"><circle cx="152" cy="58" r="15" fill="#fff"/><circle cx="159" cy="52" r="13" fill="#000"/></mask>
    <clipPath id="${p}screen"><rect x="50" y="84" width="100" height="64" rx="2"/></clipPath>`,
    body: `<rect width="200" height="250" fill="url(#${p}sky)"/>
    <g fill="${C.paper}">${stars}</g>
    <circle cx="152" cy="58" r="22" fill="${C.ochre100}" opacity=".12"/><rect width="200" height="250" fill="${C.ochre100}" mask="url(#${p}moon)"/>
    <path d="M0 34 Q100 106 200 30" stroke="${C.blue900}" stroke-width=".9" fill="none"/>${bulbs}
    <path d="M100 214 L52 150 H148 Z" fill="${C.ochre100}" opacity=".08"/>
    <g stroke="${C.ink}" stroke-width="3.2" stroke-linecap="round"><path d="M62 148 L56 196"/><path d="M138 148 L144 196"/></g>
    <rect x="44" y="78" width="112" height="76" rx="4" fill="${C.ink}"/>
    <g clip-path="url(#${p}screen)"><rect x="50" y="84" width="100" height="64" fill="url(#${p}film)"/>
      <circle cx="122" cy="104" r="9" fill="${C.cherry600}" opacity=".85"/>
      <path d="M50 134 Q74 114 98 128 Q122 112 150 128 V148 H50 Z" fill="${C.ochre600}"/><path d="M50 142 Q90 130 150 144 V148 H50 Z" fill="${C.ochre800}"/>
      <path d="M70 106 q3 -4 6 0 q3 -4 6 0" stroke="${C.ink}" stroke-width="1" fill="none"/></g>
    <rect x="50" y="84" width="100" height="64" rx="2" fill="none" stroke="${C.paper}" stroke-width="1" opacity=".5"/>
    <path d="M0 200 Q100 178 200 200 V250 H0 Z" fill="#141a45" filter="url(#${p}rough)"/>
    <g fill="#0d1130" filter="url(#${p}rough)">
      <circle cx="82" cy="186" r="11"/><path d="M60 230 Q62 200 82 198 Q102 200 104 230 Z"/>
      <circle cx="116" cy="183" r="11.5"/><circle cx="124" cy="173" r="5.5"/><path d="M94 230 Q96 196 116 195 Q138 196 140 230 Z"/>
    </g>
    <path d="M58 214 Q99 200 142 212 L144 236 H56 Z" fill="${C.cherry600}" filter="url(#${p}rough)"/>
    <g stroke="${C.cherry100}" stroke-width="1.2" opacity=".7"><path d="M66 214 L64 236"/><path d="M82 210 L81 236"/><path d="M100 208 L100 236"/><path d="M118 209 L119 236"/><path d="M134 211 L136 236"/></g>
    <path d="M150 206 h14 l-2 22 h-10 Z" fill="${C.paper}"/><g stroke="${C.cherry600}" stroke-width="2.2"><path d="M154 206 l1 22"/><path d="M160 206 l-1 22"/></g>
    <g fill="${C.ochre100}"><circle cx="153" cy="204" r="3"/><circle cx="158" cy="202" r="3.4"/><circle cx="162" cy="205" r="2.8"/></g>
    ${finish(p)}`,
  };
};

ART.pet = (p) => ({
  defs: `<linearGradient id="${p}bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F7E6C1"/><stop offset="1" stop-color="#DFA24A"/></linearGradient>
  <linearGradient id="${p}fur" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#CF8445"/><stop offset="1" stop-color="#B86B31"/></linearGradient>`,
  body: `<rect width="200" height="250" fill="url(#${p}bg)"/>
  <circle cx="100" cy="116" r="74" fill="${C.paper}" opacity=".45"/><circle cx="100" cy="116" r="60" fill="${C.paper}" opacity=".3"/>
  <g fill="${C.paper}" opacity=".9"><path d="M30 52 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 Z"/><path d="M168 72 l1.5 4 4 1.5 -4 1.5 -1.5 4 -1.5 -4 -4 -1.5 4 -1.5 Z"/></g>
  <g filter="url(#${p}rough)">
    <path d="M44 250 Q48 196 100 188 Q152 196 156 250 Z" fill="url(#${p}fur)"/>
    <path d="M58 100 L64 44 Q88 58 96 80 Z" fill="#B0622B"/><path d="M142 100 L136 44 Q112 58 104 80 Z" fill="#B0622B"/>
    <path d="M66 88 L69 58 Q82 66 87 80 Z" fill="#F2CDA8"/><path d="M134 88 L131 58 Q118 66 113 80 Z" fill="#F2CDA8"/>
    <path d="M48 120 Q48 70 100 68 Q152 70 152 120 Q152 168 100 174 Q48 168 48 120 Z" fill="url(#${p}fur)"/>
    <path d="M92 70 Q100 104 108 70 Z" fill="#FBEBD6"/>
    <path d="M66 132 Q68 104 100 104 Q132 104 134 132 Q134 164 100 168 Q66 164 66 132 Z" fill="#FBEBD6"/>
  </g>
  <ellipse cx="80" cy="96" rx="6" ry="3.4" fill="#FBEBD6"/><ellipse cx="120" cy="96" rx="6" ry="3.4" fill="#FBEBD6"/>
  <g stroke="#A55A26" stroke-width="1.4" stroke-linecap="round" opacity=".7"><path d="M86 76 l2 6"/><path d="M114 76 l-2 6"/><path d="M58 118 l6 -2"/><path d="M142 118 l-6 -2"/></g>
  <circle cx="81" cy="114" r="6.4" fill="${C.ink}"/><circle cx="119" cy="114" r="6.4" fill="${C.ink}"/>
  <circle cx="83.2" cy="111.6" r="2.1" fill="#fff"/><circle cx="121.2" cy="111.6" r="2.1" fill="#fff"/>
  <path d="M89 130 Q100 123 111 130 Q109 140 100 141 Q91 140 89 130 Z" fill="${C.ink}"/><ellipse cx="96" cy="129" rx="3" ry="1.6" fill="#fff" opacity=".45"/>
  <path d="M100 141 V148 M100 148 Q92 155 85 149 M100 148 Q108 155 115 149" stroke="${C.ink}" stroke-width="2" fill="none" stroke-linecap="round"/>
  <path d="M95 152 Q100 164 105 152 Z" fill="${C.cherry300}"/>
  <ellipse cx="70" cy="134" rx="7" ry="4" fill="${C.cherry300}" opacity=".35"/><ellipse cx="130" cy="134" rx="7" ry="4" fill="${C.cherry300}" opacity=".35"/>
  <g filter="url(#${p}rough)"><path d="M58 194 Q100 214 142 194 L100 244 Z" fill="${C.cherry600}"/><circle cx="100" cy="202" r="7" fill="${C.cherry800}"/></g>
  <g fill="${C.paper}" opacity=".9"><circle cx="80" cy="204" r="2.2"/><circle cx="96" cy="216" r="2.2"/><circle cx="112" cy="210" r="2.2"/><circle cx="104" cy="228" r="2"/><circle cx="122" cy="202" r="2"/></g>
  ${finish(p)}`,
});

ART.nature = (p) => {
  const petals = (n, rx, ry, off, col, rot) => Array.from({ length: n }, (_, i) => `<ellipse cx="70" cy="${84 - off}" rx="${rx}" ry="${ry}" fill="${col}" transform="rotate(${r1(rot + (i * 360) / n)} 70 84)"/>`).join('');
  const r = rng(5);
  const seeds = Array.from({ length: 16 }, () => { const a = r() * Math.PI * 2; const d = r() * 8; return `<circle cx="${r1(70 + Math.cos(a) * d)}" cy="${r1(84 + Math.sin(a) * d)}" r=".9"/>`; }).join('');
  return {
    defs: `<linearGradient id="${p}sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#EEF1E6"/><stop offset="1" stop-color="${C.sage100}"/></linearGradient>
    <linearGradient id="${p}shell" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8EA766"/><stop offset="1" stop-color="#6F8A4F"/></linearGradient>`,
    body: `<rect width="200" height="250" fill="url(#${p}sky)"/>
    <circle cx="150" cy="58" r="30" fill="${C.paper}" opacity=".45"/><circle cx="150" cy="58" r="18" fill="${C.paper}" opacity=".85"/>
    <path d="M0 168 Q56 146 116 160 Q164 170 200 152 V250 H0 Z" fill="${C.sage300}" filter="url(#${p}rough)"/>
    <path d="M71 200 C66 160 75 128 70 96" stroke="${C.sage800}" stroke-width="4" fill="none" stroke-linecap="round"/>
    <g filter="url(#${p}rough)"><path d="M70 150 Q48 146 40 128 Q60 128 70 146 Z" fill="${C.sage600}"/><path d="M72 128 Q94 120 100 104 Q80 106 72 124 Z" fill="${C.sage600}"/></g>
    <g stroke="${C.sage800}" stroke-width=".9" fill="none" opacity=".7"><path d="M68 146 Q56 138 44 130"/><path d="M73 124 Q86 114 97 107"/></g>
    <g filter="url(#${p}rough)">${petals(14, 6, 15, 17, C.ochre600, 12)}${petals(14, 5.4, 13, 15, '#E7AC3F', 0)}</g>
    <circle cx="70" cy="84" r="11" fill="#5C3A1D"/><g fill="${C.ochre800}">${seeds}</g>
    <path d="M0 198 Q100 182 200 200 V250 H0 Z" fill="${C.sage600}" filter="url(#${p}rough)"/>
    <g filter="url(#${p}rough)">
      <ellipse cx="136" cy="196" rx="34" ry="4" fill="${C.sage800}" opacity=".5"/>
      <path d="M108 196 h8 v8 h-8 Z M150 196 h8 v8 h-8 Z" fill="#A6B886"/>
      <path d="M164 186 Q178 176 182 186 Q182 194 170 194 Z" fill="#A6B886"/>
      <path d="M102 194 Q104 158 136 156 Q168 158 170 194 Z" fill="url(#${p}shell)"/>
      <path d="M100 194 H172" stroke="#556D3C" stroke-width="4" stroke-linecap="round"/>
    </g>
    <g stroke="#4F6638" stroke-width="1.3" fill="none" stroke-linejoin="round" opacity=".85"><path d="M124 162 L118 178 L130 190 M148 162 L154 178 L142 190 M118 178 H154 M130 190 H142"/><path d="M136 158 V170"/></g>
    <circle cx="177" cy="184" r="1.3" fill="${C.ink}"/>
    <g stroke="${C.sage800}" stroke-width="1.3" stroke-linecap="round" fill="none">${[[18, 214], [40, 222], [90, 216], [182, 220], [60, 236], [150, 236]].map(([x, y]) => `<path d="M${x} ${y} q-2 -6 0 -9 M${x + 3} ${y} q1 -5 3 -7"/>`).join('')}</g>
    <g fill="${C.paper}">${[[30, 228], [112, 230], [170, 232]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2"/>`).join('')}</g>
    <g transform="translate(150 108) rotate(14)"><path d="M0 0 Q-8 -8 -8 -2 Q-8 4 0 0 Q8 -8 8 -2 Q8 4 0 0" fill="${C.cherry300}"/></g>
    <g transform="translate(34 92) rotate(-12)"><path d="M0 0 Q-6 -6 -6 -1 Q-6 3 0 0 Q6 -6 6 -1 Q6 3 0 0" fill="${C.paper}"/></g>
    ${finish(p)}`,
  };
};

ART.skyline = (p) => {
  const r = rng(21);
  const back = [];
  for (let x = -4; x < 204;) { const w = 14 + Math.floor(r() * 16); const h = 40 + Math.floor(r() * 46); back.push(`<rect x="${x}" y="${178 - h}" width="${w}" height="${h + 20}"/>`); x += w + 1; }
  const front = [];
  const windows = [];
  const spec = [[0, 18, 52], [20, 22, 76], [44, 16, 58], [62, 24, 98], [88, 18, 64], [108, 26, 84], [136, 16, 50], [154, 22, 72], [178, 24, 60]];
  spec.forEach(([x, w, h]) => {
    const y = 190 - h;
    front.push(`<rect x="${x}" y="${y}" width="${w}" height="${h + 10}"/>`);
    for (let wy = y + 6; wy < 184; wy += 8) for (let wx = x + 3; wx < x + w - 4; wx += 6) {
      const v = r();
      if (v < 0.42) windows.push(`<rect x="${wx}" y="${wy}" width="2.6" height="3.4" opacity="${v < 0.12 ? 0.45 : 1}"/>`);
    }
  });
  front.push('<path d="M71 92 L74 72 L77 92 Z"/><rect x="72.6" y="64" width="1" height="8"/><path d="M108 106 Q121 92 134 106 Z"/><rect x="157" y="112" width="8" height="8"/>');
  return {
    defs: `<linearGradient id="${p}sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.blue800}"/><stop offset=".55" stop-color="${C.blue300}"/><stop offset="1" stop-color="#F0C2A8"/></linearGradient>
    <linearGradient id="${p}river" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.blue600}"/><stop offset="1" stop-color="${C.blue900}"/></linearGradient>`,
    body: `<rect width="200" height="250" fill="url(#${p}sky)"/>
    <g fill="${C.paper}" opacity=".8"><circle cx="24" cy="30" r=".9"/><circle cx="60" cy="18" r="1.1"/><circle cx="96" cy="40" r=".8"/><circle cx="176" cy="24" r="1"/><circle cx="140" cy="46" r=".7"/></g>
    <circle cx="146" cy="134" r="40" fill="#F6CF8E" opacity=".35"/><circle cx="146" cy="134" r="22" fill="#EDB04C" filter="url(#${p}rough)"/>
    <g fill="#5A64A6" opacity=".85" filter="url(#${p}rough)">${back.join('')}</g>
    <g fill="${C.ink}" filter="url(#${p}rough)">${front.join('')}</g>
    <g fill="#F7D58C">${windows.join('')}</g>
    <rect y="196" width="200" height="54" fill="url(#${p}river)"/>
    <path d="M0 196 H200" stroke="${C.ink}" stroke-width="2"/>
    <g stroke="#EDB04C" stroke-linecap="round" opacity=".8"><path d="M132 206 h26" stroke-width="2.2"/><path d="M136 214 h18" stroke-width="1.8"/><path d="M140 222 h10" stroke-width="1.5"/></g>
    <g stroke="#F7D58C" stroke-width="1.2" stroke-linecap="round" opacity=".55">${[[12, 210], [34, 218], [66, 206], [80, 226], [100, 212], [176, 216], [188, 230]].map(([x, y]) => `<path d="M${x} ${y} h5"/>`).join('')}</g>
    <g stroke="${C.blue100}" stroke-width="1" fill="none" stroke-linecap="round" opacity=".5"><path d="M20 236 q10 -3 20 0"/><path d="M110 240 q10 -3 20 0"/></g>
    ${finish(p)}`,
  };
};

ART.words = (p) => ({
  defs: `<linearGradient id="${p}bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F8E2CF"/><stop offset="1" stop-color="#E7A472"/></linearGradient>`,
  body: `<rect width="200" height="250" fill="url(#${p}bg)"/>
  <path d="M0 214 Q70 196 130 208 Q170 216 200 202 V250 H0 Z" fill="${C.sage300}" filter="url(#${p}rough)"/>
  <path d="M38 124 Q34 76 92 68 Q156 60 166 110 Q174 162 112 172 Q44 180 38 124 Z" fill="${C.paper}" filter="url(#${p}rough)"/>
  <text x="102" y="114" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="30" fill="${C.ink}" letter-spacing="-.5">softly,</text>
  <text x="104" y="146" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="30" fill="${C.cherry600}" letter-spacing="-.5">softly.</text>
  <path d="M68 158 Q104 168 140 154" stroke="${C.blue600}" stroke-width="3.2" fill="none" stroke-linecap="round" filter="url(#${p}rough)"/>
  <g fill="${C.sage600}" filter="url(#${p}rough)"><path d="M40 160 Q30 150 34 138 Q44 148 40 160 Z"/><path d="M44 168 Q50 154 62 154 Q56 166 44 168 Z"/><path d="M160 74 Q170 62 182 66 Q174 78 160 74 Z"/><path d="M156 66 Q154 54 162 46 Q166 58 156 66 Z"/></g>
  <g stroke="${C.sage800}" stroke-width="1.2" fill="none" stroke-linecap="round"><path d="M36 176 Q40 160 50 150"/><path d="M150 82 Q158 68 170 60"/></g>
  <g fill="${C.cherry600}"><circle cx="160" cy="44" r="3"/><circle cx="34" cy="196" r="3.2"/></g>
  <g fill="${C.ochre600}"><path d="M28 60 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6 -4 -4 -1.6 4 -1.6 Z"/><path d="M174 168 l1.3 3.2 3.2 1.3 -3.2 1.3 -1.3 3.2 -1.3 -3.2 -3.2 -1.3 3.2 -1.3 Z"/></g>
  ${finish(p)}`,
});

ART.couple = (p) => ({
  defs: `<linearGradient id="${p}sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.cherry100}"/><stop offset=".55" stop-color="${C.cherry300}"/><stop offset="1" stop-color="${C.cherry600}"/></linearGradient>
  <radialGradient id="${p}sun" cx=".5" cy=".4" r=".6"><stop offset="0" stop-color="#F2C56A"/><stop offset="1" stop-color="${C.ochre600}"/></radialGradient>`,
  body: `<rect width="200" height="250" fill="url(#${p}sky)"/>
  <circle cx="100" cy="142" r="66" fill="#F6CF8E" opacity=".3"/><circle cx="100" cy="142" r="46" fill="url(#${p}sun)" filter="url(#${p}rough)"/>
  <g stroke="${C.ink}" stroke-width="1.4" fill="none" stroke-linecap="round"><path d="M38 56 q4 -5 8 0 q4 -5 8 0"/><path d="M58 44 q3 -4 6 0 q3 -4 6 0"/></g>
  <path d="M100 86 C92 78 78 76 78 64 C78 56 86 52 92 54 C96 55 99 58 100 61 C101 58 104 55 108 54 C114 52 122 56 122 64 C122 76 108 78 100 86 Z" fill="${C.paper}" filter="url(#${p}rough)"/>
  <g stroke="${C.paper}" stroke-width="1.4" stroke-linecap="round"><path d="M70 58 l-6 -3"/><path d="M130 58 l6 -3"/><path d="M100 44 v-6"/></g>
  <g filter="url(#${p}rough)">
    <path d="M0 180 Q100 150 200 182 V250 H0 Z" fill="${C.cherry800}"/>
    <g fill="${C.ink}"><circle cx="88" cy="141" r="8"/><path d="M76 174 Q74 152 88 150 Q101 152 100 174 Z"/>
      <circle cx="107" cy="139" r="8.4"/><circle cx="113" cy="131" r="4"/><path d="M98 174 Q98 150 109 148 Q121 151 120 174 Z"/></g>
    <path d="M0 208 Q90 188 200 212 V250 H0 Z" fill="${C.cherry900}"/>
  </g>
  <path d="M30 196 Q100 176 172 196" stroke="${C.cherry100}" stroke-width="1.8" fill="none" stroke-dasharray=".1 6" stroke-linecap="round" opacity=".9"/>
  <g stroke="#3f1412" stroke-width="1.3" stroke-linecap="round" fill="none">${[[22, 224], [56, 232], [140, 228], [176, 222]].map(([x, y]) => `<path d="M${x} ${y} q-1 -6 1 -9 M${x + 3} ${y} q1 -5 3 -7"/>`).join('')}</g>
  ${finish(p)}`,
});

ART.fandom = (p) => {
  const r = rng(8);
  const dots = Array.from({ length: 46 }, () => `<circle cx="${r1(r() * 200)}" cy="${r1(r() * 250)}" r="${r1(0.3 + r() * 0.9)}" opacity="${r1(0.3 + r() * 0.7)}"/>`).join('');
  const spark = (x, y, s, col) => `<path d="M${x} ${y - s} Q${x + s * 0.18} ${y - s * 0.18} ${x + s} ${y} Q${x + s * 0.18} ${y + s * 0.18} ${x} ${y + s} Q${x - s * 0.18} ${y + s * 0.18} ${x - s} ${y} Q${x - s * 0.18} ${y - s * 0.18} ${x} ${y - s} Z" fill="${col}"/>`;
  return {
    defs: `<radialGradient id="${p}bg" cx=".5" cy=".45" r=".75"><stop offset="0" stop-color="#3A3566"/><stop offset=".6" stop-color="#1F1B33"/><stop offset="1" stop-color="#14111F"/></radialGradient>
    <linearGradient id="${p}card" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.paper}"/><stop offset="1" stop-color="#F1E6CF"/></linearGradient>`,
    body: `<rect width="200" height="250" fill="url(#${p}bg)"/>
    <ellipse cx="60" cy="80" rx="60" ry="30" fill="${C.blue600}" opacity=".35" filter="url(#${p}soft)"/><ellipse cx="150" cy="178" rx="56" ry="26" fill="${C.cherry800}" opacity=".4" filter="url(#${p}soft)"/>
    <g fill="${C.paper}">${dots}</g>
    ${spark(36, 46, 6, C.ochre100)}${spark(166, 98, 5, C.paper)}${spark(28, 168, 4, C.paper)}${spark(176, 200, 6, C.ochre100)}${spark(142, 30, 3.5, C.paper)}
    <circle cx="158" cy="56" r="11" fill="${C.ochre600}"/><path d="M158 45 a11 11 0 0 1 0 22" fill="${C.ochre800}" opacity=".45"/><ellipse cx="158" cy="56" rx="20" ry="5" fill="none" stroke="${C.ochre100}" stroke-width="1.4" transform="rotate(-18 158 56)"/>
    <rect x="66" y="74" width="68" height="96" rx="6" fill="${C.ochre300}" opacity=".45" filter="url(#${p}soft)" transform="rotate(-8 100 122)"/>
    <g transform="rotate(-8 100 122)">
      <rect x="68" y="76" width="64" height="92" rx="5" fill="url(#${p}card)"/>
      <rect x="73" y="81" width="54" height="82" rx="3" fill="none" stroke="${C.ochre600}" stroke-width=".9"/>
      <path d="M100 98 L118 140 H82 Z" fill="${C.cherry600}"/><circle cx="100" cy="126" r="7" fill="${C.ochre600}"/>
      <g fill="${C.ochre600}"><circle cx="78" cy="86" r="1.2"/><circle cx="122" cy="86" r="1.2"/><circle cx="78" cy="158" r="1.2"/><circle cx="122" cy="158" r="1.2"/></g>
      <path d="M86 152 H114" stroke="${C.ink}" stroke-width="1" opacity=".5"/>
    </g>
    <path d="M38 196 Q100 166 162 196" stroke="${C.blue300}" stroke-width="4" fill="none" stroke-linecap="round" filter="url(#${p}rough)"/>
    ${spark(162, 194, 4, C.blue100)}${spark(52, 186, 3, C.blue100)}
    ${finish(p)}`,
  };
};

ART.custom = (p) => ({
  defs: `<linearGradient id="${p}bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FBF6EC"/><stop offset="1" stop-color="#EFE3CA"/></linearGradient>`,
  body: `<rect width="200" height="250" fill="url(#${p}bg)"/>
  <g transform="rotate(-4 100 118)">
    <rect x="50" y="56" width="100" height="122" rx="2" fill="${C.ink}" opacity=".12" transform="translate(3 4)"/>
    <rect x="50" y="56" width="100" height="122" rx="2" fill="#fff"/>
    <rect x="58" y="64" width="84" height="84" fill="${C.ochre50}"/>
    <rect x="58" y="64" width="84" height="84" fill="none" stroke="${C.inkSoft}" stroke-width="1" stroke-dasharray="4 3"/>
    <path d="M100 118 C94 112 84 111 84 103 C84 97 90 95 94 96 C97 97 99 99 100 101 C101 99 103 97 106 96 C110 95 116 97 116 103 C116 111 106 112 100 118 Z" fill="none" stroke="${C.cherry600}" stroke-width="1.6" stroke-dasharray="3 2.4"/>
    <text x="100" y="168" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="11" fill="${C.inkSoft}">your story here</text>
  </g>
  <rect x="82" y="46" width="38" height="13" fill="${C.cherry300}" opacity=".75" transform="rotate(-6 101 52)"/>
  <g filter="url(#${p}rough)"><circle cx="40" cy="206" r="12" fill="${C.blue600}"/><circle cx="64" cy="216" r="10" fill="${C.cherry600}"/><circle cx="46" cy="230" r="9" fill="${C.ochre600}"/><circle cx="70" cy="238" r="7" fill="${C.sage600}"/></g>
  <g transform="rotate(-38 150 214)">
    <rect x="112" y="210" width="62" height="7" rx="3.5" fill="${C.ochre800}"/>
    <rect x="172" y="209" width="14" height="9" fill="#BDB5A8"/>
    <path d="M186 209 Q200 211 204 213.5 Q200 216 186 218 Z" fill="${C.cherry600}"/>
  </g>
  <g fill="${C.ochre600}"><path d="M164 60 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6 -4 -4 -1.6 4 -1.6 Z"/></g>
  ${finish(p)}`,
});

function artSvg(name, p = 'a') {
  const a = ART[name](p);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 250" width="400" height="500"><defs>${paintDefs(p)}${a.defs}</defs>${a.body}${a.body.includes('#' + p + 'wash') ? '' : finish(p)}</svg>`;
}

// ---------- Tote mockup ----------
function toteDefs(p) {
  return `
  <radialGradient id="${p}bg" cx=".5" cy=".38" r=".78"><stop offset="0" stop-color="#FBF8F1"/><stop offset=".7" stop-color="#EFE8DA"/><stop offset="1" stop-color="#E4DBC8"/></radialGradient>
  <linearGradient id="${p}fab" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#E9E0CD"/><stop offset=".22" stop-color="#F5EFE3"/><stop offset=".62" stop-color="#F1EADC"/><stop offset="1" stop-color="#DED3BD"/></linearGradient>
  <linearGradient id="${p}fabV" x1="0" y1="0" x2="0" y2="1"><stop offset=".72" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#5a4630" stop-opacity=".12"/></linearGradient>
  <linearGradient id="${p}hem" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E7DECB"/><stop offset="1" stop-color="#EFE8DA"/></linearGradient>
  <filter id="${p}weave" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.1 .55" numOctaves="2" seed="4" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .35  0 0 0 0 .28  0 0 0 0 .2  0 0 0 .32 -.08"/></filter>
  <filter id="${p}edge" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".06" numOctaves="3" seed="12" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="7" xChannelSelector="R" yChannelSelector="G"/></filter>
  <filter id="${p}blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7"/></filter>
  <filter id="${p}blurS" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.5"/></filter>`;
}

const STITCH = '#C9BCA2';

function toteBody(p, artName, { tag = true } = {}) {
  const body = 'M74 132 L246 132 L255 350 Q256 362 244 362 L76 362 Q64 362 65 350 Z';
  const a = ART[artName](`${p}a`);
  return `
  <ellipse cx="160" cy="370" rx="104" ry="10" fill="#3b2f22" opacity=".18" filter="url(#${p}blurS)"/>
  <path d="M86 140 L234 140 L250 360 H70 Z" fill="#3b2f22" opacity=".12" filter="url(#${p}blur)" transform="translate(6 8)"/>
  <path class="tote-handle-back" d="M122 134 C118 70 202 70 198 134" stroke="#D3C7AE" stroke-width="12" fill="none"/>
  <clipPath id="${p}body"><path d="${body}"/></clipPath>
  <path d="${body}" fill="url(#${p}fab)"/>
  <g clip-path="url(#${p}body)">
    <rect x="60" y="128" width="200" height="240" filter="url(#${p}weave)"/>
    <path d="M60 128 H260 V150 H60 Z" fill="url(#${p}hem)"/>
    <path d="M60 150 H260" stroke="#D9CFBA" stroke-width="1"/>
    <path d="M66 146 H254" stroke="${STITCH}" stroke-width=".9" stroke-dasharray="3 2.4"/>
    <path d="M73 152 L80 356" stroke="${STITCH}" stroke-width=".9" stroke-dasharray="3 2.4"/><path d="M247 152 L240 356" stroke="${STITCH}" stroke-width=".9" stroke-dasharray="3 2.4"/>
    <ellipse cx="112" cy="250" rx="16" ry="110" fill="#fff" opacity=".22" filter="url(#${p}blur)"/>
    <ellipse cx="214" cy="250" rx="12" ry="110" fill="#6b5a40" opacity=".08" filter="url(#${p}blur)"/>
    <mask id="${p}paint"><rect x="92" y="172" width="136" height="168" rx="4" fill="#fff" filter="url(#${p}edge)"/></mask>
    <g mask="url(#${p}paint)" opacity=".97">
      <svg x="90" y="170" width="140" height="172" viewBox="0 0 200 250" preserveAspectRatio="xMidYMid slice"><defs>${paintDefs(`${p}a`)}${a.defs}</defs>${a.body}</svg>
      <rect x="88" y="168" width="144" height="176" filter="url(#${p}weave)" opacity=".7"/>
    </g>
    <rect x="60" y="128" width="200" height="240" fill="url(#${p}fabV)"/>
  </g>
  <path d="${body}" fill="none" stroke="#D2C5AB" stroke-width="1.1"/>
  <path class="tote-handle" d="M106 164 L106 140 C102 52 218 52 214 140 L214 164" stroke="#D8CDB5" stroke-width="15" fill="none"/>
  <path d="M106 164 L106 140 C102 52 218 52 214 140 L214 164" stroke="#EFE8DA" stroke-width="12" fill="none"/>
  <path d="M106 164 L106 140 C102 52 218 52 214 140 L214 164" stroke="${STITCH}" stroke-width=".8" fill="none" stroke-dasharray="3 2.4"/>
  <g fill="none" stroke="${STITCH}" stroke-width=".9"><rect x="99.5" y="146" width="13" height="14"/><path d="M99.5 146 L112.5 160 M112.5 146 L99.5 160"/><rect x="207.5" y="146" width="13" height="14"/><path d="M207.5 146 L220.5 160 M220.5 146 L207.5 160"/></g>
  ${tag ? `<path d="M211 96 Q236 118 236 146" stroke="#8a6a44" stroke-width="1" fill="none"/>
  <g transform="rotate(10 236 166)"><path d="M226 150 L232 144 H240 L246 150 V184 H226 Z" fill="#D9B88A"/><path d="M226 150 L232 144 H240 L246 150 V184 H226 Z" fill="none" stroke="#B8935F" stroke-width=".6"/><circle cx="236" cy="152" r="2" fill="#EFE8DA" stroke="#8a6a44" stroke-width=".6"/>
  <text x="236" y="169" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="5.4" fill="#5a4630">hand</text><text x="236" y="176" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="5.4" fill="#5a4630">painted</text></g>` : ''}`;
}

function pouchBody(p, artName) {
  const body = 'M52 168 L268 168 L271 328 Q272 340 260 340 L60 340 Q48 340 49 328 Z';
  const a = ART[artName](`${p}a`);
  return `
  <ellipse cx="160" cy="350" rx="118" ry="9" fill="#3b2f22" opacity=".18" filter="url(#${p}blurS)"/>
  <path d="M60 176 H260 L266 338 H54 Z" fill="#3b2f22" opacity=".12" filter="url(#${p}blur)" transform="translate(6 8)"/>
  <clipPath id="${p}body"><path d="${body}"/></clipPath>
  <path d="${body}" fill="url(#${p}fab)"/>
  <g clip-path="url(#${p}body)">
    <rect x="40" y="160" width="240" height="190" filter="url(#${p}weave)"/>
    <path d="M40 160 H280 V186 H40 Z" fill="url(#${p}hem)"/>
    <path d="M56 177 H264" stroke="#B9AD94" stroke-width="4.5" stroke-dasharray="1.6 1.6"/>
    <path d="M56 186 H264" stroke="${STITCH}" stroke-width=".9" stroke-dasharray="3 2.4"/>
    <mask id="${p}paint"><rect x="88" y="198" width="144" height="124" rx="4" fill="#fff" filter="url(#${p}edge)"/></mask>
    <g mask="url(#${p}paint)" opacity=".97">
      <svg x="86" y="196" width="148" height="128" viewBox="0 0 200 250" preserveAspectRatio="xMidYMid slice"><defs>${paintDefs(`${p}a`)}${a.defs}</defs>${a.body}</svg>
      <rect x="84" y="194" width="152" height="132" filter="url(#${p}weave)" opacity=".7"/>
    </g>
    <rect x="40" y="160" width="240" height="190" fill="url(#${p}fabV)"/>
  </g>
  <path d="${body}" fill="none" stroke="#D2C5AB" stroke-width="1.1"/>
  <rect x="236" y="171" width="16" height="11" rx="2" fill="#C8C1B4" stroke="#9e968a" stroke-width=".7"/>
  <path d="M248 182 Q262 198 254 214 Q246 220 240 210 Q244 198 242 182" fill="${C.ochre800}"/>`;
}

function toteSvg(slug, artName, { kind = 'tote', detail = false } = {}) {
  const p = 't';
  const vb = detail ? (kind === 'pouch' ? '78 180 164 205' : '84 166 152 190') : '0 0 320 400';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="640" height="800" role="img" aria-label="${slug.replace(/-/g, ' ')} ${kind}"><defs>${toteDefs(p)}</defs>
  <rect x="0" y="0" width="320" height="400" fill="url(#${p}bg)"/>
  ${kind === 'pouch' ? pouchBody(p, artName) : toteBody(p, artName, { tag: !detail })}</svg>`;
}

// ---------- Hero tote (inline, animated by CSS) ----------
function heroSvg() {
  const p = 'h';
  return `<svg class="tote hero-tote" viewBox="44 44 232 336" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs>${toteDefs(p)}</defs>${toteBody(p, 'sunday', { tag: false })}</svg>`;
}

// ---------- Spot illustrations (120 × 120), each acting out its own step on a 6s loop ----------
// The static (no-animation) state of every element is the finished picture, so reduced-motion users see that.
// The page plays them one after another (see wireSteps in home.js): each plays once, then holds its finished picture.
const SPOT_CSS = `
  .a{ animation-duration:5.4s; animation-iteration-count:1; animation-timing-function:cubic-bezier(.45,0,.25,1); animation-fill-mode:both; transform-box:fill-box; }
  .tw{ animation-iteration-count:infinite; animation-duration:2.4s; }
  @media (prefers-reduced-motion: reduce){ .a{ animation:none !important; } }`;
const STILL_CSS = '.a{ animation:none !important; }';
const spot = (p, css, inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="240" height="240"><defs>${paintDefs(p)}<filter id="${p}sh" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2"/></filter></defs><style>${SPOT_CSS}${css}</style><g>${inner}</g></svg>`;
const still = (svg) => svg.replace('</style>', `${STILL_CSS}</style>`);
const sparkle = (x, y, s, col, cls = '') => `<path class="${cls}" d="M${x} ${y - s} l${s * 0.3} ${s * 0.7} ${s * 0.7} ${s * 0.3} -${s * 0.7} ${s * 0.3} -${s * 0.3} ${s * 0.7} -${s * 0.3} -${s * 0.7} -${s * 0.7} -${s * 0.3} ${s * 0.7} -${s * 0.3} Z" fill="${col}"/>`;

// 1 · Tell June your idea: the photo slides into the envelope, the flap folds shut, the seal stamps, a heart floats up.
const STEP_IDEA = spot('s', `
  .photo{ animation-name:photo; }
  @keyframes photo{ 0%, 14%{ transform:translateY(-50px); opacity:0; } 8%{ opacity:1; } 15%{ transform:translateY(-50px); opacity:1; } 34%, 100%{ transform:none; opacity:1; } }
  .flapBack{ transform-origin:50% 100%; transform:scaleY(0); animation-name:flapBack; }
  @keyframes flapBack{ 0%, 36%{ transform:scaleY(1); } 45%, 100%{ transform:scaleY(0); } }
  .flapFront{ transform-origin:50% 0%; animation-name:flapFront; }
  @keyframes flapFront{ 0%, 44%{ transform:scaleY(0); } 54%, 100%{ transform:scaleY(1); } }
  .seal{ transform-origin:50% 50%; animation-name:pop; }
  @keyframes pop{ 0%, 55%{ transform:scale(0); } 61%{ transform:scale(1.35); } 65%, 100%{ transform:scale(1); } }
  .hop{ transform-box:view-box; animation-name:hop; }
  @keyframes hop{ 0%, 62%{ transform:none; } 66%{ transform:translateY(-4px); } 70%{ transform:none; } 73%{ transform:translateY(-1.5px); } 76%, 100%{ transform:none; } }
  .heart{ transform-origin:50% 50%; animation-name:heart; }
  @keyframes heart{ 0%, 64%{ transform:translate(-34px, 36px) scale(.3); opacity:0; } 70%{ opacity:1; } 80%, 100%{ transform:none; opacity:1; } }
  .tw{ transform-origin:50% 50%; animation-name:tw; }
  @keyframes tw{ 0%, 100%{ transform:scale(1); } 50%{ transform:scale(.4); } }`, `
  <ellipse cx="60" cy="106" rx="40" ry="5" fill="${C.ink}" opacity=".12" filter="url(#ssh)"/>
  <g transform="rotate(-6 60 72)"><g class="a hop">
    <path d="M22 56 H98 V102 H22 Z" fill="#E9DCC3"/>
    <path class="a flapBack" d="M22 56 L60 30 L98 56 Z" fill="#E4D5B8"/>
    <g class="a photo"><g transform="rotate(5 60 78)"><rect x="42" y="56" width="36" height="42" fill="#fff"/><rect x="45" y="59" width="30" height="27" fill="${C.ochre100}"/><circle cx="68" cy="66" r="4.6" fill="${C.ochre600}"/><path d="M45 80 Q53 70 59 76 Q66 68 75 79 V86 H45 Z" fill="${C.blue600}"/></g></g>
    <path d="M22 56 L60 84 L98 56 V102 H22 Z" fill="#F3EADA"/>
    <path d="M22 102 L52 78 M98 102 L68 78" stroke="#D8C9AC" stroke-width="1"/>
    <path class="a flapFront" d="M21 55.5 L60 86 L99 55.5 Z" fill="#EFE3CC" stroke="#D8C9AC" stroke-width="1" stroke-linejoin="round"/>
    <g class="a seal"><circle cx="60" cy="80" r="7" fill="${C.cherry600}" filter="url(#srough)"/><path d="M57 80 h6 M60 77 v6" stroke="${C.cherry800}" stroke-width="1.2"/></g>
  </g></g>
  <path class="a heart" d="M98 24 C95 21 90 21 90 25 C90 28 94 29 98 33 C102 29 106 28 106 25 C106 21 101 21 98 24 Z" fill="${C.cherry300}"/>
  ${sparkle(15, 32, 4, C.ochre600, 'a tw')}${sparkle(108, 54, 2.6, C.ochre300, 'a tw')}`);

// 2 · She sketches it first: the pencil draws the tote, colour washes in, the quote tag swings in.
const SK = [
  ['M40 50 L80 50 L83 92 H37 Z', 6, 22],
  ['M50 50 C49 32 71 32 70 50', 22, 31],
  ['M73 62 a5 5 0 1 1 -10 0 a5 5 0 1 1 10 0', 31, 38],
  ['M42 84 Q52 72 60 78 Q68 70 78 82', 38, 47],
];
const STEP_SKETCH = spot('s', `
  .ln{ stroke-dasharray:1; animation-name:var(--k); }
  ${SK.map((l, i) => `@keyframes d${i}{ 0%, ${l[1]}%{ stroke-dashoffset:1; } ${l[2]}%, 100%{ stroke-dashoffset:0; } }`).join('\n  ')}
  .wash{ animation-name:wash; }
  @keyframes wash{ 0%, 50%{ opacity:0; } 60%, 100%{ opacity:1; } }
  .pencil{ transform-box:view-box; transform:translate(80px, 98px); animation-name:pencil; animation-timing-function:linear; }
  @keyframes pencil{
    0%, 6%{ transform:translate(40px, 50px); } 10%{ transform:translate(80px, 50px); } 15%{ transform:translate(83px, 92px); } 19%{ transform:translate(37px, 92px); } 22%{ transform:translate(40px, 50px); }
    24%{ transform:translate(50px, 50px); } 27%{ transform:translate(55px, 38px); } 29%{ transform:translate(66px, 38px); } 31%{ transform:translate(70px, 50px); }
    33%{ transform:translate(73px, 62px); } 35.5%{ transform:translate(68px, 57px); } 38%{ transform:translate(63px, 62px); }
    40%{ transform:translate(42px, 84px); } 43%{ transform:translate(60px, 78px); } 47%{ transform:translate(78px, 82px); }
    56%, 100%{ transform:translate(80px, 98px); } }
  .tag{ transform-origin:85% 50%; animation-name:tag; }
  @keyframes tag{ 0%, 62%{ transform:rotate(-50deg) scale(.4); opacity:0; } 68%{ opacity:1; } 72%{ transform:rotate(14deg) scale(1.05); } 77%{ transform:rotate(-6deg); } 81%, 100%{ transform:none; opacity:1; } }`, `
  <ellipse cx="60" cy="108" rx="42" ry="5" fill="${C.ink}" opacity=".12" filter="url(#ssh)"/>
  <g transform="rotate(4 60 62)">
    <rect x="22" y="18" width="76" height="86" rx="3" fill="#2f2a26"/>
    <rect x="25" y="20" width="72" height="82" rx="2" fill="#FBF8F1"/>
    <g fill="${C.ink}">${Array.from({ length: 7 }, (_, i) => `<circle cx="${30 + i * 10}" cy="19" r="1.6"/>`).join('')}</g>
    <g class="a wash"><path d="M42 84 Q52 72 60 78 Q68 70 78 82 L79 90 H41 Z" fill="${C.blue300}" opacity=".6"/><circle cx="68" cy="62" r="5" fill="${C.ochre300}" opacity=".8"/></g>
    <g fill="none" stroke="#6e655d" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round">${SK.map((l, i) => `<path class="a ln" style="--k:d${i}" pathLength="1" d="${l[0]}"/>`).join('')}</g>
    <g class="a pencil"><g transform="rotate(-36)"><rect x="8" y="-3" width="44" height="6" rx="1" fill="${C.ochre600}"/><rect x="48" y="-3" width="6" height="6" fill="${C.cherry300}"/><path d="M8 -3 L0 0 L8 3 Z" fill="#E8D4B0"/><path d="M2.5 -1 L0 0 L2.5 1 Z" fill="${C.ink}"/></g></g>
  </g>
  <g class="a tag"><g transform="rotate(-8 22 92)"><path d="M8 84 H30 L36 92 L30 100 H8 Z" fill="${C.cherry600}"/><circle cx="31" cy="92" r="1.6" fill="#fff"/><text x="18" y="94.5" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="7" fill="#fff">₹</text></g></g>`);

// 3 · June paints, seals and ships: the tote drops in, the flaps fold, tape, seal, label, and off it goes.
const STEP_SHIP = spot('s', `
  .drop{ transform-box:view-box; animation-name:drop; }
  @keyframes drop{ 0%, 8%{ transform:translateY(-48px); opacity:0; } 12%{ opacity:1; } 25%{ transform:none; } 28%{ transform:translateY(-3px); } 31%, 100%{ transform:none; opacity:1; } }
  .flL{ transform-origin:0% 50%; animation-name:flL; }
  @keyframes flL{ 0%, 34%{ transform:scaleX(0); } 43%, 100%{ transform:scaleX(1); } }
  .flR{ transform-origin:100% 50%; animation-name:flR; }
  @keyframes flR{ 0%, 39%{ transform:scaleX(0); } 48%, 100%{ transform:scaleX(1); } }
  .tape{ stroke-dasharray:1; animation-name:tape; }
  @keyframes tape{ 0%, 50%{ stroke-dashoffset:1; } 56%, 100%{ stroke-dashoffset:0; } }
  .seal{ transform-origin:50% 50%; animation-name:pop; }
  @keyframes pop{ 0%, 58%{ transform:scale(0); } 63%{ transform:scale(1.35); } 67%, 100%{ transform:scale(1); } }
  .label{ animation-name:label; }
  @keyframes label{ 0%, 68%{ transform:translateX(12px); opacity:0; } 74%, 100%{ transform:none; opacity:1; } }
  .hop{ transform-box:view-box; animation-name:hop; }
  @keyframes hop{ 0%, 77%{ transform:none; } 81%{ transform:translate(2px, -7px) rotate(1deg); } 85%{ transform:none; } 87%{ transform:translateY(-2px); } 89%, 100%{ transform:none; } }
  .whoosh{ stroke-dasharray:1; animation-name:whoosh; }
  @keyframes whoosh{ 0%, 79%{ stroke-dashoffset:1; opacity:1; } 85%{ stroke-dashoffset:0; opacity:1; } 92%, 100%{ stroke-dashoffset:0; opacity:0; } }
  .tw{ transform-origin:50% 50%; animation-name:tw; }
  @keyframes tw{ 0%, 100%{ transform:scale(1); } 50%{ transform:scale(.4); } }`, `
  <ellipse cx="60" cy="108" rx="44" ry="5" fill="${C.ink}" opacity=".14" filter="url(#ssh)"/>
  <g stroke="${C.inkSoft}" stroke-width="1.4" stroke-linecap="round" opacity=".6"><path class="a whoosh" pathLength="1" d="M14 70 H4"/><path class="a whoosh" pathLength="1" d="M16 80 H2"/><path class="a whoosh" pathLength="1" d="M14 90 H6"/></g>
  <g class="a hop">
    <path d="M22 50 L60 38 L98 50 L60 62 Z" fill="#8F6A3C"/>
    <g class="a drop">
      <path d="M52.5 51 C51.5 40 68.5 40 67.5 51" stroke="#D8CDB5" stroke-width="3" fill="none"/>
      <path d="M47 50 H73 L75 77 H45 Z" fill="#F4EEE2"/><rect x="51" y="54" width="18" height="15" fill="${C.ochre100}"/><circle cx="64" cy="58" r="3" fill="${C.ochre600}"/><path d="M51 66 Q56 60 60 63 Q64 59 69 65 V69 H51 Z" fill="${C.blue600}"/>
    </g>
    <path d="M22 50 L60 62 V104 L22 92 Z" fill="#C79A63"/>
    <path d="M60 62 L98 50 V92 L60 104 Z" fill="#B3854F"/>
    <g stroke="#7a5a33" stroke-width="1.3" fill="none"><path d="M41 56 V98"/><path d="M79 56 V98"/></g>
    <path class="a flL" d="M22 50 L60 38 L60 62 Z" fill="#D6AE78"/>
    <path class="a flR" d="M98 50 L60 38 L60 62 Z" fill="#CBA06A"/>
    <path class="a tape" pathLength="1" d="M60 38 L60 62 V104" stroke="#E2C493" stroke-width="5" fill="none" opacity=".9"/>
    <g class="a seal"><circle cx="60" cy="83" r="7" fill="${C.cherry600}" filter="url(#srough)"/><circle cx="60" cy="83" r="4" fill="none" stroke="${C.cherry800}" stroke-width="1"/></g>
    <g class="a label"><g transform="rotate(-10 90 92)"><rect x="78" y="84" width="22" height="13" rx="1" fill="#FBF8F1"/><path d="M81 89 h14 M81 93 h9" stroke="${C.inkSoft}" stroke-width=".9"/></g></g>
  </g>
  ${sparkle(102, 22, 4, C.ochre600, 'a tw')}${sparkle(16, 28, 2.6, C.cherry300, 'a tw')}`);

// ---------- 404: "404" gets painted on the easel, a tipped paint jar leaves footprints walking off ----------
const LOST_CSS = `
  .o{ animation-fill-mode:both; animation-timing-function:cubic-bezier(.5,0,.3,1); transform-box:fill-box; }
  .draw{ stroke-dasharray:1; animation-name:draw; }
  @keyframes draw{ from{ stroke-dashoffset:1; } to{ stroke-dashoffset:0; } }
  .d1{ animation-delay:.25s; animation-duration:.8s; } .d2{ animation-delay:1.05s; animation-duration:.65s; } .d3{ animation-delay:2.05s; animation-duration:.8s; }
  .ray{ stroke-dasharray:1; animation:draw .25s ease-out both; }
  .spin{ transform-origin:50% 50%; animation:spin 30s linear 2s infinite; }
  @keyframes spin{ to{ transform:rotate(360deg); } }
  .drip{ stroke-dasharray:1; animation:draw .5s ease-in 2.9s both; }
  .drop{ animation:drop 1.6s cubic-bezier(.55,0,1,.45) 3.35s infinite; }
  @keyframes drop{ 0%{ transform:translateY(0) scale(.4); opacity:0; } 10%{ transform:translateY(0) scale(1); opacity:1; } 60%{ transform:translateY(86px) scaleY(1.15); opacity:1; } 64%, 100%{ transform:translateY(90px) scale(1.4, .2); opacity:0; } }
  .step{ animation:step 4.2s ease-in-out infinite; }
  @keyframes step{ 0%{ opacity:0; transform:translateY(2px); } 8%, 70%{ opacity:1; transform:none; } 92%, 100%{ opacity:0; } }
  .spill{ transform-origin:0% 50%; animation:spill .7s cubic-bezier(.3,.7,.4,1) .4s both; }
  @keyframes spill{ from{ transform:scaleX(.1); } }
  @media (prefers-reduced-motion: reduce){ *{ animation:none !important; } .step{ opacity:1; } .drop{ opacity:0; } }`;
const LOST = (() => {
  const rays = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const [c, n] = [Math.cos(a), Math.sin(a)];
    return `<line class="ray" style="animation-delay:${(1.65 + i * 0.04).toFixed(2)}s" pathLength="1" x1="${r1(180 + c * 33)}" y1="${r1(96 + n * 33)}" x2="${r1(180 + c * 41)}" y2="${r1(96 + n * 41)}"/>`;
  }).join('');
  const steps = Array.from({ length: 10 }, (_, i) => {
    const x = 112 + i * 24;
    const y = i % 2 ? 233 : 227;
    return `<g class="step" style="animation-delay:${(1.2 + i * 0.26).toFixed(2)}s" fill="${C.cherry600}" opacity=".85"><ellipse cx="${x + 2}" cy="${y}" rx="4.6" ry="2.3"/><ellipse cx="${x - 5.4}" cy="${y}" rx="2.2" ry="1.9"/></g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 250" width="720" height="500" role="img" aria-label="A 404 painted on an easel, with painted footprints wandering off"><defs>${paintDefs('l')}<filter id="lsh" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3"/></filter></defs><style>${LOST_CSS}</style>
  <path d="M14 236 Q60 222 180 223 Q300 221 348 235 Q300 247 180 247 Q56 248 14 236 Z" fill="${C.ochre100}" opacity=".55" filter="url(#lrough)"/>
  <ellipse cx="180" cy="236" rx="160" ry="6" fill="${C.ink}" opacity=".1" filter="url(#lsh)"/>
  <g stroke="#8a5a17" stroke-width="5" stroke-linecap="round"><path d="M180 18 L136 234"/><path d="M180 18 L226 234"/></g>
  <path d="M180 18 L183 228" stroke="#6f4812" stroke-width="4" stroke-linecap="round"/>
  <rect x="80" y="32" width="200" height="132" rx="4" fill="#2f2a26"/>
  <rect x="87" y="39" width="186" height="118" rx="2" fill="${C.paper}"/>
  <rect x="87" y="39" width="186" height="118" filter="url(#lgrain)" opacity=".6"/>
  <rect x="74" y="162" width="212" height="8" rx="2.5" fill="#8a5a17"/>
  <g fill="none" stroke-linecap="round" stroke-linejoin="round" filter="url(#lrough)">
    <path class="o draw d1" pathLength="1" d="M120 62 L99 110 H148 M132 82 V132" stroke="${C.blue600}" stroke-width="13"/>
    <path class="o draw d2" pathLength="1" d="M180 74 a22 22 0 1 1 0 44 a22 22 0 1 1 0 -44" stroke="${C.ochre600}" stroke-width="13"/>
    <path class="o draw d3" pathLength="1" d="M242 62 L221 110 H270 M254 82 V132" stroke="${C.cherry600}" stroke-width="13"/>
  </g>
  <g class="spin"><g stroke="${C.ochre600}" stroke-width="3" stroke-linecap="round">${rays}</g></g>
  <path class="drip" pathLength="1" d="M254 138 V150" stroke="${C.cherry600}" stroke-width="5" stroke-linecap="round"/>
  <ellipse class="drop o" cx="254" cy="154" rx="3" ry="4" fill="${C.cherry600}"/>
  <g transform="translate(62 214) rotate(-72)"><rect x="-10" y="-13" width="20" height="24" rx="3" fill="#E9E2D3" stroke="#cfc4b2" stroke-width="1"/><rect x="-11" y="-16" width="22" height="5" rx="1.5" fill="#bfb6a6"/><rect x="-10" y="-4" width="20" height="9" fill="${C.cherry600}" opacity=".9"/></g>
  <path class="spill o" d="M76 226 Q86 218 100 222 Q112 224 108 231 Q96 236 80 233 Q70 231 76 226 Z" fill="${C.cherry600}" filter="url(#lrough)"/>
  ${steps}
  <path d="M310 40 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 Z" fill="${C.ochre600}"/><path d="M50 70 l1.5 3.6 3.6 1.5 -3.6 1.5 -1.5 3.6 -1.5 -3.6 -3.6 -1.5 3.6 -1.5 Z" fill="${C.cherry300}"/>
</svg>`;
})();

// ---------- June in her studio (304 × 218) ----------
const SKIN = '#C98E6B';
const SKIN_D = '#B57A58';
const HAIR = '#2B211C';
const SHIRT = '#7D97B8';
const SHIRT_D = '#6A84A6';
const PANTS = '#B9A57E';
const PANTS_D = '#A48F68';

const JUNE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 304 218" width="608" height="436" role="img" aria-label="June painting a tote at her easel"><defs>${paintDefs('j')}
  <filter id="jsh" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3"/></filter>
  <clipPath id="jcanvas"><rect x="176" y="50" width="70" height="88" rx="2"/></clipPath></defs>
  <path d="M18 204 Q56 190 150 191 Q250 189 290 203 Q252 214 150 214 Q48 215 18 204 Z" fill="${C.ochre100}" opacity=".55" filter="url(#jrough)"/>
  <ellipse cx="150" cy="203" rx="118" ry="5" fill="${C.ink}" opacity=".12" filter="url(#jsh)"/>

  <g stroke="#8a5a17" stroke-width="4" stroke-linecap="round"><path d="M211 34 L182 202"/><path d="M211 34 L242 202"/></g>
  <path d="M211 34 L214 196" stroke="#6f4812" stroke-width="3.4" stroke-linecap="round"/>
  <rect x="170" y="44" width="82" height="100" rx="3" fill="#2f2a26"/>
  <rect x="176" y="50" width="70" height="88" rx="2" fill="${C.paper}"/>
  <g clip-path="url(#jcanvas)">
    <path d="M190 64 H232 L236 132 H186 Z" fill="${C.canvas}"/><path d="M198 64 C196 50 226 50 224 64" stroke="#D8CDB5" stroke-width="4" fill="none"/>
    <rect x="194" y="78" width="34" height="42" fill="${C.ochre100}"/><circle cx="214" cy="92" r="6" fill="${C.ochre600}"/>
    <path d="M194 112 Q204 100 212 106 Q220 98 228 108 V120 H194 Z" fill="${C.blue600}"/>
  </g>
  <rect x="166" y="142" width="90" height="6" rx="2" fill="#8a5a17"/>
  <g><rect x="174" y="136" width="5" height="7" rx="1" fill="${C.cherry600}"/><rect x="182" y="134" width="5" height="9" rx="1" fill="${C.blue600}"/></g>

  <g>
    <path d="M86 132 L80 194" stroke="${PANTS_D}" stroke-width="14" stroke-linecap="round"/>
    <path d="M100 132 L110 194" stroke="${PANTS}" stroke-width="14" stroke-linecap="round"/>
    <path d="M72 196 Q72 188 82 189 L90 191 Q92 199 84 199 H74 Z" fill="${C.paper}" stroke="#d8cfbf" stroke-width="1"/>
    <path d="M104 196 Q104 188 114 189 L124 192 Q125 199 116 199 H106 Z" fill="${C.paper}" stroke="#d8cfbf" stroke-width="1"/>
    <path d="M80 102 L74 128 Q86 134 96 124" stroke="${SHIRT_D}" stroke-width="11" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="99" cy="122" r="5" fill="${SKIN_D}"/>
    <g transform="rotate(-14 106 124)"><ellipse cx="108" cy="126" rx="17" ry="10" fill="#E9D7B4"/><circle cx="114" cy="124" r="3.4" fill="#ffffff" opacity=".6"/>
      <circle cx="100" cy="122" r="2.6" fill="${C.cherry600}"/><circle cx="106" cy="119" r="2.4" fill="${C.ochre600}"/><circle cx="114" cy="120" r="2.4" fill="${C.blue600}"/><circle cx="118" cy="128" r="2.4" fill="${C.sage600}"/></g>
    <path d="M78 80 Q93 70 108 80 L112 136 Q94 142 76 136 Z" fill="${SHIRT}"/>
    <path d="M78 80 Q84 76 90 75 L86 138 Q80 137 76 136 Z" fill="${SHIRT_D}" opacity=".6"/>
    <path d="M89 74 L93 84 L98 74" fill="none" stroke="${SHIRT_D}" stroke-width="1.4" stroke-linejoin="round"/>
    <rect x="89" y="64" width="9" height="12" rx="3" fill="${SKIN_D}"/>
    <path d="M104 86 L124 100 L146 84" stroke="${SHIRT}" stroke-width="11" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M126 98 L146 84" stroke="${SKIN}" stroke-width="8" fill="none" stroke-linecap="round"/>
    <circle cx="148" cy="82" r="5" fill="${SKIN}"/>
    <path d="M148 82 L176 66" stroke="#5a3a1e" stroke-width="2.4" stroke-linecap="round"/><path d="M174 67 L182 62.5" stroke="${C.cherry600}" stroke-width="3" stroke-linecap="round"/>
    <circle cx="96" cy="50" r="15" fill="${SKIN}"/>
    <path d="M110 50 q4 2 1 5" fill="${SKIN}"/>
    <path d="M81 52 Q78 32 96 32 Q108 32 111 42 Q100 40 94 46 Q90 52 92 60 Q84 62 81 52 Z" fill="${HAIR}"/>
    <circle cx="82" cy="34" r="8.5" fill="${HAIR}"/><path d="M86 30 Q90 36 86 41" stroke="${C.cherry600}" stroke-width="2" fill="none" stroke-linecap="round"/>
    <ellipse cx="93" cy="52" rx="2.6" ry="3.6" fill="${SKIN_D}"/>
    <path d="M104 47 q2 -1.4 4 0" stroke="${HAIR}" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <ellipse cx="104" cy="56" rx="3.2" ry="2" fill="${C.cherry300}" opacity=".55"/>
  </g>

  <g transform="translate(262 150)"><path d="M-12 26 L-9 50 H9 L12 26 Z" fill="${C.cherry600}"/><path d="M-13 24 H13 V29 H-13 Z" fill="${C.cherry800}"/>
    <g fill="${C.sage600}" filter="url(#jrough)"><path d="M0 24 Q-20 10 -16 -10 Q-2 2 0 24 Z"/><path d="M0 24 Q16 4 12 -18 Q-2 -2 0 24 Z"/><path d="M0 24 Q22 18 26 2 Q8 6 0 24 Z"/></g>
    <g stroke="${C.sage800}" stroke-width=".9" fill="none"><path d="M0 24 Q-10 8 -14 -6"/><path d="M0 24 Q8 4 11 -14"/></g></g>
  <g transform="translate(140 186)"><rect x="0" y="0" width="12" height="14" rx="2" fill="#dfe3f0" opacity=".9"/><g stroke-linecap="round"><path d="M4 2 L1 -16" stroke="${C.ochre800}" stroke-width="1.8"/><path d="M8 2 L12 -14" stroke="${C.ochre800}" stroke-width="1.8"/></g><path d="M1 -16 L0 -20" stroke="${C.blue600}" stroke-width="2.4" stroke-linecap="round"/><path d="M12 -14 L13 -18" stroke="${C.cherry600}" stroke-width="2.4" stroke-linecap="round"/></g>
  <path d="M40 30 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6 -4 -4 -1.6 4 -1.6 Z" fill="${C.ochre600}"/><path d="M150 30 l1.2 3 3 1.2 -3 1.2 -1.2 3 -1.2 -3 -3 -1.2 3 -1.2 Z" fill="${C.cherry300}"/>
</svg>`;

// ---------- Favicon: a brush-painted "A" whose crossbar is the brand's cherry paint dot ----------
const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>
  <filter id="r" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".12" numOctaves="2" seed="9" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="1.8" xChannelSelector="R" yChannelSelector="G"/></filter>
  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2B2520"/><stop offset="1" stop-color="${C.ink}"/></linearGradient></defs>
  <rect width="64" height="64" rx="15" fill="url(#g)"/>
  <g fill="#F4E9D3" filter="url(#r)">
    <path d="M12.5 53.5 C17 40 23 25 29.6 11.4 C30.8 9.6 33.8 10 34.2 12.2 C29.4 25.4 25 39.4 22.2 53.4 Q17.2 56 12.5 53.5 Z"/>
    <path d="M30.6 13.4 C31.6 9.4 35.6 9.2 36.8 12.4 C41.4 25.2 46.4 38.4 52.6 51 C53.6 53.6 50.4 56.2 47.2 54.6 Q45.2 53.8 44.2 51.8 C40.2 40 35.4 26.4 30.6 13.4 Z"/>
  </g>
  <path d="M25.4 38.6 C25.6 33.4 30.6 31.6 34.6 32.4 C39.6 33.4 41.2 37.4 39.8 41 C38.2 44.8 33 45.6 29.4 44.4 C26.8 43.6 25.3 41.4 25.4 38.6 Z" fill="${C.cherry600}" filter="url(#r)"/>
  <circle cx="50.5" cy="15" r="3.1" fill="${C.ochre600}"/><circle cx="55.6" cy="21.4" r="1.4" fill="${C.ochre600}"/>
</svg>`;

// ---------- Canvas weave: the site background, tiled. Warp + weft fibres and a few slubs, all very faint. ----------
const fibre = (id, freq, seed, alpha) => `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2" seed="${seed}" stitchTiles="stitch" result="${id}n"/><feColorMatrix in="${id}n" values="0 0 0 0 .36  0 0 0 0 .29  0 0 0 0 .2  0 0 0 ${alpha} -${(alpha * 0.42).toFixed(3)}" result="${id}"/>`;
const CANVAS_TEXTURE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="240" height="240"><filter id="w" x="0" y="0" width="100%" height="100%">
  ${fibre('h', '1.4 .09', 3, 0.42)}${fibre('v', '.09 1.4', 8, 0.42)}${fibre('s', '.06', 13, 0.18)}
  <feMerge><feMergeNode in="s"/><feMergeNode in="h"/><feMergeNode in="v"/></feMerge></filter>
  <rect width="240" height="240" filter="url(#w)"/></svg>`;

// ---------- Painted-edge mask for dark bands (the marquee strip): wobbly brush edges top and bottom ----------
const STRIP_MASK = (() => {
  const r = rng(31);
  const W = 1200;
  const top = [];
  const bottom = [];
  for (let x = 0; x <= W; x += 24) {
    top.push(`${x} ${r1(3 + r() * 5 + Math.sin(x / 90) * 1.5)}`);
    bottom.push(`${W - x} ${r1(44 + r() * 5 - Math.sin(x / 70) * 1.5)}`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 52" preserveAspectRatio="none"><path d="M0 ${top[0].split(' ')[1]} L${top.join(' L')} L${bottom.join(' L')} Z" fill="#000"/></svg>`;
})();

// ---------- Crumpled paper: soft folds (lit noise) + a few sharp creases. Multiplied over paper colour. ----------
const CRUMPLE = (() => {
  const r = rng(44);
  const creases = Array.from({ length: 9 }, () => {
    const [x1, y1] = [r() * 600, r() * 600];
    const a = r() * Math.PI;
    const len = 180 + r() * 380;
    const [x2, y2] = [x1 + Math.cos(a) * len, y1 + Math.sin(a) * len];
    const w = r1(0.8 + r() * 1.4);
    return `<path d="M${r1(x1)} ${r1(y1)} L${r1(x2)} ${r1(y2)}" stroke="#fff" stroke-width="${w}" opacity=".55"/><path d="M${r1(x1 + 1.4)} ${r1(y1 + 1.4)} L${r1(x2 + 1.4)} ${r1(y2 + 1.4)}" stroke="#7a6a52" stroke-width="${w}" opacity=".12"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600" preserveAspectRatio="none"><filter id="c" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".009" numOctaves="5" seed="17" result="n"/><feDiffuseLighting in="n" surfaceScale="5" lighting-color="#fff" diffuseConstant="1.1" result="l"><feDistantLight azimuth="225" elevation="50"/></feDiffuseLighting><feColorMatrix in="l" values=".3 0 0 0 .71  .3 0 0 0 .69  .3 0 0 0 .66  0 0 0 0 1"/></filter><rect width="600" height="600" filter="url(#c)"/><g fill="none" stroke-linecap="round">${creases}</g></svg>`;
})();

// ---------- Postage stamp (perforated edge, tiny painted sun scene) + postmark ----------
const STAMP = (() => {
  const W = 52; const H = 62; const rad = 2.1; const step = 5.2;
  let holes = '';
  for (let x = step / 2; x < W; x += step) holes += `<circle cx="${r1(x)}" cy="0" r="${rad}"/><circle cx="${r1(x)}" cy="${H}" r="${rad}"/>`;
  for (let y = step / 2; y < H; y += step) holes += `<circle cx="0" cy="${r1(y)}" r="${rad}"/><circle cx="${W}" cy="${r1(y)}" r="${rad}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 -3 ${W + 6} ${H + 6}" width="${(W + 6) * 2}" height="${(H + 6) * 2}"><defs><mask id="m"><rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/><g fill="#000">${holes}</g></mask></defs>
  <g mask="url(#m)"><rect x="0" y="0" width="${W}" height="${H}" fill="#FBF8F1"/>
    <rect x="5" y="5" width="${W - 10}" height="${H - 17}" fill="${C.ochre100}"/>
    <circle cx="${W / 2 + 6}" cy="20" r="7" fill="${C.ochre600}"/>
    <path d="M5 40 Q15 28 24 34 Q34 26 ${W - 5} 36 V${H - 12} H5 Z" fill="${C.blue600}"/>
    <path d="M5 46 Q22 40 ${W - 5} 44 V${H - 12} H5 Z" fill="${C.blue800}"/>
    <text x="7" y="${H - 4}" font-family="Georgia, serif" font-style="italic" font-size="7" fill="${C.cherry600}">J</text>
    <text x="${W - 7}" y="${H - 4}" text-anchor="end" font-family="Georgia, serif" font-size="5.5" fill="${C.inkSoft}">₹ 1</text>
  </g></svg>`;
})();
const POSTMARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60" width="240" height="120" fill="none" stroke="${C.ink}" stroke-linecap="round" opacity=".55">
  <circle cx="30" cy="30" r="20" stroke-width="1.3"/><circle cx="30" cy="30" r="15" stroke-width=".7"/>
  <text x="30" y="27" text-anchor="middle" font-family="Georgia, serif" font-size="6" fill="${C.ink}" stroke="none">ARTORA</text><text x="30" y="36" text-anchor="middle" font-family="Georgia, serif" font-size="5" fill="${C.ink}" stroke="none">STUDIO</text>
  ${[18, 26, 34, 42].map((y) => `<path d="M54 ${y} q8 -4 16 0 t16 0 t16 0 t16 0" stroke-width="1.2"/>`).join('')}
</svg>`;

// ---------- Gift card product images: a kraft envelope with a painted card slipping out ----------
const giftCardArt = (amount, art) => {
  const a = ART[art]('g');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 400" width="640" height="800" role="img" aria-label="Artora gift card ₹${amount}"><defs>${toteDefs('t')}${paintDefs('g')}${a.defs}
    <filter id="gsh" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="6"/></filter></defs>
  <rect width="320" height="400" fill="url(#tbg)"/>
  <ellipse cx="160" cy="352" rx="118" ry="9" fill="#3b2f22" opacity=".16" filter="url(#tblurS)"/>
  <g transform="rotate(-8 160 170)">
    <rect x="70" y="60" width="180" height="230" rx="8" fill="#fff" filter="url(#gsh)" opacity=".35"/>
    <rect x="70" y="60" width="180" height="230" rx="8" fill="#FBF8F1"/>
    <svg x="82" y="72" width="156" height="150" viewBox="0 0 200 250" preserveAspectRatio="xMidYMid slice">${a.body}</svg>
    <text x="160" y="252" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="15" fill="${C.ink}">Artora gift card</text>
    <text x="160" y="276" text-anchor="middle" font-family="Georgia, serif" font-size="20" font-weight="700" fill="${C.cherry600}">₹${amount.toLocaleString('en-IN')}</text>
  </g>
  <path d="M46 214 H274 V340 Q274 346 268 346 H52 Q46 346 46 340 Z" fill="#D9B88A"/>
  <path d="M46 214 L160 286 L274 214" fill="#E6CB9F"/><path d="M46 346 L132 282 M274 346 L188 282" stroke="#BF9C68" stroke-width="1.4"/>
  <rect x="46" y="214" width="228" height="132" filter="url(#tweave)" opacity=".6"/>
  <circle cx="160" cy="286" r="15" fill="${C.cherry600}" filter="url(#grough)"/><path d="M154 286 h12 M160 280 v12" stroke="${C.cherry800}" stroke-width="2"/>
  <path d="M206 300 q16 -10 30 4" stroke="${C.ochre800}" stroke-width="1.6" fill="none"/></svg>`;
};

// ---------- Write everything ----------
const TOTES = [
  ['sunday-sun', 'sunday'], ['movie-night', 'movie'], ['pawprint-picnic', 'pet'], ['turtle-garden', 'nature'],
  ['city-of-lights', 'skyline'], ['softly-softly', 'words'], ['heart-on-a-sleeve', 'couple'], ['starlit-fandom', 'fandom'],
  ['sunflower-pouch', 'nature', 'pouch'],
];

const ART_FILES = { sunday: 'sunday', movie: 'movie', pet: 'pet', nature: 'nature', skyline: 'skyline', words: 'words', couple: 'couple', fandom: 'fandom', custom: 'custom' };
Object.entries(ART_FILES).forEach(([name, file]) => out(`public/assets/art/${file}.svg`, artSvg(name)));
TOTES.forEach(([slug, art, kind = 'tote']) => {
  out(`public/assets/totes/${slug}.svg`, toteSvg(slug, art, { kind }));
  out(`public/assets/totes/${slug}-back.svg`, toteSvg(slug, art, { kind, detail: true }));
});
[['step-idea', STEP_IDEA], ['step-sketch', STEP_SKETCH], ['step-ship', STEP_SHIP]].forEach(([name, svg]) => {
  out(`public/assets/illustrations/${name}.svg`, svg);
  out(`public/assets/illustrations/${name}-still.svg`, still(svg));
});
out('public/assets/june-character.svg', JUNE);
out('public/assets/illustrations/lost.svg', LOST);
out('public/assets/illustrations/gift-card-500.svg', giftCardArt(500, 'couple'));
out('public/assets/illustrations/gift-card-1000.svg', giftCardArt(1000, 'sunday'));
out('public/assets/favicon.svg', FAVICON);
out('public/assets/textures/canvas.svg', CANVAS_TEXTURE);
out('public/assets/textures/strip-mask.svg', STRIP_MASK);
out('public/assets/textures/crumple.svg', CRUMPLE);
out('public/assets/illustrations/stamp.svg', STAMP);
out('public/assets/illustrations/postmark.svg', POSTMARK);

// Hero tote lives inline in the home page so CSS can animate the sun, rays, cloud and birds.
const indexFile = path.join(ROOT, 'views/index.html');
const index = fs.readFileSync(indexFile, 'utf8');
const START = '<!-- hero-tote:start -->';
const END = '<!-- hero-tote:end -->';
const start = index.indexOf(START);
const end = index.indexOf(END);
if (start === -1 || end === -1) throw new Error('views/index.html is missing the hero-tote markers.');
fs.writeFileSync(indexFile, index.slice(0, start + START.length) + heroSvg() + index.slice(end));

console.log('Illustrations built.');
