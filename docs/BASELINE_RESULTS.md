# Hasil baseline `celcius-v1` (celcius-q8_0.gguf) — 7 Nov 2026

Sumber: `eval/run-quality.js` (profil `current`, llama-server build b12068, CPU `-ngl 0`) dan `eval/run-perf.js`. Sampel kecil; baca sebagai sinyal, bukan bukti halus.

## Kualitas (53 butir)
| Suite | Hasil | Catatan |
|---|---|---|
| S1 instruksi | 15/18 | gagal: 2 kalimat tepat (id, ja), daftar berpoin (ja) |
| S2 bahasa | 4/8 (5/8 setelah koreksi harness) | 3 kegagalan asli, 1 alarm palsu (jawaban "Paris" terlalu pendek untuk dinilai bahasanya) |
| S3 persona | 6/6 | nama, pencipta, tidak mengaku model lain |
| S4 degenerasi | 6/6 | tidak ada pengulangan pada 6 prompt panjang |
| S5 penalaran | 13/15 | gagal: planet terdekat Matahari (menjawab Bumi); soal Jepang (menjelaskan, terpotong 16 token, tanpa huruf) |

**Pola S2 (hipotesis, belum terbukti):** semua tiga kegagalan asli adalah permintaan lintas-bahasa yang prompt-nya Indonesia/Jepang: model menjawab dalam bahasa *prompt*, bukan bahasa yang diminta
(id->Inggris dijawab Indonesia; ja->Inggris dijawab Jepang; id->Jepang dijawab Indonesia). Dua permintaan lintas-bahasa dari prompt Inggris berhasil. Dugaan: data fine-tune
Indonesia dan Jepang selalu berpasangan jawaban sebahasa dengan prompt, sehingga instruksi bahasa eksplisit kalah. Pengujian: model dasar sebagai kontrol (M1.2) dan petunjuk bahasa (`--lang-hint`).

## Performa (CPU, `-ngl 0`, ctx 2048)
| Ukuran | Hasil |
|---|---|
| Cold (224 token) | 4445 ms prompt (50 token/s) |
| Warm (prompt identik) | 129 ms (cache_n 228 dari 229 token) |
| TTFT streaming hangat | median 134 ms, 10,9 token/s |
| Generasi | 11,5–11,9 token/s |
| RAM llama-server puncak | 3440 MB |
| CPU selama uji | rata-rata 90%, puncak 100% |
| VRAM | 140 -> 147 MiB (hampir tidak berubah; LLM di CPU) |

Terverifikasi dengan llama-server asli: respons non-stream memuat `timings` dan `cache_n`; cache awalan prompt bekerja.

**Teks KB di system prompt:** data run ini (riwayat 3 pasang): 203 token diproses ulang dan 4420 ms, dibanding 9 token dan 282 ms bila system stabil; konsisten dengan klaim bahwa riwayat setelah titik sisipan diproses ulang.
Angka riwayat 0 dan 6 pasang pada run itu **tidak dapat dipercaya** (median per kolom dari baris berbeda; cache RAM lintas iterasi). Harness sudah diperbaiki; ulangi.

## Hasil lanjutan (8 Nov 2026)

### Eksperimen petunjuk bahasa (S2, `--lang-hint`, run valid, n=8, seed tetap)
S2 dengan petunjuk: 6/8 (CI 41–93%). Tanpa petunjuk: 5/8 setelah koreksi harness. **Satu butir berubah** (id->Jepang: sekarang dijawab Jepang).
**Dua permintaan berbahasa Inggris dari prompt non-Inggris tetap gagal walau petunjuk "(Reply only in English.)" ditambahkan** (s2-1: id->Inggris dijawab Indonesia; s2-3: ja->Inggris dijawab Jepang).
Permintaan Jepang dan Indonesia dari prompt Inggris/Indonesia berhasil. Jadi kelemahannya lebih sempit dari dugaan awal: **menghasilkan bahasa Inggris saat percakapan berbahasa Indonesia/Jepang**.
Catatan: n=2 untuk kasus ini dan sampling acak; perlu `--repeats`. Juga tampak noise persona di luar S3: s2-1 menulis pencipta "Reaura" (seharusnya Reamura); s2-3 menghasilkan kalimat Jepang yang janggal.

### Performa v2 (CPU, `-ngl 0`; perbaikan harness; 3 run per kondisi; baris utuh)
| Riwayat | system stabil | system + teks KB | selisih |
|---|---|---|---|
| 0 pasang | 9 token, 258 ms | 50 token, **3748 ms** | +3,5 s |
| 3 pasang | 9 token, 269 ms | 203 token, 906 ms | +0,64 s |
| 6 pasang | 9 token, 262 ms | 359 token, 1728 ms | +1,47 s |
Sebaran antar-run kecil (mis. hist0: 3634/3760/3748 ms), jadi efeknya nyata: menyisipkan teks KB ke system prompt menambah **0,6–3,5 detik** pada giliran yang terkena (sapaan "halo" memicunya).
**Belum terjelaskan:** laju prompt tidak konstan (13 token/s pada 50 token, ±220–350 token/s pada 200–360 token, 50 token/s pada prompt dingin 224 token). Dugaan (belum diuji): perbedaan jalur batch kecil vs besar dan/atau penugasan operasi ke GPU oleh backend Vulkan. Jangan dipakai sebagai model biaya sebelum diselidiki.
Lainnya: TTFT streaming hangat median 128,5 ms; 12,3 token/s; CPU rata-rata 85–92%; VRAM 140->147 MiB; RAM llama-server puncak 3,6 GB.

