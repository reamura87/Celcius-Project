#!/usr/bin/env node
'use strict';
/* M1.0 — Foto baseline `celcius-v1`. TIDAK mengubah file apa pun yang ada; hanya membaca, menghitung SHA-256, dan menulis models/manifest.json.
   Pemakaian (dari folder proyek):
     node scripts/snapshot-baseline.js
     node scripts/snapshot-baseline.js --backup E:\cadangan            (salin adaptor + verifikasi hash; tidak menimpa file yang ada)
     node scripts/snapshot-baseline.js --backup E:\cadangan --copy-gguf (juga menyalin GGUF aktif, ±3,2 GB)
     opsi: --models <folder>  --expect-adapter <sha256>  --skip-gguf-hash                                                    */
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { execFileSync } = require('child_process');

const EXPECTED_ADAPTER_SHA256 = 'A983FAC5F8728E83476EFE4ECDE104A5E5EFFAE5D645913AE8E21F1CEC44BED2';   // dilaporkan pemilik proyek, 6 Nov 2026

function sha256File(file, onProgress) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256'), size = fs.statSync(file).size; let got = 0, last = 0;
    fs.createReadStream(file, { highWaterMark: 4 << 20 })
      .on('data', (c) => { h.update(c); got += c.length; if (onProgress && Date.now() - last > 1000) { last = Date.now(); onProgress(got, size); } })
      .on('error', reject).on('end', () => resolve(h.digest('hex').toUpperCase()));
  });
}
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };
const tryRun = (cmd, args, ms = 6000) => { try { return execFileSync(cmd, args, { timeout: ms, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim(); } catch (e) { return null; } };

function findAdapterFiles(root) {
  const names = ['adapter_model.safetensors', 'adapter_model.safetensor', 'adapter_config.json', 'adapter.zip', 'tokenizer_config.json', 'tokenizer.json', 'vocab.json', 'merges.txt'];
  const found = [];
  for (const dir of [root, path.join(root, 'adapter')]) for (const n of names) {
    const f = path.join(dir, n); if (fs.existsSync(f) && fs.statSync(f).isFile()) found.push(f);
  }
  return found;
}
function findGguf(modelsDir, modelFile) {
  if (modelFile) { const exact = path.join(modelsDir, modelFile); if (fs.existsSync(exact) && fs.statSync(exact).isFile()) return exact; }
  if (!fs.existsSync(modelsDir)) return null;
  const f = fs.readdirSync(modelsDir).find((n) => n.toLowerCase().endsWith('.gguf'));
  return f ? path.join(modelsDir, f) : null;
}
function copyVerified(src, dstDir, expectSha) {
  fs.mkdirSync(dstDir, { recursive: true });
  const dst = path.join(dstDir, path.basename(src));
  if (fs.existsSync(dst)) {
    return sha256File(dst).then((h) => { if (h !== expectSha) throw new Error(`BERKAS CADANGAN SUDAH ADA TETAPI BERBEDA (tidak ditimpa): ${dst}`); return { dst, status: 'sudah ada, hash sama' }; });
  }
  fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL);
  return sha256File(dst).then((h) => { if (h !== expectSha) throw new Error('Salinan rusak: hash tidak cocok untuk ' + dst); return { dst, status: 'disalin dan diverifikasi' }; });
}

async function buildManifest(opts) {
  const root = opts.root, log = opts.log || console.log;
  const cfg = readJson(path.join(root, 'config.json')) || {}, pkg = readJson(path.join(root, 'package.json')) || {};
  const modelsDir = opts.models || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Celcius', 'models');
  const adapters = [];
  for (const f of findAdapterFiles(root)) {
    log('hash', f);
    adapters.push({ path: f, size: fs.statSync(f).size, sha256: await sha256File(f), modified: fs.statSync(f).mtime.toISOString() });
  }
  const weights = adapters.find((a) => /adapter_model\.safetensors?$/.test(a.path));
  const acfg = readJson(adapters.find((a) => /adapter_config\.json$/.test(a.path))?.path || '');
  const expected = (opts.expectAdapter || EXPECTED_ADAPTER_SHA256).toUpperCase();
  const adapterCheck = !weights ? 'TIDAK DITEMUKAN' : (weights.sha256 === expected ? 'COCOK dengan hash yang dilaporkan pemilik' : 'TIDAK COCOK dengan hash yang dilaporkan pemilik');

  let gguf = null; const gp = findGguf(modelsDir, cfg.modelFile || '');
  if (gp) {
    gguf = { path: gp, file: path.basename(gp), size: fs.statSync(gp).size, modified: fs.statSync(gp).mtime.toISOString(), sha256: null,
             quant_by_filename: (path.basename(gp).match(/(q\d[\w]*|f16|f32|bf16)/i) || [null])[0] };
    if (!opts.skipGgufHash) { log('hash GGUF (besar, beberapa detik)…', gp); gguf.sha256 = await sha256File(gp, (g, t) => log(`  ${(g / t * 100).toFixed(0)}%`)); }
  }
  const llamaExe = (function find(d) { if (!fs.existsSync(d)) return null; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { const r = find(p); if (r) return r; } else if (e.name.toLowerCase() === 'llama-server.exe') return p; } return null; })(path.join(root, 'llama'));
  const gpuRaw = tryRun('nvidia-smi', ['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader']);
  return {
    schema: 1, created: new Date().toISOString(), tool: 'scripts/snapshot-baseline.js',
    versions: [{
      id: 'celcius-v1', status: 'baseline', note: 'Baseline permanen. Jangan ditimpa; versi baru = id baru.',
      base_model: acfg?.base_model_name_or_path || null,
      lora: acfg ? { r: acfg.r, alpha: acfg.lora_alpha, dropout: acfg.lora_dropout, target_modules: acfg.target_modules, peft_version: acfg.peft_version, use_dora: acfg.use_dora } : null,
      training_recipe_reported_by_owner: 'train_lora.py --n 6000 --ja 4000 --en 4000 --epochs 1 --base Qwen/Qwen2.5-3B-Instruct; QLoRA nf4, fp16 (Colab T4), batch efektif 16, lr 2e-4, maxlen 512; tanpa checkpoint dan tanpa set validasi',
      adapter: { files: adapters, expected_sha256_reported_by_owner: expected, check: adapterCheck },
      gguf_active: gguf,
    }],
    environment: {
      os: `${os.type()} ${os.release()}`, cpu: os.cpus()[0]?.model, cpu_threads: os.cpus().length, ram_gb: +(os.totalmem() / 2 ** 30).toFixed(1),
      node: process.version, gpu: gpuRaw, app_version: pkg.version || null, electron_range: pkg.devDependencies?.electron || pkg.dependencies?.electron || null,
      llama_server: llamaExe, llama_server_version: llamaExe ? (tryRun(llamaExe, ['--version'], 8000) || null) : null,
      git_commit: tryRun('git', ['-C', root, 'rev-parse', 'HEAD']),
    },
    config_json: cfg,
    recovery: 'docs/RECOVERY.md',
  };
}

