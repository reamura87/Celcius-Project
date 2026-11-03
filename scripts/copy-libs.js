// Menyalin three.js & three-vrm dari node_modules ke web/libs (aplikasi jalan offline, tanpa CDN)
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), nm = path.join(root, 'node_modules'), out = path.join(root, 'web', 'libs');
const isDir = (s) => fs.statSync(s).isDirectory();
function cp(src, dst, keep = () => true) {
  if (!fs.existsSync(src)) return console.warn('lewati (belum terpasang):', src);
  fs.cpSync(src, dst, { recursive: true, filter: (s) => isDir(s) || keep(s) });
}
cp(path.join(nm, 'three', 'build'), path.join(out, 'three', 'build'), (s) => /module|core/.test(path.basename(s)));
for (const d of ['loaders', 'libs', 'utils', 'curves'])
  cp(path.join(nm, 'three', 'examples', 'jsm', d), path.join(out, 'three', 'examples', 'jsm', d));
cp(path.join(nm, '@pixiv', 'three-vrm', 'lib'), path.join(out, 'three-vrm', 'lib'), (s) => /module\.min\.js$/.test(s));
console.log('libs siap di web/libs');