### GPU
`nvidia-smi` saat aplikasi berjalan: proses bergrafik yang tampil = launcher game, `llama-server.exe` (backend Vulkan terinisialisasi walau `-ngl 0`); **proses Electron/Celcius tidak tampil**. Tampaknya avatar dirender di GPU Intel, bukan RTX (perlu dikonfirmasi lewat Windows Graphics settings atau saat avatar bergerak).

## Hasil LoRA-runtime (8 Nov 2026): model dasar Q8_0 + adaptor GGUF-LoRA f16 (`--lora`, skala 1.0)
| Suite | merged Q8 (baseline) | base + LoRA 1.0 |
|---|---|---|
| S1 | 15/18 | 16/18 |
| S2 | 4/8 (5/8 setelah koreksi harness) | 5/8 |
| S3 | 6/6 | 5/6 (s3-3: menyangkal ChatGPT dengan benar tetapi tidak menyebut nama; cek yang ketat/derau sampling) |
| S4 | 6/6 | 6/6 |
| S5 | 13/15 | 13/15 (butir salah sama: s5-id-4, s5-ja-2) |
Total 45/53 vs 45/53 (setelah koreksi harness). Dengan petunjuk bahasa: 6/8, kegagalan sama (s2-1 id->Inggris, s2-3 ja->Inggris). Kesan awal: **LoRA-runtime setara model yang digabung** pada set kecil ini.
Biaya LoRA tak digabung: generasi median 12,7 token/s vs 14,0 token/s model dasar polos (log server), sekitar -9%.
**Belum terbukti:** (a) adaptor benar-benar teraplikasi (log server tidak menyebut "lora"; kecepatan yang turun hanya petunjuk tidak langsung) -> skrip v2 memeriksa `GET /lora-adapters`; (b) perbandingan dengan model dasar polos: hasil kualitas `base-only` belum dikirim.
**Kegagalan skala 0,75 dan 0,5:** `--lora-scaled` menerima format `FNAME:SCALE,...`; jalur Windows berisi "C:" sehingga salah dipecah ("invalid stof argument"). Skrip v2 memakai `POST /lora-adapters` untuk mengatur skala.
Kesalahan nama pencipta ("Reaura") muncul pada keluaran adaptor, baik merged maupun runtime.

## Model dasar polos vs adaptor (8 Nov 2026)
Tiga konfigurasi, sampling sama (`current`), seed tetap, build b12068, CPU `-ngl 0`: **merged Q8** (baseline `celcius-v1`), **dasar Q8 + LoRA f16 skala 1,0** (runtime), **dasar Q8 polos** (kontrol).

| Suite | merged Q8 | dasar + LoRA 1,0 | dasar polos |
|---|---|---|---|
| S1 instruksi | 15/18 | 16/18 | 15/18 |
| **S2 bahasa** | 4/8 (5/8 setelah koreksi harness) | 5/8 | **8/8** |
| S3 persona | 6/6 | 5/6 | 5/6 |
| S4 degenerasi | 6/6 | 6/6 | 6/6 |
| S5 penalaran | 13/15 | 13/15 | 11/15 |
| Total | 44 (45 setelah koreksi) | 45 | 45 |

**Temuan utama (kuat untuk n kecil karena arahnya konsisten pada dua varian adaptor):** model dasar polos menjawab bahasa yang diminta dengan benar pada **8/8 butir S2, tanpa petunjuk bahasa** (dengan petunjuk juga 8/8).
Adaptor (merged maupun runtime) gagal pada tiga permintaan lintas-bahasa (s2-1, s2-3, s2-4); petunjuk bahasa hanya memperbaiki s2-4. Jadi **fine-tune yang menggeser kepatuhan terhadap bahasa yang diminta**, bukan keterbatasan model 3B itu sendiri.
Butir yang gagal pada adaptor tetapi lulus pada dasar polos: s1-ja-1, s2-1, s2-3, s2-4. Sebaliknya (lulus pada adaptor, gagal pada dasar): s1-id-1, s1-en-2, s5-en-4, s5-ja-1.

**Kehati-hatian:**
- Total 45/53 sama untuk ketiganya; profilnya berbeda. Keunggulan adaptor pada S5 (+2) dan format daftar S1 berasal dari 4 butir; itu bisa derau.
- Dasar polos juga bermasalah bahasa: s1-en-2 ("List 3 colors") dijawab dengan kata Jepang (赤 青 白) tanpa berpoin.
- Verifier tidak menilai kebenaran isi: s1-id-1 lulus pada adaptor padahal isinya keliru ("menyembuhkan karbon dioksida"), s1-ja-1 berisi sains yang salah.
- **Suite ini tidak mengukur keluwesan, kealamian, dan gaya persona (hangat, ceria) yang justru menjadi tujuan fine-tune.** Tidak adanya keunggulan terukur bukan berarti fine-tune tidak bernilai. Perlu penilaian manusia buta (lembar review) dan/atau perplexity pada set tak terlihat.
- Salah ejaan pencipta ("Reaura") muncul pada keluaran adaptor (run petunjuk, merged dan runtime), tidak pada dasar polos ("Reamura" benar pada 3 jawaban yang menyebutnya).

**LoRA-runtime terbukti bekerja:** `GET /lora-adapters` mengembalikan adaptor id 0 dengan `scale` 1,0 pada satu run dan 0,5 pada run lain, jadi adaptor termuat dan skala dapat diatur lewat `POST /lora-adapters` tanpa memuat ulang model.
**Belum ada:** hasil kualitas pada skala 0,75 dan 0,5. Itu yang menentukan apakah menurunkan skala memulihkan kepatuhan bahasa tanpa kehilangan manfaat adaptor.