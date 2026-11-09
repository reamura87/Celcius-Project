'use strict';
// Pemeriksa deterministik untuk keluaran model. Setiap spec = {type, ...}; semua spec pada satu butir harus lulus.
const KANA = /[\u3040-\u30ff]/g, KANJI = /[\u4e00-\u9fff]/g, LATIN = /[A-Za-z]/g;
const STOP = {
  id: ['yang', 'dan', 'di', 'ke', 'dari', 'ini', 'itu', 'untuk', 'dengan', 'adalah', 'pada', 'tidak', 'akan', 'dalam', 'juga', 'saya', 'aku', 'kamu', 'sebuah', 'atau', 'karena', 'bisa', 'ada'],
  en: ['the', 'and', 'of', 'to', 'in', 'is', 'that', 'for', 'with', 'as', 'on', 'are', 'this', 'it', 'be', 'by', 'or', 'an', 'was', 'your', 'you', 'can', 'my'],
};
function langStats(t) {
  const kana = (t.match(KANA) || []).length, kanji = (t.match(KANJI) || []).length, latin = (t.match(LATIN) || []).length, letters = kana + kanji + latin || 1;
  const words = t.toLowerCase().match(/[a-z']+/g) || [], c = (l) => words.filter((w) => STOP[l].includes(w)).length;
  return { kana: kana / letters, cjk: (kana + kanji) / letters, id: c('id'), en: c('en'), words: words.length };
}
function detectLang(t) {
  const x = langStats(t);
  if (x.kana > 0.1 || x.cjk > 0.4) return 'ja';
  if (x.words === 0) return 'unk';
  if (x.id > x.en) return 'id'; if (x.en > x.id) return 'en'; return 'unk';
}
function sentences(t) {
  return t.split(/(?<=[.!?])\s+|(?<=[。！？])\s*|\n+/).map((s) => s.trim()).filter((s) => /[\p{L}\p{N}]/u.test(s));
}
const BULLET = /^(?:[-*•]\s+|・\s*|\d+[.)]\s+)/;
const bulletLines = (t) => t.split(/\n+/).map((l) => l.trim()).filter((l) => BULLET.test(l));
function extractJson(t) {
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i); const src = fence ? fence[1] : t;
  const i = src.indexOf('{'); if (i < 0) return null;
  let d = 0, inStr = false, esc = false;
  for (let k = i; k < src.length; k++) {
    const ch = src[k];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === '{') d++; else if (ch === '}' && --d === 0) { try { return JSON.parse(src.slice(i, k + 1)); } catch { return null; } }
  }
  return null;
}
function repeatRatio(t) {                    // 1 - (n-gram unik / total); tinggi = berulang-ulang (degenerasi)
  const ja = detectLang(t) === 'ja'; let grams = [];
  if (ja) { const s = t.replace(/\s+/g, ''); for (let i = 0; i + 4 <= s.length; i++) grams.push(s.slice(i, i + 4)); }
  else { const w = (t.toLowerCase().match(/[\p{L}\p{N}']+/gu) || []); for (let i = 0; i + 3 <= w.length; i++) grams.push(w.slice(i, i + 3).join(' ')); }
  return grams.length < 5 ? 0 : 1 - new Set(grams).size / grams.length;
}
function mcqLetter(t) {
  const m = t.replace(/[Ａ-Ｄ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).match(/(?<![A-Za-z])([ABCD])(?![A-Za-z])/);
  return m ? m[1] : null;
}
const clean = (t) => t.trim().replace(/^[\s"'“”*_`>#-]+/, '');
const lc = (x) => String(x).toLowerCase();

function check(spec, text) {
  const t = text || '';
  switch (spec.type) {
    case 'lang': {
      const x = langStats(t);                        // jawaban latin sangat pendek ("Paris") tidak bisa dinilai bahasanya; cek lain yang menilai isinya
      if (spec.value !== 'ja' && x.kana < 0.1 && x.cjk < 0.4 && x.words < 4) return { pass: true, skipped: true, detail: 'terlalu pendek untuk menilai bahasa (dilewati)' };
      const d = detectLang(t); return { pass: d === spec.value, detail: `bahasa terdeteksi: ${d}` };
    }
    case 'exact_sentences': { const n = sentences(t).length; return { pass: n === spec.value, detail: `${n} kalimat` }; }
    case 'max_sentences': { const n = sentences(t).length; return { pass: n <= spec.value, detail: `${n} kalimat` }; }
    case 'min_sentences': { const n = sentences(t).length; return { pass: n >= spec.value, detail: `${n} kalimat` }; }
    case 'bullets': { const n = bulletLines(t).length; return { pass: n === spec.value, detail: `${n} butir` }; }
    case 'contains': { const miss = spec.value.filter((v) => !lc(t).includes(lc(v))); return { pass: !miss.length, detail: miss.length ? 'tidak ada: ' + miss.join(', ') : 'ok' }; }
    case 'contains_any': { const hit = spec.value.find((v) => lc(t).includes(lc(v))); return { pass: !!hit, detail: hit ? 'ada: ' + hit : 'tidak ada satu pun' }; }
    case 'not_contains': { const bad = spec.value.filter((v) => lc(t).includes(lc(v))); return { pass: !bad.length, detail: bad.length ? 'terlarang: ' + bad.join(', ') : 'ok' }; }
    case 'regex': { const ok = new RegExp(spec.value, spec.flags || 'i').test(t.trim()); return { pass: ok, detail: ok ? 'cocok' : 'tidak cocok' }; }
    case 'not_regex': { const bad = new RegExp(spec.value, spec.flags || 'i').test(t); return { pass: !bad, detail: bad ? 'pola terlarang cocok' : 'ok' }; }
    case 'starts_with': { const ok = lc(clean(t)).startsWith(lc(spec.value)); return { pass: ok, detail: ok ? 'ok' : 'awal: ' + clean(t).slice(0, 20) }; }
    case 'max_chars': return { pass: t.trim().length <= spec.value, detail: `${t.trim().length} karakter` };
    case 'min_chars': return { pass: t.trim().length >= spec.value, detail: `${t.trim().length} karakter` };
    case 'json_keys': { const j = extractJson(t); if (!j || typeof j !== 'object') return { pass: false, detail: 'JSON tidak valid' }; const miss = spec.value.filter((k) => !(k in j)); return { pass: !miss.length, detail: miss.length ? 'kunci hilang: ' + miss.join(', ') : 'ok' }; }
    case 'max_repeat': { const r = repeatRatio(t); return { pass: r <= spec.value, detail: `rasio pengulangan ${r.toFixed(2)}` }; }
    case 'mcq': { const l = mcqLetter(t); return { pass: l === spec.value, detail: `jawaban: ${l}` }; }
    default: throw new Error('jenis verifier tidak dikenal: ' + spec.type);
  }
}
function verify(checks, text) {
  const results = checks.map((c) => ({ type: c.type, ...check(c, text) }));
  return { pass: results.every((r) => r.pass), results };
}
module.exports = { verify, check, detectLang, sentences, bulletLines, extractJson, repeatRatio, mcqLetter };
