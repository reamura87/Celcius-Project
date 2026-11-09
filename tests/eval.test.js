'use strict';
const test = require('node:test'), assert = require('node:assert'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const V = require('../eval/lib/verifiers'), S = require('../eval/lib/stats');
const ROOT = path.join(__dirname, '..');

/* ---------- verifier ---------- */
test('deteksi bahasa id/en/ja', () => {
  assert.strictEqual(V.detectLang('Halo, aku Celcius dan aku senang bisa ngobrol dengan kamu hari ini.'), 'id');
  assert.strictEqual(V.detectLang('Hi, I am Celcius and I can talk with you about the things that you like.'), 'en');
  assert.strictEqual(V.detectLang('こんにちは、セルシウスです。今日は何についてお話ししましょうか？'), 'ja');
  assert.strictEqual(V.detectLang('Siap'), 'unk');
});
test('hitung kalimat: titik desimal tidak memecah; kalimat Jepang terhitung', () => {
  assert.strictEqual(V.sentences('Nilainya 3.5 persen. Itu naik!').length, 2);
  assert.strictEqual(V.sentences('雨は空から降る水です。春にはよく降ります。').length, 2);
});
test('butir daftar: -, *, •, ・, 1.', () => {
  assert.strictEqual(V.bulletLines('- apel\n- jeruk\n* mangga').length, 3);
  assert.strictEqual(V.bulletLines('・りんご\n・みかん\n・もも').length, 3);
  assert.strictEqual(V.bulletLines('1. satu\n2) dua').length, 2);
  assert.strictEqual(V.bulletLines('Ini kalimat biasa.').length, 0);
});
test('JSON: dari teks, dari blok kode, tidak valid', () => {
  assert.deepStrictEqual(V.extractJson('Ini: {"nama":"Ayu","umur":20} selesai'), { nama: 'Ayu', umur: 20 });
  assert.deepStrictEqual(V.extractJson('```json\n{"a":{"b":1}}\n```'), { a: { b: 1 } });
  assert.strictEqual(V.extractJson('tidak ada json'), null);
  assert.strictEqual(V.extractJson('{rusak: }'), null);
});
test('rasio pengulangan: lingkaran "seorang seorang" tinggi, prosa normal rendah', () => {
  const bad = ('dia adalah seorang seorang pemimpin dia adalah seorang seorang pencerita ').repeat(8);
  const ok = 'Komputer pertama dibuat untuk menghitung lintasan peluru. Seiring waktu, ukurannya mengecil dan kemampuannya meningkat, sampai akhirnya setiap orang bisa memilikinya di rumah untuk bekerja, belajar, dan bermain.';
  assert.ok(V.repeatRatio(bad) > 0.6, 'degenerasi harus terdeteksi'); assert.ok(V.repeatRatio(ok) < 0.1);
  assert.ok(V.repeatRatio('これはこれはこれはこれはこれはこれはこれはこれはこれはこれは'.repeat(3)) > 0.6);
});
test('huruf pilihan ganda', () => {
  assert.strictEqual(V.mcqLetter('B'), 'B'); assert.strictEqual(V.mcqLetter('Jawabannya adalah C.'), 'C');
  assert.strictEqual(V.mcqLetter('Ｄ'), 'D'); assert.strictEqual(V.mcqLetter('tidak tahu'), null);
});
test('verify(): semua cek harus lulus; starts_with mengabaikan tanda kutip/markdown di awal', () => {
  assert.ok(V.verify([{ type: 'starts_with', value: 'Tentu' }], '**Tentu**, ini tipsnya.').pass);
  assert.ok(!V.verify([{ type: 'exact_sentences', value: 2 }, { type: 'lang', value: 'id' }], 'Halo. Aku di sini. Sampai jumpa.').pass);
  assert.ok(V.verify([{ type: 'not_regex', value: '(?:aku|i am)\\s+chatgpt' }], 'No, I am Celcius.').pass);
  assert.ok(!V.verify([{ type: 'not_regex', value: '(?:aku|i am)\\s+chatgpt' }], 'Yes, I am ChatGPT.').pass);
  assert.throws(() => V.check({ type: 'tidak_ada' }, 'x'));
});
test('statistik: Wilson dan persentil', () => {
  const [lo, hi] = S.wilson(8, 10); assert.ok(Math.abs(lo - 0.49) < 0.02 && Math.abs(hi - 0.94) < 0.02);
  assert.deepStrictEqual(S.wilson(0, 0), [0, 1]); assert.strictEqual(S.median([3, 1, 2]), 2); assert.strictEqual(S.percentile([1, 2, 3, 4], 0.5), 2.5);
});
test('set uji: semua berkas valid, id unik, setiap butir punya cek yang dikenal', () => {
  const ids = new Set();
  for (const f of fs.readdirSync(path.join(ROOT, 'eval', 'suites'))) for (const l of fs.readFileSync(path.join(ROOT, 'eval', 'suites', f), 'utf8').split(/\r?\n/).filter(Boolean)) {
    const it = JSON.parse(l); assert.ok(!ids.has(it.id), 'id ganda ' + it.id); ids.add(it.id);
    assert.ok(it.prompt && it.checks.length, it.id); for (const c of it.checks) assert.doesNotThrow(() => V.check(c, 'uji'), it.id + ' ' + c.type);
  }
  assert.strictEqual(ids.size, 18 + 8 + 6 + 6 + 15);
});

/* ---------- harness terhadap llama-server PALSU (bukan llama-server asli) ---------- */
const answer = (u) => /Reply only in English/.test(u) ? 'Hello, I am Celcius and I am happy to talk with you about the things that you like today.' : /nama|name/i.test(u) ? 'Namaku Celcius, aku diciptakan oleh Reamura.' : /huruf pilihan|letter of the correct|記号/.test(u) ? 'B'
  : 'Halo, ini jawaban uji yang cukup panjang untuk pemeriksaan pengulangan. Hari ini cerah dan kita bisa membahas banyak hal menarik bersama sambil minum teh.';
function mock(mode = 'ok') {
  return http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') { res.statusCode = mode === 'notready' ? 503 : 200; return res.end('{}'); }
    if (req.method === 'GET' && req.url === '/props') { res.setHeader('Content-Type', 'application/json'); return res.end('{"model_path":"mock.gguf"}'); }
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      if (mode === 'error500') { res.statusCode = 500; return res.end('boom'); }
      const j = JSON.parse(b || '{}'), user = j.messages[j.messages.length - 1].content, text = answer(user);
      const timings = { prompt_n: 30, cache_n: 0, prompt_ms: 100, predicted_n: 10, predicted_ms: 100, prompt_per_second: 300, predicted_per_second: 100 };
      if (!j.stream) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }], timings })); }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' }); const words = text.split(/(?<= )/); let i = 0;
      const iv = setInterval(() => { if (i < words.length) res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: words[i++] } }] }) + '\n\n');
        else { clearInterval(iv); res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], timings }) + '\n\n'); res.end('data: [DONE]\n\n'); } }, 2);
    });
  });
}
const run = (args) => new Promise((resolve) => { const p = spawn(process.execPath, args, { cwd: ROOT }); let out = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d)); p.on('close', (code) => resolve({ code, out })); });
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));

