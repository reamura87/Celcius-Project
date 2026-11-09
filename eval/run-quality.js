#!/usr/bin/env node
'use strict';
/* M1.1 — Evaluasi kualitas (S1 instruksi, S2 bahasa, S3 persona, S4 degenerasi, S5 penalaran ringan).
   Menyerang llama-server LANGSUNG (bukan lewat proksi aplikasi), dengan system prompt yang sama dengan aplikasi.
   Contoh:  node eval/run-quality.js --label baseline-q8
   Opsi: --lang-hint (eksperimen: tambahkan petunjuk bahasa bila prompt meminta bahasa tertentu)  --base http://127.0.0.1:8089  --suites s1,s2,s3,s4,s5  --profile current|precise|greedy  --limit N  --repeats N  --out <folder>  --wait <detik>
   Keluar: 0 = run valid; 2 = server tidak siap; 4 = ada permintaan yang GAGAL (run TIDAK VALID: angkanya tidak boleh dibandingkan). */
const fs = require('fs'), path = require('path');
const { chat, props } = require('./lib/llm'), { systemPrompt, PROFILES } = require('./lib/persona'), { verify } = require('./lib/verifiers'), { wilson } = require('./lib/stats');
const A = process.argv.slice(2), get = (k, d) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : d; };
const base = get('--base', 'http://127.0.0.1:8089'), label = get('--label', 'tanpa-label'), profileName = get('--profile', 'current');
const repeats = +get('--repeats', 1), limit = +get('--limit', 0), outDir = get('--out', path.join(__dirname, 'results')), waitSec = +get('--wait', 30);
const LANG_HINT = A.includes('--lang-hint');
const REQ = [[/dalam bahasa inggris|in english|英語で|英語に/i, 'English'], [/dalam bahasa jepang|in japanese|日本語で/i, 'Japanese'], [/dalam bahasa indonesia|in indonesian|インドネシア語で/i, 'Indonesian']];
const hintFor = (p) => { const m = REQ.find(([re]) => re.test(p)); return m ? m[1] : null; };
const FILES = { s1: 's1_instruction.jsonl', s2: 's2_language.jsonl', s3: 's3_persona.jsonl', s4: 's4_degeneration.jsonl', s5: 's5_reasoning.jsonl' };
const wanted = get('--suites', 'all') === 'all' ? Object.keys(FILES) : get('--suites').split(',');
if (!PROFILES[profileName]) { console.error('profil tidak dikenal:', profileName); process.exit(1); }

