// One-off script to generate PWA manifest icons from the real Eltama logo.
// Not wired into build — run manually if the logo or icon sizes ever change.
const sharp = require('sharp');
const path = require('path');

const LOGO = 'C:/SynologyDrive/COMPUTER/Downloads/erpi-epi/erp-epi-1/src/lib/assets/logo-eltama.png';
const OUT_DIR = path.join(__dirname, '..', 'static', 'icons');
const THEME_BG = { r: 0x1f, g: 0x65, b: 0x92, alpha: 1 };

// logo-eltama.png has an opaque white background baked in (not real transparency) —
// key out near-white pixels so it composites cleanly onto the theme-color background.
async function transparentLogo() {
  const { data, info } = await sharp(LOGO).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const WHITE_THRESHOLD = 245;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] >= WHITE_THRESHOLD && data[i + 1] >= WHITE_THRESHOLD && data[i + 2] >= WHITE_THRESHOLD) {
      data[i + 3] = 0;
    }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

async function makeIcon({ size, logoFraction, filename, background, logoSource }) {
  const logoSize = Math.round(size * logoFraction);
  const logoBuf = await sharp(logoSource)
    .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  await sharp({
    create: { width: size, height: size, channels: 4, background }
  })
    .composite([{ input: logoBuf, gravity: 'center' }])
    .png()
    .toFile(path.join(OUT_DIR, filename));

  console.log('wrote', filename);
}

(async () => {
  const logoSource = await transparentLogo();
  // 'any' icons: logo can fill most of the canvas.
  await makeIcon({ size: 192, logoFraction: 0.7, filename: 'icon-192.png', background: THEME_BG, logoSource });
  await makeIcon({ size: 512, logoFraction: 0.7, filename: 'icon-512.png', background: THEME_BG, logoSource });
  // Maskable: OS crops to a circle/squircle, so the logo must sit inside the ~safe zone
  // (roughly the middle 80% by spec, kept tighter here at 50% to be safe across crop shapes).
  await makeIcon({ size: 512, logoFraction: 0.5, filename: 'icon-512-maskable.png', background: THEME_BG, logoSource });
})();