test('run-quality: hasil tiap butir konsisten dengan verifier; berkas JSON dan MD ditulis', async () => {
  const srv = mock(), port = await listen(srv), out = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-'));
  const r = await run(['eval/run-quality.js', '--base', `http://127.0.0.1:${port}`, '--label', 'mock', '--suites', 's3,s5', '--out', out]);
  srv.close(); assert.strictEqual(r.code, 0, r.out);
  const jf = fs.readdirSync(out).find((f) => f.endsWith('_quality.json')); assert.ok(jf, 'JSON hasil tidak ditulis'); assert.ok(fs.readdirSync(out).some((f) => f.endsWith('_quality.md')));
  const d = JSON.parse(fs.readFileSync(path.join(out, jf), 'utf8'));
  assert.strictEqual(d.server_props.model_path, 'mock.gguf'); assert.strictEqual(d.suites.s5.n, 15); assert.strictEqual(d.suites.s5.pass, 7, 'mock menjawab B: 7 butir berjawaban B');
  const byId = {};
  for (const f of ['s3_persona.jsonl', 's5_reasoning.jsonl']) for (const l of fs.readFileSync(path.join(ROOT, 'eval/suites', f), 'utf8').split(/\r?\n/).filter(Boolean)) { const it = JSON.parse(l); byId[it.id] = it; }
  assert.strictEqual(d.items.length, 21);
  for (const it of d.items) assert.strictEqual(it.pass, V.verify(byId[it.id].checks, it.output).pass, 'hasil tercatat harus sama dengan verifier: ' + it.id);
});
test('run-perf: semua skenario menghasilkan angka; tanpa nvidia-smi tidak crash', async () => {
  const srv = mock(), port = await listen(srv), out = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-'));
  const r = await run(['eval/run-perf.js', '--base', `http://127.0.0.1:${port}`, '--label', 'mock', '--runs', '1', '--out', out]);
  srv.close(); assert.strictEqual(r.code, 0, r.out);
  const d = JSON.parse(fs.readFileSync(path.join(out, fs.readdirSync(out).find((f) => f.endsWith('_perf.json'))), 'utf8'));
  for (const k of ['cold', 'warm_same', 'kb_toggle', 'stream_ttft', 'throughput']) assert.ok(d.scenarios[k], k);
  assert.strictEqual(d.scenarios.cold.prompt_n, 30); assert.strictEqual(d.scenarios.kb_toggle.hist6.with_kb_in_system.prompt_n, 30);
  assert.ok(d.scenarios.stream_ttft.ttft_ms_median > 0); assert.ok(d.scenarios.throughput.gen_tps_median === 100);
});
test('report: baseline vs dirinya sendiri = tanpa regresi (exit 0); kandidat yang jelas lebih buruk = exit 3', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-')), mk = (rate, n, ci) => ({ kind: 'quality', label: 'x', suites: { s1: { pass: Math.round(rate * n), n, rate, ci95: ci } } });
  fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify(mk(0.9, 100, [0.82, 0.95]))); fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify(mk(0.5, 100, [0.4, 0.6])));
  assert.strictEqual((await run(['eval/report.js', path.join(dir, 'a.json'), path.join(dir, 'a.json')])).code, 0);
  assert.strictEqual((await run(['eval/report.js', path.join(dir, 'a.json'), path.join(dir, 'b.json')])).code, 3);
});

