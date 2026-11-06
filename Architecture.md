# Celcius — Arsitektur Target (draf 1)

Dokumen ini adalah rancangan, bukan laporan hasil uji. Setiap angka bertanda **(perkiraan)** harus diukur di laptop target
(RTX 3050 Laptop 6 GB, RAM 28 GB, Windows) sebelum dijadikan keputusan. Klaim bertanda **(terverifikasi)** berasal dari dokumentasi
resmi atau sumber yang saya baca saat menyusun dokumen ini.

## 0. Koreksi terhadap rancangan sebelumnya

Dua batasan yang saya sampaikan sebelumnya terlalu keras, dan keduanya gugur setelah dicek:

1. **Training QLoRA 3B di 6 GB VRAM layak dicoba.** Dokumentasi Unsloth menyebut kebutuhan minimum QLoRA 4-bit untuk model 3B sekitar 3,5 GB
   (angka itu "absolute minimum"; batch kecil dan konteks pendek diperlukan) dan Unsloth berjalan di Windows **(terverifikasi)**.
   Training lokal bukan lagi "tidak realistis"; ia hanya tidak bisa berbagi GPU dengan TTS pada saat yang sama.
2. **Penerapan versi model tidak harus lewat merge + kuantisasi ulang.** llama.cpp bisa mengubah adapter PEFT menjadi GGUF-LoRA
   (`convert_lora_to_gguf.py`) dan memuatnya di llama-server dengan `--lora`, `--lora-init-without-apply`, lalu mengaktifkan atau menukar
   adapter lewat `POST /lora-adapters` tanpa memuat ulang bobot dasar **(terverifikasi)**. Itu membuat kandidat model, evaluasi, dan rollback sangat murah.

Satu hal yang tetap belum diketahui dan **harus diukur**, bukan diasumsikan: apakah VoxCPM2 (±2B parameter, dokumentasinya menyebut ±8 GB VRAM)
berjalan cukup cepat di 6 GB. Rancangan di bawah tidak bergantung pada jawabannya; ia menyiapkan jalur untuk kedua hasil (bagian 4.7).

## 1. Prinsip dan anggaran sumber daya

Urutan prioritas (dari Anda): kualitas jawaban > kecepatan respons/TTFT > memori dan konteks > pembelajaran berkelanjutan > suara > animasi.
Aturan operasional: **teks selalu bisa dijawab segera**; suara, avatar, dan belajar adalah lapisan yang boleh tertunda, tidak boleh menahan teks.

Kunci arsitektur: **RAM 28 GB adalah sumber daya yang selama ini tidak dimanfaatkan.** LLM 3B Q4 bisa tetap resident di RAM dan berjalan di CPU
(atau sebagian layer di GPU), sehingga VRAM 6 GB dapat dipakai bergantian oleh TTS atau oleh training.

| Mode | LLM (Qwen2.5-3B Q4) | TTS | Training | Avatar (renderer) |
|---|---|---|---|---|
| **Percakapan** | resident di RAM, CPU atau offload sebagian ke GPU (diputuskan benchmark) | GPU | mati | aktif |
| **Belajar (idle)** | tetap resident di CPU, melayani chat bila pengguna kembali | dimatikan (VRAM dibebaskan) | GPU, QLoRA | minimal |
| **Transisi** | tidak berhenti | dimuat ulang saat pengguna berinteraksi | berhenti di checkpoint terakhir | aktif |

Dengan susunan ini pengguna yang kembali saat training sedang berjalan **tetap menerima jawaban teks seketika** (LLM sudah di CPU).
Suara menyusul setelah GPU dibebaskan dan TTS dimuat. Waktu muat TTS belum diukur.

Perkiraan beban (ukur dulu): bobot 3B Q4_K_M ±2 GB; KV cache konteks 2048 relatif kecil; renderer Electron ±0,3–0,6 GB VRAM;
VoxCPM2 bobot ±4–5 GB ditambah aktivasi. Jumlah TTS + LLM di GPU kemungkinan melebihi 6 GB, itulah alasan LLM ditempatkan di CPU secara default.
Laju bicara manusia (±4–5 token/detik) jauh di bawah laju generasi CPU yang wajar untuk 3B Q4 **(perkiraan: beberapa token/detik hingga belasan)**,
jadi pipeline "LLM di CPU, TTS di GPU, keduanya paralel per kalimat" berpotensi terasa real-time. Ini hipotesis yang diuji di tahap M0.

