'use strict';
// Pencuplik sumber daya NON-BLOKIR (agar tidak mengganggu pengukuran TTFT): VRAM (nvidia-smi), RAM llama-server (tasklist), CPU sistem.
const { execFile } = require('child_process'), os = require('os');
const run = (cmd, args, ms = 4000) => new Promise((res) => execFile(cmd, args, { timeout: ms, windowsHide: true }, (e, out) => res(e ? null : String(out))));
async function gpuMem() {
  const o = await run('nvidia-smi', ['--query-gpu=memory.used,memory.total', '--format=csv,noheader,nounits']); if (!o) return null;
  const [u, t] = o.trim().split(/\r?\n/)[0].split(',').map((x) => +x.trim()); return Number.isFinite(u) ? { used: u, total: t } : null;
}
async function procRamMB(name = 'llama-server.exe') {
  const o = await run('tasklist', ['/FI', `IMAGENAME eq ${name}`, '/FO', 'CSV', '/NH']); if (!o) return null;
  let sum = 0, found = false;
  for (const line of o.split(/\r?\n/)) {
    const f = line.match(/"([^"]*)"/g);
    if (f && f.length >= 5 && f[0].toLowerCase().includes(name.toLowerCase())) { const kb = +f[4].replace(/[^\d]/g, ''); if (Number.isFinite(kb)) { sum += kb; found = true; } }
  }
  return found ? sum / 1024 : null;
}
const cpuSnap = () => { let idle = 0, total = 0; for (const c of os.cpus()) { for (const k in c.times) total += c.times[k]; idle += c.times.idle; } return { idle, total }; };
function startSampler(intervalMs = 500) {
  const samples = []; let prev = cpuSnap(), stopped = false;
  const tick = async () => {
    if (stopped) return; const now = cpuSnap(), dt = now.total - prev.total, di = now.idle - prev.idle; prev = now;
    const [g, r] = await Promise.all([gpuMem(), procRamMB()]);
    samples.push({ t: Date.now(), gpu: g?.used ?? null, gpuTotal: g?.total ?? null, ram: r, cpu: dt > 0 ? 100 * (1 - di / dt) : null });
  };
  const iv = setInterval(tick, intervalMs); tick();
  const summarize = (since = 0) => {
    const s = samples.filter((x) => x.t >= since), col = (k) => s.map((x) => x[k]).filter(Number.isFinite);
    const mx = (a) => (a.length ? Math.max(...a) : null), av = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    return { samples: s.length, gpu_peak_mib: mx(col('gpu')), gpu_mean_mib: av(col('gpu')), gpu_total_mib: mx(col('gpuTotal')), llama_ram_peak_mb: mx(col('ram')), cpu_mean_pct: av(col('cpu')), cpu_peak_pct: mx(col('cpu')) };
  };
  return { summarize, stop() { stopped = true; clearInterval(iv); return summarize(); } };
}
module.exports = { startSampler, gpuMem, procRamMB };