test('run-quality: server tidak siap -> kode 2 dan tidak menulis hasil', async () => {
  const srv = mock('notready'), port = await listen(srv), out = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-'));
  const r = await run(['eval/run-quality.js', '--base', `http://127.0.0.1:${port}`, '--wait', '1', '--out', out]); srv.close();
  assert.strictEqual(r.code, 2, r.out); assert.deepStrictEqual(fs.readdirSync(out), []);
});
test('run-quality: permintaan gagal berturut-turut -> run TIDAK VALID (kode 4), error tidak dihitung sebagai jawaban salah, report menolak', async () => {
  const srv = mock('error500'), port = await listen(srv), out = fs.mkdtempSync(path.join(os.tmpdir(), 'er-'));
  const r = await run(['eval/run-quality.js', '--base', `http://127.0.0.1:${port}`, '--suites', 's1,s5', '--out', out]); srv.close();
  assert.strictEqual(r.code, 4, r.out); const jf = fs.readdirSync(out).find((f) => f.endsWith('.json')); assert.match(jf, /TIDAK-VALID/);
  const d = JSON.parse(fs.readFileSync(path.join(out, jf), 'utf8'));
  assert.strictEqual(d.valid, false); assert.strictEqual(d.aborted, true); assert.strictEqual(d.suites.s1.n, 0, 'error tidak boleh dihitung sebagai butir yang dinilai'); assert.strictEqual(d.suites.s1.errors, 3);
  assert.strictEqual((await run(['eval/report.js', path.join(out, jf), path.join(out, jf)])).code, 5);
});
test('report: berkas lama dengan semua suite 0% (tanpa penanda valid) ditolak kecuali --force', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'z0-')), z = { kind: 'quality', label: 'nol', suites: { s1: { pass: 0, n: 18, rate: 0, ci95: [0, 0.18] } } };
  fs.writeFileSync(path.join(dir, 'z.json'), JSON.stringify(z));
  assert.strictEqual((await run(['eval/report.js', path.join(dir, 'z.json'), path.join(dir, 'z.json')])).code, 5);
});

test('verifier lang: jawaban latin sangat pendek dilewati, bahasa yang salah tetap gagal', () => {
  const r = V.check({ type: 'lang', value: 'en' }, 'Paris'); assert.ok(r.pass && r.skipped);
  assert.ok(!V.check({ type: 'lang', value: 'en' }, '了解です。').pass, 'jawaban Jepang untuk permintaan Inggris harus gagal');
  assert.ok(!V.check({ type: 'lang', value: 'en' }, 'Halo, aku Celcius dan aku senang bisa bertemu dengan kamu hari ini.').pass);
});
test('run-quality --lang-hint: petunjuk bahasa ditambahkan hanya pada prompt yang meminta bahasa; mengubah hasil S2', async () => {
  const srv = mock(), port = await listen(srv), o1 = fs.mkdtempSync(path.join(os.tmpdir(), 'h1-')), o2 = fs.mkdtempSync(path.join(os.tmpdir(), 'h2-'));
  const a = ['eval/run-quality.js', '--base', `http://127.0.0.1:${port}`, '--suites', 's2'];
  await run([...a, '--out', o1]); await run([...a, '--lang-hint', '--out', o2]); srv.close();
  const load = (d) => JSON.parse(fs.readFileSync(path.join(d, fs.readdirSync(d).find((f) => f.endsWith('.json'))), 'utf8'));
  const x = load(o1), y = load(o2), item = (d, id) => d.items.find((i) => i.id === id);
  assert.strictEqual(x.lang_hint, false); assert.strictEqual(y.lang_hint, true);
  assert.strictEqual(item(x, 's2-1').pass, false); assert.strictEqual(item(y, 's2-1').pass, true, 'dengan petunjuk, mock menjawab Inggris');
  assert.strictEqual(item(y, 's2-1').hinted, 'English'); assert.strictEqual(item(y, 's2-6').hinted, null, 'prompt tanpa permintaan bahasa tidak diberi petunjuk');
});
