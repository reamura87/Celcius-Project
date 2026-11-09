#!/usr/bin/env node
'use strict';
/* M1.1 — Pengukuran performa dan sumber daya (TTFT, prompt/gen token per detik, efek cache awalan, VRAM/RAM/CPU).
   PROTOKOL VRAM DENGAN AVATAR AKTIF: jalankan aplikasi Celcius dengan konfigurasi yang diuji (gpuLayers/ctx di config.json), biarkan jendela avatar terbuka,
   lalu jalankan skrip ini. Nilai VRAM yang tercatat sudah termasuk avatar (renderer) karena diukur dari GPU secara keseluruhan.
   Contoh:  node eval/run-perf.js --label q8-ngl0        Opsi: --base  --runs 3  --out <folder>                                                  */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { chat, props } = require('./lib/llm'), { systemPrompt, PROFILES } = require('./lib/persona'), { startSampler, gpuMem } = require('./lib/sys'), { median } = require('./lib/stats');
const A = process.argv.slice(2), get = (k, d) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : d; };
const base = get('--base', 'http://127.0.0.1:8089'), label = get('--label', 'tanpa-label'), RUNS = +get('--runs', 3), outDir = get('--out', path.join(__dirname, 'results'));
const SYS = systemPrompt();
const H = [  // riwayat percakapan tetap (±40–60 token per pasang)
  ['Halo, namaku Ayu. Aku lagi belajar membuat game kecil.', 'Halo Ayu! Seru banget. Game seperti apa yang mau kamu buat?'],
  ['Mau bikin game teka-teki sederhana pakai JavaScript.', 'Bagus untuk pemula. Mulai dari satu level dan satu mekanik dulu ya, supaya tidak kewalahan.'],
  ['Menurutmu aku perlu engine atau cukup HTML canvas?', 'Untuk game kecil, HTML canvas sudah cukup. Engine baru terasa berguna kalau proyeknya makin besar.'],
  ['Oke. Bagaimana cara menyimpan skor pemain?', 'Pakai localStorage untuk skor sederhana. Kalau mau skor online, nanti butuh server kecil.'],
  ['Kalau aku mau musik latar, bagaimana?', 'Gunakan elemen audio atau Web Audio API, dan mulai dari satu lagu pendek yang diulang.'],
  ['Terakhir, bagaimana supaya game-nya tidak terasa membosankan?', 'Tambahkan peningkatan kesulitan bertahap dan hadiah kecil di setiap level supaya pemain terus penasaran.'],
];
const KB_LINE = '\nPengetahuan yang diajarkan pengguna (gunakan jika relevan):\n- halo => Halo! Aku senang kamu datang.';
const msgs = (sys, n, user) => { const m = [{ role: 'system', content: sys }]; for (let i = 0; i < n; i++) m.push({ role: 'user', content: H[i][0] }, { role: 'assistant', content: H[i][1] }); m.push({ role: 'user', content: user }); return m; };
const pick = (r) => { const t = r.timings || {}; return { prompt_n: t.prompt_n ?? null, cache_n: t.cache_n ?? null, prompt_ms: t.prompt_ms ?? null, prompt_tps: t.prompt_per_second ?? null, gen_tps: t.predicted_per_second ?? null, wall_ms: Math.round(r.totalMs) }; };
const once = async (messages, max = 8) => pick(await chat({ base, messages, stream: false, sampling: { ...PROFILES.greedy, max_tokens: max } }));
const med = (rows, k) => median(rows.map((r) => r[k]));
const summary = (rows) => Object.fromEntries(['prompt_n', 'cache_n', 'prompt_ms', 'prompt_tps', 'gen_tps', 'wall_ms'].map((k) => [k, med(rows, k)]));

