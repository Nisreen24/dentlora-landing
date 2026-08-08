// Usage: node screenshot.mjs <url> [label] [--width=1440] [--height=1024] [--full]
// Saves to ./temporary screenshots/screenshot-N[-label].png (auto-incremented).
// puppeteer-core is not vendored here. Either `npm i puppeteer-core`, or point
// PUPPETEER_CORE at an absolute path to one installed elsewhere.
const { default: puppeteer } = await import(process.env.PUPPETEER_CORE ?? 'puppeteer-core');
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME =
  'C:/Users/\u0646\u0633\u0631\u064a\u0646\u0645\u062d\u0645\u062f\u0639\u0628\u062f\u0627\u0644\u0642\u0627\u062f\u0631\u0639\u0628/.cache/puppeteer/chrome/win64-150.0.7871.24/chrome-win64/chrome.exe';

const OUT_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'temporary screenshots');

const argv = process.argv.slice(2);
const flags = Object.fromEntries(
  argv.filter((a) => a.startsWith('--')).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const positional = argv.filter((a) => !a.startsWith('--'));
const url = positional[0] ?? 'http://localhost:3000';
const label = positional[1] ?? '';

const width = Number(flags.width ?? 1440);
const height = Number(flags.height ?? 1024);
const fullPage = Boolean(flags.full);

await mkdir(OUT_DIR, { recursive: true });
const existing = await readdir(OUT_DIR);
const next =
  existing
    .map((f) => Number(/^screenshot-(\d+)/.exec(f)?.[1] ?? 0))
    .reduce((a, b) => Math.max(a, b), 0) + 1;
const outPath = join(OUT_DIR, `screenshot-${next}${label ? `-${label}` : ''}.png`);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--force-device-scale-factor=1', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width, height, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
// Keep the layout viewport at the requested width — a visible scrollbar would
// otherwise shrink content by ~15px and skew reference comparisons.
await page.addStyleTag({
  content:
    'html{scrollbar-width:none}html::-webkit-scrollbar{width:0;height:0;display:none}' +
    // Collapse reveal timing so captures never catch a mid-transition frame, while still
    // exercising the real reveal logic (the class must genuinely be applied).
    '.reveal,.progress-fill{transition-duration:0s!important;transition-delay:0s!important}',
});
await page.evaluate(() => document.fonts.ready);

// The Tailwind Play CDN injects its stylesheet after load, which changes page height.
// Wait for the layout to stop moving before scrolling, or the scroll-through walks a
// shorter page than the one being captured and lower sections never reveal.
await page.evaluate(async () => {
  let last = -1;
  let stable = 0;
  while (stable < 4) {
    const h = document.documentElement.scrollHeight;
    stable = h === last ? stable + 1 : 0;
    last = h;
    await new Promise((r) => setTimeout(r, 120));
  }
});

// Scroll the whole page so scroll-driven reveals fire, then return to top.
await page.evaluate(async () => {
  // 'instant' matters: the page sets scroll-behavior:smooth, which would otherwise
  // animate each hop and leave the lower sections never scrolled into view.
  const step = Math.round(window.innerHeight * 0.7);
  const total = document.documentElement.scrollHeight;
  for (let y = 0; y < total; y += step) {
    window.scrollTo({ top: y, behavior: 'instant' });
    // long enough for the page's own reveal sweep to run at each stop, so the capture
    // reflects the real reveal logic rather than forcing the end state
    await new Promise((r) => setTimeout(r, 320));
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
});
if (flags.scrollTo) {
  await page.evaluate((y) => window.scrollTo(0, y), Number(flags.scrollTo));
}
await new Promise((r) => setTimeout(r, 1400));

const unrevealed = await page.evaluate(
  () => document.querySelectorAll('.reveal:not(.is-inview)').length
);
if (unrevealed) console.warn(`warning: ${unrevealed} .reveal element(s) still hidden at capture time`);

await page.screenshot({ path: outPath, fullPage });
await browser.close();

console.log(outPath);
