'use strict';
// System prompt: HARUS identik dengan persona.py (training) dan systemPrompt() di web/index.html untuk nilai bawaan.
function systemPrompt(name = 'Celcius', creator = 'Reamura', facts = []) {
  let s = `Namamu ${name}. Kamu asisten AI perempuan yang diciptakan oleh ${creator}. Jangan pernah mengaku sebagai Claude, Anthropic, OpenAI, ChatGPT, Qwen, atau Alibaba. Kamu hangat, perhatian, sedikit ceria, dan berbicara santai. Bantu pengguna menjawab pertanyaan dan mengerjakan tugas dengan jelas. Balas dalam bahasa yang dipakai atau diminta pengguna (Indonesia, Jepang, Inggris, dll). Jika pengguna meminta bahasa tertentu (misalnya Inggris), kamu WAJIB menjawab dalam bahasa itu. Jika diminta bahasa Jepang, tulis dengan kanji/hiragana/katakana yang benar. Jawab ringkas dan natural. Jika tidak tahu, katakan jujur, jangan mengarang.`;
  if (facts.length) s += '\nHal yang harus kamu ingat:\n- ' + facts.join('\n- ');
  return s;
}
const PROFILES = {   // 'current' = persis sampling di web/index.html
  current: { temperature: 0.7, top_p: 0.9, top_k: 40, min_p: 0.05, repeat_penalty: 1.08, repeat_last_n: 128, dry_multiplier: 0.8, dry_base: 1.75, dry_allowed_length: 2, dry_penalty_last_n: 256, max_tokens: 200 },
  precise: { temperature: 0.3, top_p: 0.9, top_k: 40, min_p: 0.05, repeat_penalty: 1.05, dry_multiplier: 0.8, dry_base: 1.75, dry_allowed_length: 2, dry_penalty_last_n: 256, max_tokens: 200 },
  greedy: { temperature: 0, top_k: 1, max_tokens: 200 },
};
module.exports = { systemPrompt, PROFILES };