async function main() {
  const out = { kind: 'perf', label, base, runs: RUNS, node: process.version, created: new Date().toISOString(), server_props: null, scenarios: {} };
  const pr = await props(base); if (pr) out.server_props = { model_path: pr.model_path || null, build_info: pr.build_info || null };
  const g0 = await gpuMem(); out.gpu_before_mib = g0?.used ?? null;
  const sampler = startSampler(500); const mark = () => Date.now();
  const scen = async (name, fn) => { console.log('>', name); const t = mark(); const r = await fn(); r.resources = sampler.summarize(t); out.scenarios[name] = r; };

  await scen('cold', async () => { const rows = []; for (let i = 0; i < RUNS; i++) rows.push(await once(msgs(`[${crypto.randomBytes(4).toString('hex')}] ` + SYS, 0, 'Halo, apa kabar?'))); return { note: 'awalan unik = cache tidak terpakai (TTFT dingin)', ...summary(rows) }; });
  await scen('warm_same', async () => { const s = `[${crypto.randomBytes(4).toString('hex')}] ` + SYS, rows = []; await once(msgs(s, 0, 'Halo, apa kabar?')); for (let i = 0; i < RUNS; i++) rows.push(await once(msgs(s, 0, 'Halo, apa kabar?'))); return { note: 'permintaan identik berulang', ...summary(rows) }; });
  await scen('kb_toggle', async () => {
    const res = {}, mid = (rows) => { const s2 = [...rows].sort((x, y) => (x.prompt_ms ?? 0) - (y.prompt_ms ?? 0)); return s2[Math.floor((s2.length - 1) / 2)]; };   // satu baris utuh, bukan median per kolom
    for (const n of [0, 3, 6]) {
      const ctl = [], tst = [];
      for (let i = 0; i < RUNS; i++) {
        const nonce = `[${crypto.randomBytes(4).toString('hex')}] `, S0 = nonce + SYS, S1 = nonce + SYS + KB_LINE;   // nonce unik per iterasi: tidak ada cache lintas iterasi
        await once(msgs(S0, n, 'Boleh minta saran singkat?'));                 // hangatkan cache dengan system stabil
        ctl.push(await once(msgs(S0, n, 'Boleh minta saran sederhana?')));      // kontrol: system stabil
        await once(msgs(S0, n, 'Boleh minta saran singkat?'));                 // hangatkan ulang
        tst.push(await once(msgs(S1, n, 'Boleh minta saran sederhana?')));      // uji: system + baris KB (seperti sapaan di aplikasi sekarang)
      }
      res['hist' + n] = { control_stable_system: mid(ctl), with_kb_in_system: mid(tst), rows_control: ctl, rows_kb: tst };
    }
    return { note: 'efek menyisipkan teks KB ke system prompt pada riwayat 0/3/6 pasang; tiap angka = satu baris utuh (median menurut prompt_ms); baris mentah di rows_*', ...res };
  });
  await scen('stream_ttft', async () => {
    const s = `[${crypto.randomBytes(4).toString('hex')}] ` + SYS, rows = []; await once(msgs(s, 3, 'Ceritakan satu tips singkat.'));
    for (let i = 0; i < RUNS + 2; i++) { const r = await chat({ base, messages: msgs(s, 3, 'Ceritakan satu tips singkat.'), stream: true, sampling: { ...PROFILES.current, max_tokens: 64, seed: i } }); rows.push({ ttft_ms: r.ttftMs, tps: r.tps }); }
    return { note: 'streaming seperti aplikasi, awalan hangat', ttft_ms_median: median(rows.map((r) => r.ttft_ms)), stream_tps_median: median(rows.map((r) => r.tps)) };
  });
  await scen('throughput', async () => { const rows = []; for (let i = 0; i < RUNS; i++) rows.push(await once(msgs(SYS, 0, 'Tulis cerita pendek tentang seekor kucing.'), 128)); return { note: 'generasi 128 token', gen_tps_median: med(rows, 'gen_tps'), ...summary(rows) }; });

  out.resources_total = sampler.stop(); const g1 = await gpuMem(); out.gpu_after_mib = g1?.used ?? null;
  const pad = (n) => String(n).padStart(2, '0'), d = new Date();
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  fs.mkdirSync(outDir, { recursive: true });
  const jf = path.join(outDir, `${stamp}_${label}_perf.json`); fs.writeFileSync(jf, JSON.stringify(out, null, 2));
  const f = (x, n = 0) => (x == null ? '–' : (+x).toFixed(n));
  const md = [`# Performa — ${label}`, '', `server ${base} · ${out.created}`, '',
    '| Skenario | prompt_n | cache_n | prompt_ms | prompt tok/s | gen tok/s |', '|---|---:|---:|---:|---:|---:|'];
  for (const k of ['cold', 'warm_same', 'throughput']) { const s = out.scenarios[k]; md.push(`| ${k} | ${f(s.prompt_n)} | ${f(s.cache_n)} | ${f(s.prompt_ms)} | ${f(s.prompt_tps, 1)} | ${f(s.gen_tps, 1)} |`); }
  md.push('', '| Riwayat | system stabil: prompt_n / ms | system + KB: prompt_n / ms |', '|---|---|---|');
  for (const n of [0, 3, 6]) { const r = out.scenarios.kb_toggle['hist' + n]; md.push(`| ${n} pasang | ${f(r.control_stable_system.prompt_n)} / ${f(r.control_stable_system.prompt_ms)} | ${f(r.with_kb_in_system.prompt_n)} / ${f(r.with_kb_in_system.prompt_ms)} |`); }
  const st = out.scenarios.stream_ttft, rt = out.resources_total;
  md.push('', `Streaming (hangat): TTFT median ${f(st.ttft_ms_median)} ms · ${f(st.stream_tps_median, 1)} token/s`, '',
    `Sumber daya selama pengujian: VRAM puncak ${f(rt.gpu_peak_mib)} / ${f(rt.gpu_total_mib)} MiB (sebelum uji ${f(out.gpu_before_mib)} MiB) · RAM llama-server puncak ${f(rt.llama_ram_peak_mb)} MB · CPU rata-rata ${f(rt.cpu_mean_pct)}% (puncak ${f(rt.cpu_peak_pct)}%)`);
  fs.writeFileSync(jf.replace(/\.json$/, '.md'), md.join('\n') + '\n');
  console.log('\n' + md.join('\n') + '\n\nTersimpan:', jf);
}
main().catch((e) => { console.error('GAGAL:', e.message); process.exit(1); });
