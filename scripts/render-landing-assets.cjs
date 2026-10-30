// Renders landing/og-image.png (1200x630) and the favicon PNGs. Run: node scripts/render-landing-assets.cjs
const { chromium } = require("playwright");
const path = require("path");
const root = path.resolve(__dirname, "..");
(async () => {
  const b = await chromium.launch();
  let p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  await p.goto("file://" + path.join(root, "scripts/landing-og.html"));
  await p.screenshot({ path: path.join(root, "landing/og-image.png") });
  const svg = "file://" + path.join(root, "landing/netio-logo.svg");
  for (const [n, s] of [["favicon-32.png", 32], ["apple-touch-icon.png", 180], ["icon-192.png", 192], ["icon-512.png", 512]]) {
    p = await b.newPage({ viewport: { width: s, height: s } });
    await p.goto(svg);
    await p.screenshot({ path: path.join(root, "landing", n), omitBackground: true });
  }
  await b.close();
})();
