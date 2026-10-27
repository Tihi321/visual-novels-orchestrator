// PROD-01 helper: screenshot a built VN Studio game with headless Chrome.
//
//   node scripts/shot-game.mjs <projectSlug> [outPng] [--wait=6000] [--width=1280] [--height=720]
//
// Serves <dataDir>/projects/<slug>/game over 127.0.0.1 on a free port, loads game/index.html
// in headless Chrome, lets it settle, writes a PNG and prints its path. Everything runs in
// this node process; Chrome is spawned with stdio "ignore" (no pipes, so the DSH sandbox is
// not in the way).
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const opts = { wait: 6000, width: 1280, height: 720 };
const positional = [];
for (const a of args) {
  const m = /^--(wait|width|height)=(\d+)$/.exec(a);
  if (m) opts[m[1]] = Number(m[2]);
  else if (a === '--help' || a === '-h') { console.log('usage: node scripts/shot-game.mjs <projectSlug> [outPng] [--wait=ms] [--width=px] [--height=px]'); process.exit(0); }
  else if (a.startsWith('--')) { console.error(`unknown option ${a}`); process.exit(2); }
  else positional.push(a);
}
const slug = positional[0];
if (!slug) { console.error('usage: node scripts/shot-game.mjs <projectSlug> [outPng] [--wait=ms]'); process.exit(2); }

const dataDir = process.env.VNO_DATA_DIR || path.join(os.homedir(), 'VisualNovels');
const gameDir = path.join(dataDir, 'projects', slug, 'game');
if (!fs.existsSync(path.join(gameDir, 'index.html'))) {
  console.error(`no game at ${gameDir}\\index.html (is the project built?)`);
  process.exit(2);
}
const outPng = path.resolve(positional[1] || path.join(process.cwd(), '.claude', 'temp', 'prod01', `${slug}-title.png`));
await fsp.mkdir(path.dirname(outPng), { recursive: true });

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chrome = chromeCandidates.find((p) => fs.existsSync(p));
if (!chrome) { console.error('no Chrome/Edge found; set CHROME_PATH'); process.exit(2); }

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(gameDir, path.normalize(rel).replace(/^([/\\])+/, ''));
    if (!file.startsWith(gameDir)) { res.writeHead(403); res.end('forbidden'); return; }
    const buf = await fsp.readFile(file);
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    });
    res.end(buf);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});

await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).on('error', reject));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/index.html`;

const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'vno-shot-'));
if (fs.existsSync(outPng)) await fsp.rm(outPng);

const chromeArgs = [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--hide-scrollbars',
  '--mute-audio',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  `--user-data-dir=${profile}`,
  `--window-size=${opts.width},${opts.height}`,
  `--virtual-time-budget=${opts.wait}`,
  `--screenshot=${outPng}`,
  url,
];
console.log(`[shot] ${slug}: ${url}`);
const errLog = path.join(path.dirname(outPng), `${slug}-chrome.log`);
const errFd = fs.openSync(errLog, 'w');
const child = spawn(chrome, chromeArgs, { stdio: ['ignore', errFd, errFd], windowsHide: true });
const code = await new Promise((resolve) => {
  child.on('exit', resolve);
  child.on('error', (e) => { console.error(`chrome failed: ${e.message}`); resolve(-1); });
});
server.close();
await fsp.rm(profile, { recursive: true, force: true }).catch(() => {});

const stat = fs.existsSync(outPng) ? await fsp.stat(outPng) : null;
try { fs.closeSync(errFd); } catch {}
if (!stat || stat.size < 4096) {
  console.error(`[shot] no screenshot (chrome exit ${code}); log ${errLog}`);
  const tail = fs.existsSync(errLog) ? (await fsp.readFile(errLog, 'utf8')).trim().split(/\r?\n/).slice(-8).join('\n') : '';
  if (tail) console.error(tail);
  process.exit(1);
}
console.log(JSON.stringify({ slug, png: outPng, bytes: stat.size, chromeExit: code }, null, 2));