## 2. Peta komponen

```
Electron main (orchestrator + ResourceManager + Brain)       Renderer (web/)
 ├─ llama-server (GGUF dasar + slot LoRA, :8089)   <─ /v1/*   ├─ Chat UI (streaming)
 ├─ TTS server (VoxCPM2, :8090)                    <─ /tts    ├─ Motion Engine (lapisan animasi)
 ├─ Brain (modul Node, SQLite/FTS5)                           └─ VRM + Three.js
 │    memory • retrieval • experience collector • scheduler
 ├─ Trainer (subproses Python, hanya saat mode Belajar)
 └─ Evaluator (subproses Python/Node, offline)
```

Keputusan: memori, retrieval, dan scheduler ditulis sebagai **modul Node di proses utama** (better-sqlite3), bukan layanan Python baru.
Python hanya untuk hal yang memang butuh ekosistemnya: training, evaluasi, TTS. Komunikasi lokal lewat loopback dan IPC Electron.

## 3. Versi model dan penerapan (fondasi semua fitur belajar)

- **Aset permanen:** `adapter/` dan `adapter.zip` hasil 20 jam training adalah `celcius-v1` dan tidak pernah ditimpa. Simpan juga hash SHA-256 di manifest.
- **`models/manifest.json`:** daftar versi (`id`, `base_model`, `adapter_path`, `gguf_path`, `created`, `eval_report`, `status` = baseline | candidate | active | rejected).
- **Dua jalur penerapan** (dipilih lewat eksperimen M1):
  - **Jalur merge** (yang dipakai sekarang): merge fp16 -> GGUF -> kuantisasi. Kualitas terbaik per ukuran, tapi tiap versi = file baru ±2 GB dan proses lebih berat.
    Dengan RAM 28 GB langkah ini bisa dilakukan lokal, tanpa Colab.
  - **Jalur LoRA-runtime:** satu GGUF dasar + adapter GGUF per versi, ditukar lewat `/lora-adapters`. Rollback = menonaktifkan adapter. Catatan dari sumber yang saya baca:
    menerapkan LoRA di atas basis terkuantisasi menurunkan kualitas sedikit; solusinya basis Q8_0 atau membandingkan hasil keduanya pada evaluator.
- **Aturan aktivasi:** kandidat berstatus `candidate` hingga lolos evaluator (bagian 4.6). Yang aktif hanya satu, dan versi sebelumnya selalu bisa dipulihkan dengan satu perintah.

## 4. Fitur

### 4.1 Mesin inferensi dan latensi
- **Tujuan:** TTFT rendah, jawaban stabil.
- **Arsitektur:** llama-server tetap resident; streaming SSE; penghematan prompt dengan awalan sistem yang tetap sehingga cache prompt bisa dimanfaatkan
  (verifikasi opsi `cache_prompt` pada build yang dipakai); batas konteks dinamis (anggaran token: sistem + memori terambil + riwayat ringkas + pesan).
- **Konteks panjang tanpa membengkak:** riwayat lama diringkas secara berkala menjadi catatan episodik (4.3), bukan dimasukkan mentah.
- **Optimasi:** harness benchmark yang mengukur TTFT, token/detik, RAM, VRAM untuk kombinasi `-ngl` (0, 10, 20, 99), `-c`, kuantisasi (Q4_K_M vs Q8_0), thread CPU.
  Eksperimen terpisah: *speculative decoding* dengan model draf kecil (Qwen2.5 0.5B) bila hasil benchmark menunjukkan manfaat.
- **Tahap:** M0. **Alternatif jika CPU terlalu lambat:** offload sebagian layer ke GPU saat TTS idle, atau Q4 dengan lebih sedikit thread agar tidak bersaing dengan renderer.

