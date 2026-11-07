# Pemulihan baseline `celcius-v1`

Aset yang **tidak boleh diubah, ditimpa, atau dihapus**:
| Aset | Lokasi (di komputer Anda) | Catatan |
|---|---|---|
| Adaptor LoRA | `D:\AI-Assistant\adapter_model.safetensors` (+ `adapter_config.json`, `adapter.zip` bila ada) | hasil training ±20 jam; SHA-256 tercatat di `models/manifest.json` |
| GGUF aktif | `%APPDATA%\Celcius\models\celcius-q8_0.gguf` | turunan dari adaptor + model dasar; dapat dibuat ulang |

Aturan: versi baru selalu **id baru** (`celcius-v1.1`, …) dan berkas baru; yang lama tidak disentuh.

## Membuat cadangan (sekali, lakukan sekarang)
Simpan di **drive/lokasi lain** (bukan folder proyek):
```
node scripts\snapshot-baseline.js --backup E:\cadangan-celcius
node scripts\snapshot-baseline.js --backup E:\cadangan-celcius --copy-gguf     (opsional, ±3,2 GB)
```
Skrip menyalin tanpa menimpa, memverifikasi hash salinan, dan menulis `SHA256SUMS.txt` dan `manifest.json` di `celcius-v1\`.

## Memeriksa keutuhan kapan saja (PowerShell)
```
Get-FileHash D:\AI-Assistant\adapter_model.safetensors -Algorithm SHA256
```
Hasilnya harus: `A983FAC5F8728E83476EFE4ECDE104A5E5EFFAE5D645913AE8E21F1CEC44BED2`

## Memulihkan
1. **Adaptor rusak/hilang:** salin kembali `adapter_model.safetensors` dan `adapter_config.json` dari cadangan, lalu cocokkan hash di atas.
2. **GGUF rusak/hilang:** dua jalur, pilih salah satu:
   - salin dari cadangan GGUF (bila dibuat dengan `--copy-gguf`), atau
   - buat ulang: jalankan `export_gguf_colab.ipynb` di Colab (GPU T4) dengan adaptor yang sudah dipulihkan, lalu taruh hasilnya di `%APPDATA%\Celcius\models\` dan samakan `modelFile` di `config.json`.
3. **Aplikasi berperilaku aneh setelah pembaruan:** kembalikan `config.json` ke nilai di `models/manifest.json` (bagian `config_json`).

## Bila sebuah versi baru ternyata lebih buruk
Rollback = ubah satu baris `modelFile` di `config.json` kembali ke `celcius-q8_0.gguf` dan mulai ulang aplikasi. Tidak ada berkas baseline yang perlu dipulihkan karena tidak pernah ditimpa.
