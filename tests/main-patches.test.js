// Menguji dua patch M1.0b pada main.js. Jalankan:  node --test tests/
// Pakai MAIN_JS=<berkas> untuk menguji versi lain (mis. versi sebelum patch).
'use strict';
const test = require('node:test'), assert = require('node:assert'), http = require('http'), fs = require('fs'), path = require('path');
const { extractFn } = require('./helpers/extract');
const SRC = fs.readFileSync(process.env.MAIN_JS || path.join(__dirname, '..', 'main.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

test('proxy: klien memutus -> permintaan hulu (llama-server) ikut dihentikan, tanpa crash', async () => {
  const errors = []; const onErr = (e) => errors.push(e); process.on('uncaughtException', onErr);
  let upstreamClosedAt = null, wrote = 0;
  const upstream = http.createServer((req, res) => {           // llama-server palsu: mengalirkan potongan tiap 50 ms hingga 4 detik
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const iv = setInterval(() => { wrote++; res.write('data: x\n\n'); }, 50);
    res.on('close', () => { upstreamClosedAt = Date.now(); clearInterval(iv); });
    setTimeout(() => { clearInterval(iv); res.end(); }, 4000);
  });
  const upPort = await listen(upstream);
  const proxy = new Function('http', 'LLAMA_PORT', extractFn(SRC, 'proxy') + '\nreturn proxy;')(http, upPort);
  const front = http.createServer((req, res) => proxy(req, res));
  const fPort = await listen(front);
  const ctrl = new AbortController(); let got = 0;
  const p = fetch(`http://127.0.0.1:${fPort}/v1/chat/completions`, { method: 'POST', body: '{}', signal: ctrl.signal })
    .then(async (r) => { const rd = r.body.getReader(); for (;;) { const { done } = await rd.read(); if (done) break; if (++got === 3) ctrl.abort(); } }).catch(() => {});
  await p; const t0 = Date.now();
  await sleep(700);
  process.removeListener('uncaughtException', onErr);
  front.close(); upstream.close();
  assert.ok(upstreamClosedAt !== null, 'hulu TIDAK ditutup setelah klien memutus (generasi akan terus berjalan)');
  assert.ok(upstreamClosedAt - t0 < 600, 'hulu ditutup terlalu lambat');
  assert.deepStrictEqual(errors.map(String), [], 'ada exception tak tertangani');
});

test('proxy: hulu mati -> 503 tanpa crash', async () => {
  const proxy = new Function('http', 'LLAMA_PORT', extractFn(SRC, 'proxy') + '\nreturn proxy;')(http, 1); // port 1: tidak ada yang mendengar
  const front = http.createServer((req, res) => proxy(req, res)); const fPort = await listen(front);
  const r = await fetch(`http://127.0.0.1:${fPort}/v1/x`, { method: 'POST', body: '{}' });
  assert.strictEqual(r.status, 503); front.close();
});

test('listenWeb: memakai port tetap bila bebas, cadangan port acak bila bentrok', async () => {
  const fn = new Function('cfg', 'console', extractFn(SRC, 'listenWeb') + '\nreturn listenWeb;');
  // port tetap bebas
  const probe = http.createServer(); const free = await listen(probe); probe.close(); await sleep(50);
  const a = http.createServer(); const pa = await fn({ webPort: free }, console)(a);
  assert.strictEqual(pa, free, 'harus memakai port tetap yang diminta'); a.close(); await sleep(50);
  // port tetap bentrok
  const blocker = http.createServer(); const busy = await listen(blocker);
  const warns = []; const b = http.createServer();
  const pb = await fn({ webPort: busy }, { warn: (...x) => warns.push(x.join(' ')), log() {} })(b);
  assert.notStrictEqual(pb, busy); assert.ok(pb > 0); assert.ok(warns.length >= 1, 'harus memberi peringatan');
  b.close(); blocker.close();
});