### 4.2 Persona dan bahasa
- Persona dijaga di tiga lapis: system prompt (satu sumber kebenaran, dipakai training dan inferensi), memori preferensi, dan data training.
- Konsistensi bahasa (Indonesia/Inggris/Jepang): diuji otomatis oleh evaluator (4.6) setiap kandidat; sampler anti-pengulangan sudah ada.
- **Tahap:** M0–M6.

### 4.3 Sistem memori (bukan sama dengan belajar model)
Lima lapis, satu basis data SQLite lokal:

| Lapis | Isi | Penyimpanan | Kapan dipakai |
|---|---|---|---|
| Episodik | ringkasan percakapan/sesi bertanggal | tabel `episodes` + FTS5 | "kemarin kita bahas apa" |
| Semantik | fakta stabil (proyek, nama, lingkungan kerja) | tabel `facts` (kategori, confidence, source, updated) | konteks tiap jawaban yang relevan |
| Preferensi | gaya jawaban, bahasa, kebiasaan | tabel `preferences` | selalu, di system prompt ringkas |
| Umpan balik | koreksi, jempol naik/turun | tabel `feedback` -> sumber data training | belajar, bukan konteks |
| Retrieval | pencarian gabungan | FTS5 dulu; embedding opsional | sebelum setiap jawaban |

- **Penulisan memori:** ekstraksi fakta dilakukan **setelah** jawaban terkirim (prioritas rendah, memakai aturan dulu, LLM hanya bila perlu),
  tidak pernah di jalur kritis. Setiap fakta punya confidence dan sumber; kontradiksi menimpa dengan riwayat, bukan menumpuk.
- **Konsolidasi:** saat idle, episode lama diringkas, fakta duplikat digabung, memori kedaluwarsa diberi skor turun. Ada batas penyimpanan dan penghapusan yang bisa dilakukan pengguna.
- **Embedding (opsional, setelah FTS5 terbukti kurang):** model embedding multibahasa kecil di CPU (kandidat: keluarga multilingual-e5-small atau bge-m3; verifikasi ukuran dan dukungan Indonesia/Jepang saat implementasi),
  disimpan sebagai vektor di SQLite. Pilihannya diputuskan dengan evaluasi recall pada percakapan nyata, bukan sebelumnya.
- **Integrasi:** `web/index.html` sekarang menyimpan `mem` dan `kb` di `localStorage`; keduanya dimigrasikan ke SQLite lewat IPC, dengan impor sekali jalan.
- **Tahap:** M2. **Ketergantungan:** tidak ada.

### 4.4 Pengumpul pengalaman dan pembelajaran dari umpan balik
- Setiap giliran dapat dicatat sebagai calon contoh: `pending -> validated | rejected -> used_for_training`.
- Sinyal: koreksi eksplisit ("bukan, maksudku…"), jempol, penggantian jawaban, pengulangan pertanyaan (indikasi jawaban gagal), hasil tool.
- **Validasi:** aturan otomatis (buang yang mengandung rahasia: pola token/kata sandi/kunci API, bahasa tidak konsisten, jawaban pendek tak berguna) lalu antrean tinjauan singkat
  yang bisa dilewati. Jawaban AI **tidak** otomatis dianggap benar; hanya koreksi pengguna dan contoh yang disetujui yang masuk `validated`.
- **Kontrol pengguna:** tampilkan, hapus, ekspor, matikan pengumpulan; pengecualian per aplikasi/topik.
- **Format dataset:** SFT (instruksi -> jawaban baik) dan pasangan preferensi (jawaban buruk vs koreksi) untuk DPO/ORPO bila nanti diperlukan.
- **Tahap:** M5. **Ketergantungan:** M2.

### 4.5 Pembelajaran perilaku (opsional, opt-in)
- Cakupan: aplikasi/proyek yang sering dipakai, jam aktif, jenis tugas. Analisis frekuensi dan statistik sederhana; tanpa LLM per kejadian.
- Batas keras: tidak ada keylogging, tidak ada tangkapan layar diam-diam; daftar pengecualian aplikasi; data hanya lokal dan bisa dihapus.
- Keluaran: fitur konteks ("biasanya kamu mengerjakan X sekitar jam ini") yang masuk memori preferensi.
- **Tahap:** M5+ setelah memori stabil.

