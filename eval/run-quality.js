#!/usr/bin/env node
'use strict';
/* M1.1 — Evaluasi kualitas (S1 instruksi, S2 bahasa, S3 persona, S4 degenerasi, S5 penalaran ringan).
   Menyerang llama-server LANGSUNG (bukan lewat proksi aplikasi), dengan system prompt yang sama dengan aplikasi.
   Contoh:  node eval/run-quality.js --label baseline-q8
   Opsi: --base http://127.0.0.1:8089  --suites s1,s2,s3,s4,s5  --profile current|precise|greedy  --limit N  --repeats N  --out <folder> */
const fs = require('fs'), path = require('path');
const { chat, props } = require('./lib/llm'), { systemPrompt, PROFILES } = require('./lib/persona'), { verify } = require('./lib/verifiers'), { wilson, median } = require('./lib/stats');
const A = process.argv.slice(2), get = (k, d) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : d; };
const base = get('--base', 'http://127.0.0.1:8089'), label = get('--label', 'tanpa-label'), profileName = get('--profile', 'current');
const repeats = +get('--repeats', 1), limit = +get('--limit', 0), outDir = get('--out', path.join(__dirname, 'results'));
const FILES = { s1: 's1_instruction.jsonl', s2: 's2_language.jsonl', s3: 's3_persona.jsonl', s4: 's4_degeneration.jsonl', s5: 's5_reasoning.jsonl' };
const wanted = get('--suites', 'all') === 'all' ? Object.keys(FILES) : get('--suites').split(',');
if (!PROFILES[profileName]) { console.error('profil tidak dikenal:', profileName); process.exit(1); }

function loadSuite(k) {
  const f = path.join(__dirname, 'suites', FILES[k]);
  let items = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  return limit ? items.slice(0, limit) : items;
}
const pad = (n) => String(n).padStart(2, '0');
async function main() {
  const meta = { kind: 'quality', label, base, profile: profileName, sampling: PROFILES[profileName], repeats, node: process.version, created: new Date().toISOString(), server_props: null };
  const pr = await props(base); if (pr) meta.server_props = { model_path: pr.model_path || null, build_info: pr.build_info || null };
  const sys = systemPrompt(), result = { ...meta, suites: {}, items: [] };
  for (const k of wanted) {
    const items = loadSuite(k); let pass = 0, n = 0; const byLang = {};
    console.log(`\n== ${k} (${items.length} butir × ${repeats}) ==`);
    for (const it of items) for (let r = 0; r < repeats; r++) {
      let out, err = null;
      try { out = await chat({ base, stream: false, messages: [{ role: 'system', content: sys }, { role: 'user', content: it.prompt }], sampling: { ...PROFILES[profileName], ...(it.max_tokens ? { max_tokens: it.max_tokens } : {}), seed: 1000 + r } }); }
      catch (e) { err = e.message; }
      const v = err ? { pass: false, results: [{ type: 'error', pass: false, detail: err }] } : verify(it.checks, out.text);
      n++; if (v.pass) pass++; (byLang[it.lang] ??= { pass: 0, n: 0 }); byLang[it.lang].n++; if (v.pass) byLang[it.lang].pass++;
      result.items.push({ suite: k, id: it.id, lang: it.lang, repeat: r, prompt: it.prompt, output: err ? null : out.text, pass: v.pass, checks: v.results, wall_ms: out?.totalMs ?? null, finish: out?.finish ?? null });
      console.log(`${v.pass ? 'LULUS' : 'GAGAL'}  ${it.id}${repeats > 1 ? '#' + r : ''}  ${v.results.map((x) => x.detail).join(' | ')}`);
    }
    const [lo, hi] = wilson(pass, n);
    result.suites[k] = { pass, n, rate: n ? pass / n : 0, ci95: [lo, hi], by_lang: Object.fromEntries(Object.entries(byLang).map(([l, x]) => [l, { ...x, rate: x.pass / x.n }])) };
  }
  const d = new Date(), stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  fs.mkdirSync(outDir, { recursive: true });
  const jf = path.join(outDir, `${stamp}_${label}_quality.json`); fs.writeFileSync(jf, JSON.stringify(result, null, 2));
  const md = ['# Kualitas — ' + label, '', `Profil: ${profileName} · server: ${base} · ${meta.created}`, '', '| Suite | Lulus | n | Tingkat | 95% CI (Wilson) |', '|---|---:|---:|---:|---|'];
  for (const [k, s] of Object.entries(result.suites)) md.push(`| ${k} | ${s.pass} | ${s.n} | ${(s.rate * 100).toFixed(0)}% | ${(s.ci95[0] * 100).toFixed(0)}–${(s.ci95[1] * 100).toFixed(0)}% |`);
  md.push('', '_Sampel kecil: selang kepercayaan lebar. Jangan menarik kesimpulan dari selisih kecil._');
  fs.writeFileSync(jf.replace(/\.json$/, '.md'), md.join('\n') + '\n');
  console.log('\n' + md.join('\n') + '\n\nTersimpan:', jf);
}
main().catch((e) => { console.error('GAGAL:', e.message); process.exit(1); });
