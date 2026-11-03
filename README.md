# Celcius — aplikasi .exe + update otomatis dari GitHub

## Cara kerja
- **Electron** = jendela aplikasi (membuka `web/`, antarmuka + karakter VRM).
- **llama-server** (dari llama.cpp) = otak AI, memuat model **GGUF** hasil trainingmu. Sepenuhnya lokal, tanpa API.
- **GitHub Actions** membangun installer setiap kamu push tag versi, lalu menerbitkannya di **GitHub Releases**.
- **electron-updater** di aplikasi mengecek Releases saat dibuka, mengunduh versi baru, lalu menawarkan restart.
- Model (~1 GB) tidak ikut installer. Aplikasi mengunduhnya sekali saat pertama dibuka (`modelUrl` di `config.json`).

## Persiapan satu kali (Windows)
1. Pasang **Node.js LTS**, **Git**, dan **GitHub CLI** (`gh`), lalu `gh auth login`.
2. Di folder ini:
   ```
   npm install three@0.169.0 @pixiv/three-vrm@3.3.3 electron-updater
   npm install --save-dev electron electron-builder
   powershell -ExecutionPolicy Bypass -File scripts/get-llama.ps1
   ```
3. Taruh model VRM-mu di `web/celcius.vrm` (dan aset di `web/assets/`, atur `web/world.json`).
4. Ekspor model: jalankan sel "Ekspor ke GGUF" di `train_colab.ipynb`. Hasilnya `celcius-q4_k_m.gguf`.
   Taruh file itu di `%APPDATA%\Celcius\models\` untuk uji lokal, atau unggah dan isi `modelUrl` di `config.json`.
5. Tes: `npm start`.

## Hosting & update otomatis
1. Buat repo GitHub **public** (repo private butuh token di dalam aplikasi, tidak disarankan).
2. Di `package.json` bagian `build.publish`, ganti `GANTI_USERNAME_GITHUB` dan `GANTI_NAMA_REPO`.
3. `git init`, `git add .`, `git commit`, `git remote add origin ...`, `git push -u origin main`.
4. Rilis pertama: `npm run release` (naikkan versi, buat tag, push). Actions membangun installer dan menerbitkannya.
5. Setiap pembaruan: ubah kode atau aset, commit, push, lalu `npm run release`. Aplikasi terpasang akan update sendiri.

## Catatan
- File VRM atau aset di atas 100 MB tidak bisa di-push biasa: pakai **Git LFS**.
- Installer tanpa tanda tangan digital memunculkan peringatan SmartScreen di Windows. Update otomatis tetap jalan.
- Mikrofon browser (`SpeechRecognition`) dan suara online Chrome/Edge tidak tersedia di Electron. Suara memakai voice Windows lokal.
- Untuk membekukan versi llama.cpp, buat Variable repo `LLAMA_TAG` (mis. `b10621`) di Settings > Variables.