async function main() {
  const a = process.argv.slice(2), get = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const root = path.resolve(__dirname, '..');
  const m = await buildManifest({ root, models: get('--models'), expectAdapter: get('--expect-adapter'), skipGgufHash: a.includes('--skip-gguf-hash') });
  fs.mkdirSync(path.join(root, 'models'), { recursive: true });
  const out = path.join(root, 'models', 'manifest.json');
  if (fs.existsSync(out)) fs.copyFileSync(out, out.replace(/\.json$/, `.${Date.now()}.bak.json`));   // jangan menimpa manifest lama tanpa jejak
  fs.writeFileSync(out, JSON.stringify(m, null, 2));
  const v = m.versions[0];
  console.log('\n=== RINGKASAN ===');
  console.log('Adaptor      :', v.adapter.check);
  v.adapter.files.forEach((f) => console.log('  ', path.basename(f.path).padEnd(28), f.sha256, `(${f.size} B)`));
  console.log('GGUF aktif   :', v.gguf_active ? `${v.gguf_active.file}  ${v.gguf_active.sha256 || '(hash dilewati)'}  (${(v.gguf_active.size / 2 ** 30).toFixed(2)} GiB)` : 'TIDAK DITEMUKAN');
  console.log('Manifest     :', out);
  const bdir = get('--backup');
  if (bdir) {
    const dir = path.join(bdir, 'celcius-v1'); const sums = [];
    for (const f of v.adapter.files) { const r = await copyVerified(f.path, dir, f.sha256); console.log('  cadangan:', r.dst, '-', r.status); sums.push(`${f.sha256}  ${path.basename(f.path)}`); }
    if (a.includes('--copy-gguf') && v.gguf_active?.sha256) { const g = v.gguf_active; const r = await copyVerified(g.path, dir, g.sha256); console.log('  cadangan:', r.dst, '-', r.status); sums.push(`${g.sha256}  ${g.file}`); }
    fs.writeFileSync(path.join(dir, 'SHA256SUMS.txt'), sums.join('\n') + '\n'); fs.copyFileSync(out, path.join(dir, 'manifest.json'));
    console.log('Cadangan selesai di', dir);
  } else console.log('(Belum ada cadangan salinan. Jalankan dengan --backup <folder di drive lain> — lihat docs/RECOVERY.md)');
  if (!/^COCOK/.test(v.adapter.check)) { console.error('\nPERINGATAN: ' + v.adapter.check); process.exit(2); }
}
module.exports = { sha256File, buildManifest, findAdapterFiles, copyVerified, EXPECTED_ADAPTER_SHA256 };
if (require.main === module) main().catch((e) => { console.error('GAGAL:', e.message); process.exit(1); });
