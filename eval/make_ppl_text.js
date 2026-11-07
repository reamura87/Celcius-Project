#!/usr/bin/env node
'use strict';
// Mengubah eval/heldout.jsonl (dari make_heldout.py) menjadi teks biasa untuk llama-perplexity.exe -> eval/heldout.txt
const fs = require('fs'), path = require('path'), dir = __dirname, src = path.join(dir, 'heldout.jsonl');
if (!fs.existsSync(src)) { console.error('Belum ada eval/heldout.jsonl. Jalankan dulu:  pip install datasets  lalu  python eval\\make_heldout.py'); process.exit(1); }
const lines = fs.readFileSync(src, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
fs.writeFileSync(path.join(dir, 'heldout.txt'), lines.map((x) => `${x.user}\n${x.assistant}`).join('\n\n') + '\n');
console.log('tertulis eval/heldout.txt dari', lines.length, 'contoh');
