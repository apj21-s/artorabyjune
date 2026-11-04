// Renders the raster images the site needs from the SVG sources, using a local Chrome:
//   npm run illustrations:png            (set CHROME_PATH if Chrome isn't at /usr/bin/google-chrome)
// Writes: social share images (site + one per tote), email header/footer art, and
// pre-rendered WebP textures (cheaper to paint than live SVG filters). The output is committed,
// so hosting never needs Chrome.
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..', '..');
const PUB = path.join(ROOT, 'public');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const svg = (rel) => fs.readFileSync(path.join(PUB, rel), 'utf8');
const dataUri = (rel) => `data:image/svg+xml;base64,${Buffer.from(svg(rel)).toString('base64')}`;
const FONT = '<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&family=Caveat:wght@700&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet">';

async function main() {
  fs.mkdirSync(path.join(PUB, 'assets/og'), { recursive: true });
  fs.mkdirSync(path.join(PUB, 'assets/email'), { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.setDefaultTimeout(180000);

  async function shot(html, out, width, height, { type = 'png', transparent = false, quality } = {}) {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><head>${FONT}<style>html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;${transparent ? 'background:transparent' : ''}}</style></head><body>${html}</body></html>`, { waitUntil: 'load', timeout: 180000 });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(PUB, out), type, quality, omitBackground: transparent, clip: { x: 0, y: 0, width, height } });
    console.log('wrote', out);
  }

  // Textures as WebP (the CSS uses these; the SVGs stay as sources).
  await shot(`<div style="width:240px;height:240px;background:url(${dataUri('assets/textures/canvas.svg')})"></div>`, 'assets/textures/canvas.webp', 240, 240, { type: 'webp', transparent: true, quality: 82 });

  const weave = `background:#ECE4D2 url(${dataUri('assets/textures/canvas.svg')}) 0 0/240px`;
  const hills = `<svg viewBox="0 0 1440 130" preserveAspectRatio="none" style="position:absolute;left:0;right:0;bottom:0;width:100%;height:120px"><path d="M-20 60 Q180 14 380 46 Q600 82 820 34 Q1040 0 1240 40 Q1360 62 1460 30 V140 H-20 Z" fill="#8892c9"/><path d="M-20 52 Q360 30 720 50 Q1080 70 1460 42" fill="none" stroke="#C1443C" stroke-width="3" stroke-dasharray=".1 13" stroke-linecap="round"/><path d="M-20 92 Q220 52 470 78 Q720 104 960 66 Q1200 34 1460 70 V140 H-20 Z" fill="#3A4CA6"/><path d="M-20 118 Q300 92 640 108 Q980 124 1460 100 V140 H-20 Z" fill="#26337a"/></svg>`;

  // Site-wide share image.
  await shot(`<div style="position:relative;width:1200px;height:630px;${weave};font-family:'Space Grotesk',sans-serif;color:#221D19">
    <div style="position:absolute;left:84px;top:150px;width:600px">
      <div style="display:flex;align-items:center;gap:14px;font-weight:700;font-size:40px"><span style="width:20px;height:20px;border-radius:40% 60% 55% 45%;background:#C1443C"></span>Artora <span style="font-family:Caveat;font-size:46px">by June</span></div>
      <div style="margin-top:34px;font-weight:700;font-size:64px;line-height:1.04;letter-spacing:-.02em">Some moments deserve more than a photograph.</div>
      <div style="margin-top:26px;font-family:'IBM Plex Mono';font-size:20px;letter-spacing:.14em;text-transform:uppercase;color:#4a413a">Hand-painted totes · Made to order in India</div>
    </div>
    <img src="${dataUri('assets/totes/sunday-sun.svg')}" style="position:absolute;right:70px;top:40px;width:400px;height:500px;transform:rotate(3deg)">
    ${hills}</div>`, 'assets/og-image.png', 1200, 630);

  // One share image per tote (social networks can't show SVG).
  const totes = fs.readdirSync(path.join(PUB, 'assets/totes')).filter((f) => f.endsWith('.svg') && !f.includes('-back'));
  for (const file of totes) {
    const slug = file.replace('.svg', '');
    const title = slug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
    await shot(`<div style="position:relative;width:1200px;height:630px;${weave};font-family:'Space Grotesk',sans-serif;color:#221D19">
      <img src="${dataUri(`assets/totes/${file}`)}" style="position:absolute;left:90px;top:30px;width:456px;height:570px">
      <div style="position:absolute;left:640px;top:200px;width:480px">
        <div style="font-family:'IBM Plex Mono';font-size:20px;letter-spacing:.16em;text-transform:uppercase;color:#C1443C">Painted by hand · one of a kind</div>
        <div style="margin-top:18px;font-weight:700;font-size:72px;line-height:1">${title}</div>
        <div style="margin-top:26px;display:flex;align-items:center;gap:12px;font-weight:700;font-size:30px"><span style="width:14px;height:14px;border-radius:50%;background:#C1443C"></span>Artora <span style="font-family:Caveat;font-size:36px">by June</span></div>
      </div>${hills}</div>`, `assets/og/${slug}.png`, 1200, 630);
  }

  // Email art: the painted hills strip and the brushed "A" mark.
  await shot(`<div style="position:relative;width:1200px;height:120px">${hills}</div>`, 'assets/email/hills.png', 1200, 120, { transparent: true });
  await shot(`<img src="${dataUri('assets/favicon.svg')}" width="96" height="96">`, 'assets/email/mark.png', 96, 96, { transparent: true });

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