function loadSuite(k) {
  const items = fs.readFileSync(path.join(__dirname, 'suites', FILES[k]), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  return limit ? items.slice(0, limit) : items;
}
async function waitReady() {                       // jangan mulai sebelum model selesai dimuat (llama-server /health = 200)
  const t0 = Date.now(); let last = '';
  while ((Date.now() - t0) / 1000 < waitSec) {
    try { const r = await fetch(base + '/health'); if (r.ok) return true; last = 'HTTP ' + r.status; } catch (e) { last = e.cause?.code || e.message; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error(`Server ${base} belum siap (${last}). Jalankan aplikasi (npm start), tunggu sampai model termuat, lalu ulangi.`);
  return false;
}
const pad = (n) => String(n).padStart(2, '0');
async function main() {
  if (!(await waitReady())) process.exit(2);
  const meta = { kind: 'quality', label, base, profile: profileName, sampling: PROFILES[profileName], repeats, lang_hint: LANG_HINT, node: process.version, created: new Date().toISOString(), server_props: null };
  const pr = await props(base); if (pr) meta.server_props = { model_path: pr.model_path || null, build_info: pr.build_info || null };
  const sys = systemPrompt(), result = { ...meta, valid: true, total_errors: 0, aborted: false, suites: {}, items: [] };
  let consecutive = 0;
  outer: for (const k of wanted) {
    const items = loadSuite(k); let pass = 0, n = 0, errors = 0; const byLang = {};
    console.log(`\n== ${k} (${items.length} butir × ${repeats}) ==`);
    for (const it of items) for (let r = 0; r < repeats; r++) {
      let out, err = null; const hint = LANG_HINT ? hintFor(it.prompt) : null; const userText = hint ? `${it.prompt}\n\n(Reply only in ${hint}.)` : it.prompt;
      try { out = await chat({ base, stream: false, messages: [{ role: 'system', content: sys }, { role: 'user', content: userText }], sampling: { ...PROFILES[profileName], ...(it.max_tokens ? { max_tokens: it.max_tokens } : {}), seed: 1000 + r } }); }
      catch (e) { err = e.message; }
      if (err) {                                    // KESALAHAN PERMINTAAN != jawaban salah: tidak dihitung ke tingkat lulus
        errors++; result.total_errors++; consecutive++;
        result.items.push({ suite: k, id: it.id, lang: it.lang, repeat: r, prompt: it.prompt, error: err });
        console.log(`ERROR  ${it.id}  ${err}`);
        if (consecutive >= 3) { console.error(`\n3 permintaan berturut-turut gagal (${err}). Run dihentikan dan ditandai TIDAK VALID.`); result.aborted = true; result.suites[k] = { pass, n, errors, rate: n ? pass / n : 0, ci95: wilson(pass, n), by_lang: {} }; break outer; }
        continue;
      }
      consecutive = 0;
      const v = verify(it.checks, out.text);
      n++; if (v.pass) pass++; (byLang[it.lang] ??= { pass: 0, n: 0 }); byLang[it.lang].n++; if (v.pass) byLang[it.lang].pass++;
      result.items.push({ suite: k, id: it.id, lang: it.lang, repeat: r, prompt: it.prompt, hinted: hint, output: out.text, pass: v.pass, checks: v.results, wall_ms: out.totalMs, finish: out.finish });
      console.log(`${v.pass ? 'LULUS' : 'GAGAL'}  ${it.id}${repeats > 1 ? '#' + r : ''}  ${v.results.map((x) => x.detail).join(' | ')}`);
    }
    result.suites[k] = { pass, n, errors, rate: n ? pass / n : 0, ci95: wilson(pass, n), by_lang: Object.fromEntries(Object.entries(byLang).map(([l, x]) => [l, { ...x, rate: x.pass / x.n }])) };
  }
  result.valid = result.total_errors === 0 && !result.aborted;
  const d = new Date(), stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  fs.mkdirSync(outDir, { recursive: true });
  const jf = path.join(outDir, `${stamp}_${label}_quality${result.valid ? '' : '_TIDAK-VALID'}.json`); fs.writeFileSync(jf, JSON.stringify(result, null, 2));
  const md = ['# Kualitas — ' + label, '', `Profil: ${profileName} · server: ${base} · ${meta.created}`, ''];
  if (!result.valid) md.push(`> **RUN TIDAK VALID**: ${result.total_errors} permintaan gagal${result.aborted ? ' dan run dihentikan' : ''}. Angka di bawah hanya sebagian dan tidak boleh dibandingkan.`, '');
  md.push('| Suite | Lulus | n | Error | Tingkat | 95% CI (Wilson) |', '|---|---:|---:|---:|---:|---|');
  for (const [k, s] of Object.entries(result.suites)) md.push(`| ${k} | ${s.pass} | ${s.n} | ${s.errors} | ${(s.rate * 100).toFixed(0)}% | ${(s.ci95[0] * 100).toFixed(0)}–${(s.ci95[1] * 100).toFixed(0)}% |`);
  md.push('', '_Sampel kecil: selang kepercayaan lebar. Jangan menarik kesimpulan dari selisih kecil. Butir yang GAGAL perlu diperiksa manual di berkas .json (bagian `items`)._');
  fs.writeFileSync(jf.replace(/\.json$/, '.md'), md.join('\n') + '\n');
  console.log('\n' + md.join('\n') + '\n\nTersimpan:', jf);
  process.exit(result.valid ? 0 : 4);
}
main().catch((e) => { console.error('GAGAL:', e.message); process.exit(1); });