### 4.6 Fine-tuning lanjutan yang bisa dihentikan dan dilanjutkan
- **Basis:** mulai dari adapter `celcius-v1` (dimuat sebagai trainable) di atas Qwen2.5-3B-Instruct 4-bit, tidak pernah dari nol.
- **Pencegahan lupa (forgetting):** campurkan data *rehearsal* dari baseline (misalnya 70% data baru tervalidasi, 30% sampel Indonesia/Jepang/Inggris dari set awal),
  learning rate rendah, jumlah langkah per sesi terbatas. Risiko nyata: model yang belajar dari percakapannya sendiri bisa menyimpang atau mengulang kesalahan; karena itu hanya `validated` yang dilatih.
- **Sumber daya:** sesi pada mode Belajar, batch 1, gradient accumulation, gradient checkpointing, panjang urutan pendek (mulai 512), satu sesi dibatasi waktu.
  Mulai dengan Unsloth atau PEFT+bitsandbytes di Windows; pilihan final setelah uji VRAM puncak di M6.
- **Checkpoint atomik** (sesuai direktif): tulis ke direktori sementara -> validasi (hash, muat ulang) -> rename. Isi: bobot adapter, optimizer, scheduler,
  global step, epoch, RNG, posisi dataset, konfigurasi, identitas base model, versi adapter. Interval pendek (menit), retensi tidak menghapus baseline.
  `train_lora.py` saat ini memakai `save_strategy="no"`, jadi bagian ini perlu ditulis, bukan sekadar diaktifkan.
- **Penjadwal idle:** mulai bila: tidak ada interaksi dalam N menit, tidak ada inferensi/TTS aktif, daya AC (opsional), suhu GPU wajar, data baru melebihi ambang, pengguna mengizinkan.
  Berhenti: ada interaksi (simpan di checkpoint terakhir, bebaskan GPU di latar belakang), baterai, suhu tinggi. Tersedia jeda, lanjut, berhenti aman, status, log.
- **Evaluator (gerbang aktivasi):** serangkaian uji otomatis yang membandingkan kandidat dengan versi aktif:
  1. perplexity pada set validasi tetap (deteksi degradasi);
  2. uji kepatuhan bahasa (permintaan Inggris/Jepang/Indonesia dijawab dalam bahasa yang diminta, deteksi bahasa otomatis);
  3. uji pengulangan (rasio n-gram berulang pada keluaran panjang);
  4. uji persona dan identitas (nama, pencipta, tidak mengaku model lain);
  5. uji instruksi sederhana dengan jawaban yang bisa dicek otomatis;
  6. regresi terhadap `celcius-v1`.
  Penilaian oleh LLM sendiri tidak dijadikan satu-satunya dasar (bias terhadap dirinya); tinjauan manusia pada sampel kecil dipakai untuk kandidat penting.
- **Alternatif jika VRAM puncak melebihi 6 GB:** panjang urutan lebih pendek, LoRA rank lebih kecil, Colab sebagai pekerja berat yang dimulai pengguna (paket data keluar, adapter kembali),
  atau CPU sebagai cadangan lambat untuk sesi kecil.
- **Tahap:** M6 (trainer + evaluator), M7 (penjadwal). **Ketergantungan:** M1, M4.4.

### 4.7 Suara
- **Abstraksi `TTSProvider`** agar mesin dapat diganti tanpa mengubah avatar. Sekarang satu implementasi: VoxCPM2 + `voice_ref.wav`. Tidak ada fallback suara lain (keputusan Anda).
- **Gerbang keputusan** dari `tts/bench.py` (sudah ada, belum dijalankan): RTF per kalimat, VRAM puncak, waktu muat.
  - RTF < ±0,8 dan muat: pertahankan VoxCPM2, optimalkan chunking dan antrean.
  - RTF lebih tinggi atau tidak muat: (a) kuantisasi/presisi lebih rendah bila didukung, (b) jalankan TTS saat LLM di CPU dan paralelkan per kalimat,
    (c) *voice factory*: pakai VoxCPM2 (di Colab) hanya untuk membuat korpus suara dari teks publik dengan suara acuan, lalu latih model TTS kecil yang cepat untuk laptop (suara tetap sama),
    (d) cache frasa yang sering diucapkan (sapaan, konfirmasi) yang dirender sebelumnya.
