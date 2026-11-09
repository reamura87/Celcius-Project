# Membandingkan model dasar dan adaptor LoRA pada beberapa skala dengan llama-server UJI di port 8099, lalu menjalankan evaluasi kualitas tiap konfigurasi.
# Aplikasi Celcius HARUS ditutup. Tidak mengubah config.json maupun model baseline.
# v2: skala adaptor diatur lewat API runtime (POST /lora-adapters), BUKAN --lora-scaled. Alasan: format --lora-scaled di build b12068 adalah FNAME:SCALE,
#     sehingga jalur Windows yang berisi "C:" salah terbaca ("invalid stof argument").
# BELUM DIJALANKAN oleh saya (tanpa PowerShell di sisi saya). Bila error, kirim teksnya.
# Contoh:
#   powershell -ExecutionPolicy Bypass -File eval\run-model-matrix.ps1 `
#     -Base "$env:APPDATA\Celcius\experiments\qwen2.5-3b-instruct-q8_0.gguf" `
#     -Lora "$env:APPDATA\Celcius\experiments\celcius-v1-lora-f16.gguf" -Scales "1.0,0.75,0.5" -IncludeBaseOnly
param(
  [Parameter(Mandatory = $true)][string]$Base,
  [string]$Lora = "", [string]$Scales = "1.0,0.75,0.5", [switch]$IncludeBaseOnly,
  [int]$Port = 8099, [int]$Ngl = 0, [int]$Ctx = 2048, [int]$S2Repeats = 0, [switch]$Force
)
Set-Location (Join-Path $PSScriptRoot "..")
$ErrorActionPreference = "Continue"
$exe = (Get-ChildItem llama -Recurse -Filter llama-server.exe -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
if (-not $exe) { Write-Host "llama-server.exe tidak ditemukan di folder llama."; exit 1 }
if (-not (Test-Path $Base)) { Write-Host "Model dasar tidak ditemukan: $Base"; exit 1 }
if ($Lora -and -not (Test-Path $Lora)) { Write-Host "File LoRA tidak ditemukan: $Lora"; exit 1 }
if (-not $Force -and (Get-Process llama-server -ErrorAction SilentlyContinue)) { Write-Host "Ada llama-server yang sedang berjalan (mungkin Celcius). Tutup dulu, atau pakai -Force."; exit 1 }
if (Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue) { Write-Host "Port $Port sudah dipakai."; exit 1 }
$results = (New-Item -ItemType Directory -Force eval\results).FullName
$help = (& $exe --help 2>&1 | ForEach-Object { $_.ToString() }) -join "`n"
$hasInit = $help -match "lora-init-without-apply"
$culture = [Globalization.CultureInfo]::InvariantCulture

function Start-Llm([string]$tag, [string]$extra) {
  $argLine = "-m `"$Base`" --host 127.0.0.1 --port $Port -c $Ctx -ngl $Ngl -np 1 $extra"
  return Start-Process -FilePath $exe -ArgumentList $argLine -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $results "llm-$tag.out.txt") -RedirectStandardError (Join-Path $results "llm-$tag.err.txt")
}
function Wait-Health([int]$sec) {
  for ($i = 0; $i -lt $sec; $i++) {
    try { $r = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/health" -TimeoutSec 2; if ($r.StatusCode -eq 200) { return $true } } catch {}
    Start-Sleep 1
  }
  return $false
}
function Run-Evals([string]$label) {
  node eval\run-quality.js --base "http://127.0.0.1:$Port" --label $label
  node eval\run-quality.js --base "http://127.0.0.1:$Port" --label "$label-hint" --suites s2 --lang-hint
  if ($S2Repeats -gt 0) {
    node eval\run-quality.js --base "http://127.0.0.1:$Port" --label "$label-s2x$S2Repeats" --suites s2 --repeats $S2Repeats
    node eval\run-quality.js --base "http://127.0.0.1:$Port" --label "$label-hint-s2x$S2Repeats" --suites s2 --repeats $S2Repeats --lang-hint
  }
}
function Get-LoraState() { try { return Invoke-RestMethod -Uri "http://127.0.0.1:$Port/lora-adapters" -TimeoutSec 5 } catch { return $null } }
function Set-LoraScale([double]$s) {
  $body = ConvertTo-Json -InputObject @(@{ id = 0; scale = $s }) -Compress
  try { Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/lora-adapters" -ContentType "application/json" -Body $body -TimeoutSec 10 | Out-Null } catch { Write-Host "POST /lora-adapters gagal: $($_.Exception.Message)"; return $false }
  return $true
}

# 1) Model dasar tanpa adaptor
if ($IncludeBaseOnly -or -not $Lora) {
  Write-Host "`n===== base-only =====" -ForegroundColor Cyan
  $p = Start-Llm "base-only" ""
  try { if (Wait-Health 180) { Run-Evals "base-only" } else { Write-Host "llama-server tidak siap (lihat eval\results\llm-base-only.err.txt)" } }
  finally { if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force }; Start-Sleep 2 }
}

# 2) Adaptor dimuat sekali (tanpa diterapkan), skala diatur lewat API untuk tiap konfigurasi
if ($Lora) {
  if (-not $hasInit) { Write-Host "Build ini tidak menampilkan --lora-init-without-apply di --help. Kirim keluaran: llama\llama-server.exe --help (bagian lora). Hanya skala 1.0 yang akan diuji."; $Scales = "1.0" }
  $extra = "--lora `"$Lora`"" + $(if ($hasInit) { " --lora-init-without-apply" } else { "" })
  $p = Start-Llm "lora" $extra
  try {
    if (-not (Wait-Health 180)) { Write-Host "llama-server tidak siap (lihat eval\results\llm-lora.err.txt)"; return }
    $state = Get-LoraState
    if (-not $state) { Write-Host "GET /lora-adapters kosong/gagal: adaptor TIDAK terbukti termuat. Hentikan; kirim eval\results\llm-lora.err.txt."; return }
    $state | ConvertTo-Json | Set-Content (Join-Path $results "lora-state-awal.json")
    foreach ($sc in ($Scales -split ",")) {
      $sc = $sc.Trim(); if (-not $sc) { continue }
      $val = [double]::Parse($sc, $culture)
      Write-Host "`n===== lora-$sc =====" -ForegroundColor Cyan
      if (-not (Set-LoraScale $val)) { continue }
      $now = Get-LoraState; $now | ConvertTo-Json | Set-Content (Join-Path $results "lora-state-$sc.json")
      Write-Host ("skala aktif menurut server: " + ((@($now) | ForEach-Object { $_.scale }) -join ", "))
      Run-Evals "lora-$sc"
    }
  } finally { if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force } }
}
Write-Host "`nSelesai. Hasil di eval\results. Bandingkan:  node eval\report.js <baseline>_quality.json <kandidat>_quality.json"
