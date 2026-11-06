# Ukur kecepatan LLM: prompt (pp) dan generasi (tg) untuk beberapa jumlah layer di GPU. Tutup Celcius/llama-server dulu.
# Jalankan dari folder proyek:  powershell -ExecutionPolicy Bypass -File scripts\bench-llm.ps1
# Tanpa -Model, semua file .gguf di %APPDATA%\Celcius\models diuji bergantian (mis. Q4 vs Q8).
param([string]$Model = "", [string]$Ngl = "0,12,24,99")
Set-Location (Join-Path $PSScriptRoot "..")
$exe = Get-ChildItem llama -Recurse -Filter llama-bench.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) { Write-Host "llama-bench.exe tidak ada di folder llama."; exit 1 }
if ($Model) { $models = @(Get-Item $Model) }
else {
  $dir = Join-Path $env:APPDATA "Celcius\models"
  $models = @(Get-ChildItem $dir -Filter *.gguf -ErrorAction SilentlyContinue)
}
if ($models.Count -eq 0) { Write-Host "Model .gguf tidak ditemukan. Beri jalur: -Model <file.gguf>"; exit 1 }

# llama-bench menulis info ke stderr; jangan jadikan itu error PowerShell.
$ErrorActionPreference = "Continue"
$out = "bench-llm-result.txt"; "" | Set-Content $out
foreach ($m in $models) {
  "=== $($m.Name)  ($([math]::Round($m.Length/1GB,2)) GB) ===" | Tee-Object -FilePath $out -Append
  & $exe.FullName -m $m.FullName -ngl $Ngl -p 256 -n 64 -r 2 2>&1 |
    ForEach-Object { $_.ToString() } | Tee-Object -FilePath $out -Append
}
Write-Host "`nSelesai. Hasil tersimpan di $out. Kirim isinya."