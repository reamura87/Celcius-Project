'use strict';
// Klien tipis llama-server (/v1/chat/completions). Mengukur TTFT/token-per-detik dari sisi klien dan mengambil `timings` bila server menyediakannya.
async function chat({ base = 'http://127.0.0.1:8089', messages, sampling = {}, stream = true, timeoutMs = 180000 }) {
  const t0 = performance.now(), ctrl = new AbortController(), to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(base + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages, stream, ...sampling }), signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    if (!stream) {
      const j = await res.json();
      return { text: j.choices?.[0]?.message?.content ?? '', totalMs: performance.now() - t0, timings: j.timings || null, usage: j.usage || null, finish: j.choices?.[0]?.finish_reason || null };
    }
    const rd = res.body.getReader(), dec = new TextDecoder(); let buf = '', text = '', first = null, chunks = 0, timings = null, finish = null;
    for (;;) {
      const { done, value } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf('\n\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 2);
        if (!line.startsWith('data:') || line.includes('[DONE]')) continue;
        let j; try { j = JSON.parse(line.slice(5)); } catch { continue; }
        if (j.timings) timings = j.timings;
        const ch = j.choices?.[0], d = ch?.delta?.content;
        if (d) { if (first === null) first = performance.now(); text += d; chunks++; }
        if (ch?.finish_reason) finish = ch.finish_reason;
      }
    }
    const end = performance.now();
    return { text, ttftMs: first === null ? null : first - t0, totalMs: end - t0, chunks, tps: first !== null && chunks > 1 ? (chunks - 1) / ((end - first) / 1000) : null, timings, finish };
  } finally { clearTimeout(to); }
}
async function props(base) { try { const r = await fetch(base + '/props'); return r.ok ? await r.json() : null; } catch { return null; } }
module.exports = { chat, props };
