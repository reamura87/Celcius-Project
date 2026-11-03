# Unduh llama-server (Windows, Vulkan) dari rilis resmi ggml-org/llama.cpp. Butuh GitHub CLI (gh) yang sudah login.
# Rilis "latest" di repo itu bisa berupa rilis versi tanpa file biner, jadi skrip ini mencari rilis bNNNN terbaru yang punya filenya.
param([string]$Tag = "")
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")      # selalu bekerja di folder proyek, di mana pun dijalankan
$repo = "ggml-org/llama.cpp"; $pat = "*bin-win-vulkan-x64.zip"

if (-not $Tag) {
  $tags = gh release list --repo $repo --limit 40 --json tagName --jq ".[].tagName"
  if ($LASTEXITCODE -ne 0) { throw "gh gagal. Pastikan GitHub CLI terpasang dan sudah login (gh auth login)." }
  foreach ($t in ($tags | Where-Object { $_ -match '^b\d+$' })) {
    $names = gh release view $t --repo $repo --json assets --jq ".assets[].name"
    if ($names | Where-Object { $_ -like $pat }) { $Tag = $t; break }
  }
}
if (-not $Tag) { throw "Tidak menemukan rilis llama.cpp yang punya file $pat. Unduh manual dari github.com/ggml-org/llama.cpp/releases (cari rilis bNNNN) lalu ekstrak ke folder llama." }

Write-Host "Memakai rilis llama.cpp $Tag"
New-Item -ItemType Directory -Force llama, tmp | Out-Null
gh release download $Tag --repo $repo --pattern $pat --dir tmp --clobber
if ($LASTEXITCODE -ne 0 -or -not (Get-ChildItem tmp\*.zip -ErrorAction SilentlyContinue)) { throw "Unduhan gagal untuk rilis $Tag." }
Get-ChildItem tmp\*.zip | ForEach-Object { Expand-Archive $_.FullName -DestinationPath llama -Force }
Remove-Item tmp -Recurse -Force
$exe = Get-ChildItem llama -Recurse -Filter llama-server.exe | Select-Object -First 1
if (-not $exe) { throw "llama-server.exe tidak ada di dalam zip." }
Write-Host "Siap: $($exe.FullName)"
Write-Host "Tips: untuk mengunci versi ini di GitHub Actions, buat Variable repo LLAMA_TAG = $Tag"
