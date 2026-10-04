// Render driver: serves this folder, opens the page in headless Chromium, renders frames to PNG.
// Usage: node render.mjs --frames 0,30,60 --out preview
//        node render.mjs --range 0-299 --out frames
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')); }

const root = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));

let frames = [];
if (args.frames) frames = String(args.frames).split(',').map(Number);
else if (args.range) { const [a, b] = String(args.range).split('-').map(Number); for (let i = a; i <= b; i++) frames.push(i); }
else frames = [0];
if (args.mod) { const m = Number(args.mod), r = Number(args.rem || 0); frames = frames.filter((f) => f % m === r); }
const outDir = path.resolve(root, args.out || 'preview');
fs.mkdirSync(outDir, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.type(), m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/index.html`);
await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 180000 });
const err = await page.evaluate(() => window.__error);
if (err) { console.error(err); await browser.close(); server.close(); process.exit(1); }

const t0 = Date.now();
for (const f of frames) {
  const ts = Date.now();
  await page.evaluate((f) => window.renderFrame(f), f);
  const file = path.join(outDir, `f${String(f).padStart(4, '0')}.png`);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 1920, height: 1080 } });
  console.log(`frame ${f} ${(Date.now() - ts)}ms`);
}
console.log(`done ${frames.length} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await browser.close();
server.close();
