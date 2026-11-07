// Mengambil teks sebuah fungsi dari main.js agar kode ASLI yang diuji (main.js tidak bisa di-require tanpa Electron).
'use strict';
function extractFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('fungsi tidak ditemukan: ' + name);
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error('kurung tidak seimbang: ' + name);
}
module.exports = { extractFn };
