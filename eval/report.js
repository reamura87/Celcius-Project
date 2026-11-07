#!/usr/bin/env node
'use strict';
/* Membandingkan dua hasil. Kualitas:  node eval/report.js baseline_quality.json kandidat_quality.json [--margin 0.10]
   Performa: node eval/report.js a_perf.json b_perf.json
   Aturan promosi (DESIGN 5.6): kandidat TIDAK boleh tertinggal dari baseline lebih dari `margin` pada suite mana pun (non-inferioritas). */
const fs = require('fs'); const A = process.argv.slice(2).filter((x) => !x.startsWith('--')), mi = process.argv.indexOf('--margin');
const margin = mi >= 0 ? +process.argv[mi + 1] : 0.10;
if (A.length < 2) { console.log('pakai: node eval/report.js <baseline.json> <kandidat.json> [--margin 0.10]'); process.exit(1); }
const [a, b] = A.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
if (a.kind !== b.kind) { console.error('jenis berkas berbeda:', a.kind, 'vs', b.kind); process.exit(1); }
const pct = (x) => (x * 100).toFixed(0) + '%', f = (x, n = 0) => (x == null ? '–' : (+x).toFixed(n));
if (a.kind === 'quality') {
  let regress = 0; const rows = ['| Suite | baseline | kandidat | selisih | status |', '|---|---:|---:|---:|---|'];
  for (const k of Object.keys(a.suites)) {
    const x = a.suites[k], y = b.suites[k]; if (!y) { rows.push(`| ${k} | ${pct(x.rate)} | – | – | tidak ada di kandidat |`); continue; }
    const d = y.rate - x.rate, clearly = y.ci95[1] < x.ci95[0], bad = d < -margin;
    const st = clearly ? 'REGRESI JELAS (CI tidak tumpang-tindih)' : bad ? 'MELEWATI MARGIN' : d > margin ? 'lebih baik' : 'setara';
    if (clearly || bad) regress++; rows.push(`| ${k} | ${pct(x.rate)} (n=${x.n}) | ${pct(y.rate)} (n=${y.n}) | ${d >= 0 ? '+' : ''}${(d * 100).toFixed(0)} pt | ${st} |`);
  }
  console.log(`# ${a.label} -> ${b.label}\n\n` + rows.join('\n') + `\n\nMargin non-inferioritas: ${(margin * 100).toFixed(0)} pt. ${regress ? regress + ' suite bermasalah: JANGAN diajukan sebagai pengganti baseline.' : 'Tidak ada regresi yang terdeteksi pada set ini (sampel kecil; bukan bukti kuat).'}`);
  process.exit(regress ? 3 : 0);
} else {
  const rows = ['| Ukuran | A | B |', '|---|---:|---:|', `| cold prompt_ms | ${f(a.scenarios.cold.prompt_ms)} | ${f(b.scenarios.cold.prompt_ms)} |`, `| warm prompt_ms | ${f(a.scenarios.warm_same.prompt_ms)} | ${f(b.scenarios.warm_same.prompt_ms)} |`,
    `| stream TTFT median ms | ${f(a.scenarios.stream_ttft.ttft_ms_median)} | ${f(b.scenarios.stream_ttft.ttft_ms_median)} |`, `| gen tok/s | ${f(a.scenarios.throughput.gen_tps_median, 1)} | ${f(b.scenarios.throughput.gen_tps_median, 1)} |`,
    `| VRAM puncak MiB | ${f(a.resources_total.gpu_peak_mib)} | ${f(b.resources_total.gpu_peak_mib)} |`, `| RAM llama-server puncak MB | ${f(a.resources_total.llama_ram_peak_mb)} | ${f(b.resources_total.llama_ram_peak_mb)} |`];
  console.log(`# ${a.label} vs ${b.label}\n\n` + rows.join('\n'));
}
