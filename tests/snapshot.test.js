'use strict';
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { sha256File, buildManifest, copyVerified, backupTargetProblem } = require('../scripts/snapshot-baseline');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'celcius-'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').toUpperCase();

function fakeProject() {
  const root = tmp(), models = tmp(); const w = Buffer.from('bobot-adaptor-palsu');
  fs.writeFileSync(path.join(root, 'adapter_model.safetensors'), w);
  fs.writeFileSync(path.join(root, 'adapter_config.json'), JSON.stringify({ base_model_name_or_path: 'Qwen/Qwen2.5-3B-Instruct', r: 16, lora_alpha: 32, target_modules: ['q_proj'] }));
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ modelFile: 'celcius-q8_0.gguf' }));
  fs.writeFileSync(path.join(models, 'celcius-q8_0.gguf'), Buffer.alloc(1024, 7));
  return { root, models, wsha: sha(w) };
}
test('sha256File sama dengan hash referensi', async () => {
  const d = tmp(), f = path.join(d, 'x.bin'); fs.writeFileSync(f, 'halo');
  assert.strictEqual(await sha256File(f), sha('halo'));
});
test('manifest: hash cocok dengan hash yang diharapkan -> status COCOK, GGUF tercatat', async () => {
  const p = fakeProject();
  const m = await buildManifest({ root: p.root, models: p.models, expectAdapter: p.wsha, log() {} });
  const v = m.versions[0];
  assert.match(v.adapter.check, /^COCOK/); assert.strictEqual(v.base_model, 'Qwen/Qwen2.5-3B-Instruct'); assert.strictEqual(v.lora.r, 16);
  assert.strictEqual(v.gguf_active.file, 'celcius-q8_0.gguf'); assert.strictEqual(v.gguf_active.sha256, sha(Buffer.alloc(1024, 7))); assert.strictEqual(v.gguf_active.quant_by_filename, 'q8_0');
});
test('manifest: hash berbeda -> TIDAK COCOK; adaptor hilang -> TIDAK DITEMUKAN', async () => {
  const p = fakeProject();
  assert.match((await buildManifest({ root: p.root, models: p.models, expectAdapter: 'AA', log() {} })).versions[0].adapter.check, /^TIDAK COCOK/);
  const e = tmp(); assert.match((await buildManifest({ root: e, models: p.models, log() {} })).versions[0].adapter.check, /^TIDAK DITEMUKAN/);
});
test('cadangan: menyalin + verifikasi; tidak pernah menimpa berkas berbeda; sumber tidak berubah', async () => {
  const p = fakeProject(), src = path.join(p.root, 'adapter_model.safetensors'), dir = tmp();
  const r1 = await copyVerified(src, dir, p.wsha); assert.match(r1.status, /disalin/);
  assert.strictEqual((await copyVerified(src, dir, p.wsha)).status, 'sudah ada, hash sama');
  fs.writeFileSync(path.join(dir, 'adapter_model.safetensors'), 'rusak');
  await assert.rejects(() => copyVerified(src, dir, p.wsha), /tidak ditimpa/);
  assert.strictEqual(sha(fs.readFileSync(src)), p.wsha, 'sumber tidak boleh berubah');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'adapter_model.safetensors'), 'utf8'), 'rusak', 'berkas cadangan berbeda tidak boleh ditimpa');
});

test('lokasi cadangan: akar tidak ada -> fatal dengan pesan jelas; drive sama -> peringatan; lokasi berbeda yang ada -> aman', () => {
  const r = backupTargetProblem('E:\\cadangan', '/x/adapter.safetensors', () => false); assert.strictEqual(r.fatal, true); assert.match(r.msg, /tidak ada/);
  const same = backupTargetProblem(os.tmpdir(), path.join(os.tmpdir(), 'a.bin'), () => true); assert.strictEqual(same.fatal, false); assert.strictEqual(same.sameDrive, true); assert.match(same.msg, /drive yang sama/);
});