- **Lip-sync:** sekarang dari amplitudo; tahap berikutnya viseme sederhana (a/i/u/e/o) dari spektrum.
- **Tahap:** M8 (setelah benchmark M0).

### 4.8 Motion Engine untuk avatar
Lapisan yang dijumlahkan, dikendalikan state, bukan LLM per frame:

1. **Prosedural** (selalu aktif): napas, kedip acak, gerak halus tubuh, perpindahan berat badan, gerak mata/saccade, pandangan ke kamera/kursor.
2. **Klip gerakan** (`.vrma`): gerakan hasil rekaman, diputar dengan `AnimationMixer` dan *crossfade*.
3. **Ekspresi**: ekspresi VRM (senang, marah, sedih, santai, terkejut) dengan transisi halus, plus mulut dari TTS.
4. **IK dan batasan**: bidik tangan ke objek (gitar, benda interaktif), batas sudut sendi, tanpa konflik antara idle dan gesture (idle diredam saat klip aktif).
5. **Spring bone** bawaan VRM untuk rambut dan pakaian.

- **Format:** VRM Animation (`.vrma`) adalah format standar yang bisa dipakai untuk model VRM mana pun; `@pixiv/three-vrm-animation` memuatnya
  (`VRMAnimationLoaderPlugin`, `createVRMAnimationClip`) dan add-on VRM untuk Blender mengekspornya **(terverifikasi)**.
- **Pipeline mocap:** `mocap.html` (MediaPipe) -> JSON landmark -> *solver* ke rotasi tulang humanoid (bukan memakai landmark langsung) -> BVH atau klip internal ->
  rapikan di Blender (yang sudah Anda pakai) -> ekspor `.vrma` -> pustaka klip berlabel. Penghalusan: filter One-Euro. Kalibrasi proporsi tubuh per karakter lewat retargeting humanoid.
  Alat bantu yang sudah ada di ekosistem (mis. konverter BVH ke VRMA) dievaluasi sebelum menulis sendiri.
- **Jembatan emosi/intent:** keluaran model diperkaya penanda ringan (mis. `emosi`, `gestur`, `intensitas`) yang dibuang sebelum TTS dan teks.
  Dua jalur: (1) sekarang, pengklasifikasi aturan + kata kunci pada teks jawaban; (2) nanti, penanda dilatih ke dalam data (butuh kandidat model baru).
  Pemilihan gestur memakai *cooldown* dan variasi agar tidak terasa mekanis.
- **Tahap:** M3 (prosedural + pemutar `.vrma`), M4 (pipeline mocap). Tidak bergantung pada training atau memori.

### 4.9 Tools, izin, dan MCP
- **Tingkat izin:** baca-saja, perlu persetujuan, otomatis-diizinkan, diblokir. Daftar putih jalur dan perintah; perintah destruktif tidak pernah otomatis; semua tindakan masuk log audit lokal.
- **Pemanggilan tool:** gunakan fitur tool-calling yang didukung template Qwen2.5 melalui llama-server (verifikasi dukungan dan flag pada build yang dipakai).
  Eksekutor tool berjalan di proses terpisah dengan hak terbatas.
- **MCP:** klien MCP setelah lapisan izin matang. Tidak ada data lokal yang dikirim keluar tanpa persetujuan.
- **Tahap:** M9.

### 4.10 Observabilitas dan pengujian
- Log terstruktur; metrik TTFT, token/detik, RAM/VRAM, antrean TTS, FPS renderer; panel status sederhana.
- Tes: evaluator model (4.6), tes unit untuk memori/scheduler/checkpoint (termasuk simulasi proses mati mendadak), tes manual terdokumentasi untuk avatar.

## 5. Peta jalan dengan kriteria selesai

