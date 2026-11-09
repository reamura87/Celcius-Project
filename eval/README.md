# Harness evaluasi Celcius (M1.1)

Alat ukur **di luar aplikasi**: tidak mengubah Celcius. Ia berbicara langsung ke `llama-server` (port 8089) milik aplikasi yang sedang berjalan.
Status verifikasi: semua kode diuji terhadap **llama-server palsu** (`node --test`, 19 tes). **Belum dijalankan terhadap llama-server asli**; lihat "Hal yang perlu dipastikan pada run pertama".

## Persiapan
1. `npm start` (aplikasi harus berjalan agar `llama-server` aktif). Jangan mengobrol saat pengukuran (`-np 1`: satu permintaan pada satu waktu).
2. Node.js ≥ 18 (untuk `fetch`).

## Kualitas (S1 instruksi · S2 bahasa · S3 persona · S4 degenerasi · S5 penalaran ringan)
```
node eval\run-quality.js --label baseline-q8
node eval\run-quality.js --label baseline-q8-precise --profile precise     (suhu lebih rendah)
node eval\run-quality.js --label baseline-q8 --repeats 3                    (ulang dengan seed berbeda)
```
Hasil: `eval\results\<waktu>_<label>_quality.json` (+ `.md`) berisi tiap keluaran model, hasil tiap cek, dan tingkat lulus per suite dengan selang 95% (Wilson).
Perkiraan waktu di CPU dengan model Q8 (±12 token/detik): beberapa menit hingga belasan menit. **Sampel kecil**: 53 butir; selisih kecil bukan bukti.

## Performa dan sumber daya (protokol VRAM dengan avatar aktif)
1. Atur `gpuLayers` (dan `ctx`) di `config.json` ke nilai yang diuji, jalankan `npm start`, **biarkan jendela avatar terbuka**.
2. `node eval\run-perf.js --label q8-ngl0`
3. Tutup aplikasi, ubah nilai berikutnya (mis. 12, 24, 99), ulangi dengan label berbeda (`q8-ngl12`, …).
4. **Kembalikan `config.json` ke nilai semula** setelah selesai. Keputusan default baru tetap di tangan Anda.

Yang diukur: `cold` (awalan unik, tanpa cache), `warm_same` (permintaan identik), `kb_toggle` (efek menyisipkan teks KB ke system prompt pada riwayat 0/3/6 pasang),
`stream_ttft` (streaming seperti aplikasi), `throughput` (token/detik generasi), plus VRAM (nvidia-smi), RAM llama-server, dan CPU selama pengujian.
Kriteria VRAM yang disepakati: puncak ≤ 5,3 GiB ≈ **5427 MiB** dari 6144 MiB, dengan avatar aktif.

## Membandingkan
```
node eval\report.js eval\results\A_quality.json eval\results\B_quality.json --margin 0.10
node eval\report.js eval\results\A_perf.json eval\results\B_perf.json
```
Kualitas: keluar dengan kode 3 bila ada suite yang **jelas lebih buruk** (selang kepercayaan tidak tumpang-tindih) atau melewati margin non-inferioritas.

## Perplexity (S6, opsional)
`pip install datasets` -> `python eval\make_heldout.py` -> `node eval\make_ppl_text.js` -> `powershell -ExecutionPolicy Bypass -File eval\run-ppl.ps1`.
Opsi `llama-perplexity` belum diverifikasi pada build Anda; bila error, kirim keluaran `llama\llama-perplexity.exe --help`.

## Hal yang perlu dipastikan pada run pertama (belum terbukti)
- Apakah llama-server asli mengembalikan `timings` (`prompt_n`, `cache_n`, `prompt_ms`, …) pada respons non-stream. Bila kolom bernilai `–`, kirim satu berkas hasil agar saya sesuaikan pembacanya.
- `cache_n` mungkin tidak ada di build Anda; `prompt_n` (token yang benar-benar diproses) tetap cukup untuk membaca efek cache.
- Heuristik bahasa (stopword + aksara) dan cek persona berbasis kata bisa salah pada kasus tepi; periksa butir yang GAGAL secara manual pada run pertama sebelum mempercayai angkanya.

## Membandingkan model lain (M1.2/M1.3) dan eksperimen petunjuk bahasa
- `--lang-hint` pada `run-quality.js`: bila prompt meminta bahasa tertentu, ditambahkan "(Reply only in X.)" ke pesan pengguna. Ini eksperimen untuk mengukur manfaat IntentRouter bahasa tanpa training; bukan perubahan aplikasi.
- `eval\m1_3_base_and_lora_colab.ipynb`: membuat GGUF model dasar (kontrol) dan adaptor GGUF-LoRA. Cara menjalankan llama-server uji di port 8099 ada di sel terakhir notebook.
- Bandingkan: `node eval\report.js eval\results\A_quality.json eval\results\B_quality.json`.
