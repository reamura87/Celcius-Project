// Celcius: Electron = jendela + server statis lokal + llama-server (model GGUF) + auto-update dari GitHub Releases
const { app, BrowserWindow, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path');
const { spawn } = require('child_process');
const cfg = require('./config.json');

const WEB = path.join(__dirname, 'web');
const LLAMA_PORT = cfg.llamaPort || 8089;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
let win, llama = null;

function findExe(dir) {
  if (!fs.existsSync(dir)) return null;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { const r = findExe(p); if (r) return r; }
    else if (f.name.toLowerCase() === 'llama-server.exe') return p;
  }
  return null;
}

// /v1/* diteruskan ke llama-server (satu origin, tanpa masalah CORS)
function proxy(req, res) {
  const pr = http.request({ host: '127.0.0.1', port: LLAMA_PORT, path: req.url, method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode, r.headers); r.pipe(res);
  });
  pr.on('error', () => { res.writeHead(503); res.end('mesin AI belum siap'); });
  req.pipe(pr);
}

function serve(req, res) {
  if (req.url.startsWith('/v1/')) return proxy(req, res);
  let rel = decodeURIComponent(req.url.split('?')[0]); if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(WEB, rel));
  if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  const size = fs.statSync(file).size, type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', rg = req.headers.range;
  if (rg) {                                   // dukungan Range agar video latar bisa loop/seek
    const m = /bytes=(\d*)-(\d*)/.exec(rg), s = m[1] ? +m[1] : 0, e = m[2] ? +m[2] : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${s}-${e}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': e - s + 1 });
    return fs.createReadStream(file, { start: s, end: e }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
  fs.createReadStream(file).pipe(res);
}

function download(url, dest, onP, hops = 0) {
  return new Promise((ok, fail) => {
    https.get(url, { headers: { 'User-Agent': 'celcius' } }, (r) => {
      if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location) {
        r.resume(); if (hops > 8) return fail(new Error('terlalu banyak redirect'));
        return ok(download(new URL(r.headers.location, url).href, dest, onP, hops + 1));
      }
      if (r.statusCode !== 200) { r.resume(); return fail(new Error('HTTP ' + r.statusCode)); }
      const total = +r.headers['content-length'] || 0; let got = 0;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const tmp = dest + '.part', out = fs.createWriteStream(tmp);
      r.on('data', (c) => { got += c.length; onP(got, total); });
      r.pipe(out); out.on('error', fail);
      out.on('finish', () => out.close(() => { fs.renameSync(tmp, dest); ok(); }));
    }).on('error', fail);
  });
}

async function ensureModel() {
  const mp = path.join(app.getPath('userData'), 'models', cfg.modelFile);
  if (fs.existsSync(mp)) return mp;
  if (cfg.modelUrl) {
    try {
      await download(cfg.modelUrl, mp, (g, t) => win.setTitle('Celcius — mengunduh model ' + (t ? Math.round(g / t * 100) + '%' : (g / 1048576 | 0) + ' MB')));
      win.setTitle('Celcius'); return mp;
    } catch (e) { dialog.showErrorBox('Unduh model gagal', String(e)); }
  }
  const r = await dialog.showOpenDialog(win, { title: 'Pilih file model (.gguf)', filters: [{ name: 'GGUF', extensions: ['gguf'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  fs.mkdirSync(path.dirname(mp), { recursive: true }); fs.copyFileSync(r.filePaths[0], mp); return mp;
}

function startLlama(mp) {
  const exe = findExe(app.isPackaged ? path.join(process.resourcesPath, 'llama') : path.join(__dirname, 'llama'));
  if (!exe || !mp) { console.warn('llama-server atau model tidak ditemukan'); return false; }
  llama = spawn(exe, ['-m', mp, '--host', '127.0.0.1', '--port', String(LLAMA_PORT), '-c', '4096', '-ngl', String(cfg.gpuLayers ?? 99)],
    { windowsHide: true, cwd: path.dirname(exe) });
  llama.stdout.on('data', (d) => process.stdout.write(d)); llama.stderr.on('data', (d) => process.stderr.write(d));
  llama.on('exit', () => { llama = null; });
  return true;
}

async function waitReady(ms = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const ok = await new Promise((r) => http.get({ host: '127.0.0.1', port: LLAMA_PORT, path: '/health' }, (x) => { x.resume(); r(x.statusCode === 200); }).on('error', () => r(false)));
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}

if (!app.requestSingleInstanceLock()) app.quit();
app.whenReady().then(async () => {
  win = new BrowserWindow({ width: 1280, height: 800, title: 'Celcius', backgroundColor: '#1e1e24',
    webPreferences: { contextIsolation: true, autoplayPolicy: 'no-user-gesture-required' } });
  win.setMenuBarVisibility(false);
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<body style="background:#1e1e24;color:#eee;font:18px system-ui;display:grid;place-items:center;height:100vh">Memuat Celcius…</body>'));
  const srv = http.createServer(serve);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const mp = await ensureModel();
  if (startLlama(mp)) await waitReady();
  win.loadURL(`http://127.0.0.1:${srv.address().port}/`);
  if (app.isPackaged) {
    autoUpdater.on('update-downloaded', async () => {
      const r = await dialog.showMessageBox(win, { message: 'Pembaruan Celcius siap dipasang.', buttons: ['Restart sekarang', 'Nanti'] });
      if (r.response === 0) autoUpdater.quitAndInstall();
    });
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }
});
app.on('before-quit', () => { if (llama) llama.kill(); });
app.on('window-all-closed', () => app.quit());