| # | Tahap | Isi | Selesai bila | Bergantung pada |
|---|---|---|---|---|
| M0 | Baseline dan ukur | cadangan + hash adapter; benchmark llama-server (`-ngl`, kuantisasi); `bench.py` TTS; skrip metrik | tabel hasil ukur nyata | – |
| M1 | Manifest versi + LoRA-runtime | `manifest.json`; konversi adapter v1 ke GGUF-LoRA; uji tukar dan rollback via `/lora-adapters`; bandingkan dengan jalur merge | keputusan jalur penerapan berdasarkan data | M0 |
| M2 | Memori v1 | SQLite + FTS5, API memori, migrasi dari `localStorage`, kontrol pengguna | memori bertahan antarsesi, bisa dilihat/dihapus | – |
| M3 | Motion Engine v1 | lapisan prosedural, ekspresi, pemutar `.vrma`, jembatan emosi berbasis aturan | gerakan halus tanpa konflik, FPS tercatat | – |
| M4 | Pipeline mocap -> VRMA | solver, penghalusan, ekspor, pustaka klip | 5+ klip berlabel diputar benar | M3 |
| M5 | Pengumpul pengalaman | skema status, validasi, dataset builder, UI kontrol | dataset valid dapat diekspor | M2 |
| M6 | Trainer + evaluator | checkpoint atomik + resume, rehearsal, evaluator otomatis | kandidat dilatih, dihentikan, dilanjutkan, dievaluasi | M1, M5 |
| M7 | Penjadwal idle | deteksi idle, cek sumber daya, mode Belajar/Percakapan | training berjalan saat idle dan berhenti aman saat pengguna kembali | M6 |
| M8 | Suara | putusan dari M0; optimasi atau jalur alternatif; viseme | RTF dan jeda sesuai target | M0 |
| M9 | Tools dan izin | lapisan izin, tool-calling, log audit | tool aman berjalan dengan persetujuan | M2 |

Urutan pengerjaan yang saya sarankan, sesuai prioritas Anda: **M0 -> M1 -> M2 -> M3 -> M5 -> M6 -> M7 -> M4 -> M8 -> M9**, dengan M3 dan M2 bisa jalan paralel.

## 6. Risiko dan mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Belajar dari percakapan menurunkan kualitas | model lupa bahasa atau menyimpang | hanya data tervalidasi, rehearsal, LR rendah, evaluator + rollback |
| VRAM tak cukup untuk training/TTS | fitur gagal | pembagian mode (bagian 1), parameter hemat, Colab opsional |
| Hasil LoRA-runtime lebih buruk dari merge | kualitas turun | uji M1; basis Q8_0; tetap jalur merge |
| Konflik resource saat transisi mode | respons lambat | LLM tetap di CPU, transisi di latar belakang, checkpoint pendek |
| Kehilangan hasil training 20 jam | fatal | cadangan + hash + manifest, tidak ada skrip yang menulis ke `adapter/` |
| Kebocoran data sensitif ke dataset | privasi | filter pola rahasia, tinjauan, kontrol hapus, semua lokal |
| Tool berbahaya | keamanan | tingkat izin, daftar putih, log audit, tanpa tindakan destruktif otomatis |

## 7. Data yang dibutuhkan untuk tahap berikutnya (bertahap)

Untuk M0 dan M1, kirim secara spesifik:
1. `adapter_config.json` dari adapter 20 jam (rank, target modul, base model).
2. Skrip dan argumen yang sebenarnya dipakai pada training 20 jam (versi `train_lora.py` saat itu).
3. Hasil `nvidia-smi` dan versi driver.
4. Log `llama-server` saat memuat model (kuantisasi, jumlah layer, token/detik) dengan `gpuLayers` 0 dan 99.
5. Keluaran `python bench.py` di folder `tts`.
6. Struktur folder repo saat ini (`tree /F` tanpa `node_modules`).

## 8. Hasil ukur awal (diterima 6 Nov 2026)

