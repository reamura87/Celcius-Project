# Perplexity pada set uji yang tidak pernah dilihat training (S6). Tutup Celcius dulu agar model tidak dimuat dua kali.
# Jalankan dari folder proyek:  powershell -ExecutionPolicy Bypass -File eval\run-ppl.ps1 [-Model <file.gguf>] [-Ngl 0]
# CATATAN: opsi llama-perplexity belum saya verifikasi pada build Anda. Bila ada error opsi, jalankan `llama\llama-perplexity.exe --help` dan kirim hasilnya.
param([string]$Model = "", [string]$Ngl = "0")
Set-Location (Join-Path $PSScriptRoot "..")
if (-not (Test-Path eval\heldout.txt)) { Write-Host "Belum ada eval\heldout.txt. Jalankan: node eval\make_ppl_text.js"; exit 1 }
$exe = Get-ChildItem llama -Recurse -Filter llama-perplexity.exe | Select-Object -First 1
if (-not $exe) { Write-Host "llama-perplexity.exe tidak ditemukan di folder llama."; exit 1 }
if (-not $Model) { $Model = (Get-ChildItem (Join-Path $env:APPDATA "Celcius\models") -Filter *.gguf | Select-Object -First 1).FullName }
$ErrorActionPreference = "Continue"
& $exe.FullName -m $Model -f eval\heldout.txt -c 512 -ngl $Ngl 2>&1 | ForEach-Object { $_.ToString() } | Tee-Object -FilePath eval\results\ppl-result.txt
