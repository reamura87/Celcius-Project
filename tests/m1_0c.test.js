// Uji M1.0c: (1) entri KB bawaan tidak disuntikkan ke system prompt; (2) model cadangan tidak menebak.
// MAIN_JS / INDEX_HTML dapat diganti untuk menguji versi lain.
'use strict';
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const { extractFn } = require('./helpers/extract');
const MAIN = fs.readFileSync(process.env.MAIN_JS || path.join(__dirname, '..', 'main.js'), 'utf8');
const HTML = fs.readFileSync(process.env.INDEX_HTML || path.join(__dirname, '..', 'web', 'index.html'), 'utf8');

function loadKbContext(KB) {                      // mengambil kode ASLI dari index.html
  const take = (re, what) => { const m = HTML.match(re); if (!m) throw new Error('tidak ditemukan di index.html: ' + what); return m[0]; };
  const src = [take(/const DEFAULT=\[[\s\S]*?\];/, 'DEFAULT'), take(/const tok=[^\n]*\n/, 'tok'), extractFn(HTML, 'sim'),
    take(/const DEFAULT_Q=[^\n]*\n/, 'DEFAULT_Q'), take(/const isTaught=[^\n]*\n/, 'isTaught'), extractFn(HTML, 'kbContext'), 'return {kbContext, DEFAULT};'].join('\n');
  return new Function('KB', src)(KB);
}

test('kbContext: sapaan tidak memicu entri bawaan; entri yang diajarkan pengguna tetap dipakai', () => {
  const KB = []; const { kbContext, DEFAULT } = loadKbContext(KB);
  KB.push(...DEFAULT, { q: 'warna favoritku', a: 'biru', t: 1 }, { q: 'hobi utamaku', a: 'menggambar' });   // yang terakhir: entri lama tanpa penanda t
  assert.deepStrictEqual(kbContext('halo'), [], 'sapaan tidak boleh memicu entri bawaan');
  assert.deepStrictEqual(kbContext('selamat pagi'), []); assert.deepStrictEqual(kbContext('terima kasih'), []);
  assert.deepStrictEqual(kbContext('apa warna favoritku sekarang'), ['warna favoritku => biru']);
  assert.deepStrictEqual(kbContext('ceritakan hobi utamaku'), ['hobi utamaku => menggambar'], 'entri lama non-bawaan dianggap diajarkan pengguna');
});
test('kbContext: maksimal 3 hasil, urut menurut kemiripan', () => {
  const KB = []; const { kbContext } = loadKbContext(KB);
  for (let i = 0; i < 6; i++) KB.push({ q: 'kopi favorit nomor ' + i, a: 'a' + i, t: 1 });
  KB.push({ q: 'kopi favorit', a: 'tepat', t: 1 });
  const r = kbContext('kopi favorit'); assert.strictEqual(r.length, 3); assert.strictEqual(r[0], 'kopi favorit => tepat');
});
test('index.html: handle() memakai kbContext; entri hasil ajar diberi penanda t:1', () => {
  assert.match(HTML, /const ctx=kbContext\(text\);/); assert.ok(!/const ctx=KB\.map/.test(HTML));
  assert.match(HTML, /KB\.push\(\{q:pending,a:text,t:1\}\)/); assert.match(HTML, /KB\.push\(\{q:m\[1\],a:m\[2\],t:1\}\)/); assert.match(HTML, /d\.map\(x=>\(\{\.\.\.x,t:1\}\)\)/);
});

test('pickFallbackModel: tepat satu kandidat -> dipakai; lebih dari satu -> ambigu (tidak menebak); adaptor "lora" dikecualikan', () => {
  const pick = new Function(extractFn(MAIN, 'pickFallbackModel') + '\nreturn pickFallbackModel;')();
  assert.deepStrictEqual(pick(['a.gguf']), { file: 'a.gguf' });
  assert.deepStrictEqual(pick(['A.GGUF', 'catatan.txt']), { file: 'A.GGUF' });
  assert.deepStrictEqual(pick(['a.gguf', 'b.gguf']), { ambiguous: ['a.gguf', 'b.gguf'] });
  assert.deepStrictEqual(pick(['celcius-q8_0.gguf', 'celcius-v1-lora-f16.gguf']), { file: 'celcius-q8_0.gguf' }, 'LoRA bukan model');
  assert.deepStrictEqual(pick(['celcius-v1-lora-f16.gguf']), { none: true });
  assert.deepStrictEqual(pick([]), { none: true });
});