| Data | Hasil | Arti |
|---|---|---|
| `adapter_config.json` | LoRA standar: r=16, alpha=32 (skala 2,0), dropout 0,05, 7 proyeksi linear, base `Qwen/Qwen2.5-3B-Instruct`, PEFT 0.21.2, tanpa DoRA/rsLoRA/`modules_to_save` | cocok untuk `convert_lora_to_gguf.py` (M1) tanpa kendala yang terlihat |
| Skrip training | `train_lora.py --n 6000 --ja 4000 --en 4000 --epochs 1 --base Qwen/Qwen2.5-3B-Instruct`; QLoRA nf4, fp16 (T4), batch efektif 16, lr 2e-4, maxlen 512, tanpa checkpoint dan tanpa set validasi | resep `celcius-v1` kini terdokumentasi; set validasi harus dibuat dari baris yang tidak terpakai (`eval/make_heldout.py`) |
| `nvidia-smi` | RTX 3050 Laptop, 6144 MiB, driver 595.71 (CUDA 13.2), idle 130 MiB | GPU sehat dan hampir seluruh 6 GB tersedia |
| `bench.py` | **berjalan di CPU** ("GPU: TIDAK ADA", "device: cpu"), RTF 12–24, waktu muat 63,5 s | PyTorch di venv adalah build CPU-only (bawaan pip Windows). Angka ini **tidak** menjawab apakah VoxCPM2 cukup cepat di GPU; harus diulang setelah memasang PyTorch CUDA |
| `llama-server` (CPU, `gpuLayers` 0) | prompt: 243 token dalam 4,77 s (50,9 token/s); generasi: 8,16 token/s | generasi sudah di atas laju bicara (±4–5 token/s). Hambatan sebenarnya adalah **TTFT ±4,8 s** untuk prompt dingin 243 token |

Kesimpulan sementara: (1) masalah latensi teks ada di pemrosesan prompt, bukan kecepatan generasi; (2) pertanyaan VoxCPM2-di-6GB masih terbuka dan jawabannya hanya bisa didapat dari `bench.py` dengan PyTorch CUDA;
(3) sebagian besar tahap M0 tinggal dua pengukuran: `bench.py` (GPU) dan `scripts/bench-llm.ps1`.

Langkah lanjutan latensi (M0): periksa apakah permintaan kedua dan seterusnya memakai ulang awalan prompt (log `prompt eval time` harus turun drastis); uji `-ngl` parsial via `llama-bench`;
pertimbangkan merapikan system prompt hanya bersamaan dengan training berikutnya (teks harus identik dengan yang dipakai saat training).

### 8.1 Hasil lanjutan (6 Nov 2026, model `celcius-q8_0.gguf`, 3,05 GiB, backend Vulkan, build 12068)

`llama-bench` (pp256 = pemrosesan prompt, tg64 = generasi, token/detik):

| `-ngl` | pp256 | tg64 |
|---:|---:|---:|
| 0 (CPU) | 59 | 12,7 |
| 12 | 428 | 13,7 |
| 24 | 673 | 21,1 |
| 99 (semua di GPU) | 1405 | 40,7 |

Log `llama-server` (CPU): pesan pertama 245 token = 4,6 s; pesan kedua dan ketiga masing-masing hanya 17 token baru = ±0,5 s. **Cache awalan prompt sudah bekerja.**
Jadi TTFT dingin (4,6 s) hanya terjadi pada pesan pertama setelah aplikasi dibuka; `web/index.html` kini mengirim permintaan pemanasan 1 token saat dibuka.

Perangkat Vulkan yang terdeteksi: Intel UHD 770 (iGPU, indeks 0) dan RTX 3050 6 GB (indeks 1). Periksa dengan `llama-server.exe --list-devices` dan bila perlu kunci ke RTX (`llamaArgs`: `--device`, atau variabel lingkungan `GGML_VK_VISIBLE_DEVICES=1`; verifikasi nama opsi di build ini).

Dua profil penempatan (keputusan menunggu angka VRAM VoxCPM2 dari `bench.py` GPU):
- **A. LLM penuh di GPU:** TTFT dan kecepatan terbaik (40,7 t/s), tetapi menyisakan ±2,5 GB, kemungkinan tidak cukup untuk VoxCPM2.
- **B. LLM di CPU, TTS di GPU:** 12,7 t/s, tiga kali laju bicara; TTFT ±0,5 s dengan cache awalan. Menyisakan hampir seluruh VRAM untuk TTS.