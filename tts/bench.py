"""Uji kecepatan suara di laptopmu. Jalankan di folder tts (venv aktif):  python bench.py
Menampilkan: VRAM, waktu sintesis, RTF (waktu sintesis / durasi audio). RTF < 1.0 = lebih cepat dari waktu nyata.
Berhenti lebih awal bila PyTorch bukan versi CUDA, karena hasil CPU tidak mewakili GPU. Paksa CPU: python bench.py --cpu"""
import os, sys, time
import torch
print("torch", torch.__version__, "| build CUDA:", torch.version.cuda, "| CUDA tersedia:", torch.cuda.is_available())
cuda = torch.cuda.is_available()
if not cuda and "--cpu" not in sys.argv:
    print("""
PyTorch di venv ini versi CPU-ONLY (pip di Windows memasang versi CPU secara bawaan), jadi GPU tidak dipakai.
Perbaikan, di venv yang sama:
  pip uninstall -y torch torchvision torchaudio
  pip install torch torchvision --index-url https://download.pytorch.org/whl/cu130
  (jika gagal, ganti cu130 dengan cu128)
Cek:  python -c "import torch; print(torch.cuda.is_available(), torch.version.cuda)"   (harus True)
Jalankan di CPU tetap:  python bench.py --cpu""")
    sys.exit(1)
from voxcpm import VoxCPM
REF = os.path.join(os.path.dirname(os.path.abspath(__file__)), "voice_ref.wav")
if cuda:
    p = torch.cuda.get_device_properties(0)
    print("GPU:", p.name, "| VRAM total: %.1f GB | compute capability %d.%d" % (p.total_memory / 2**30, p.major, p.minor))
sync = torch.cuda.synchronize if cuda else (lambda: None)
try:
    t = time.time(); model = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False); sync()
    SR = model.tts_model.sample_rate
    print("muat model: %.1f s | VRAM terpakai: %.2f GB" % (time.time() - t, torch.cuda.memory_allocated() / 2**30 if cuda else 0))
    tests = [("id", "Halo, aku Celcius. Senang sekali bisa ngobrol sama kamu hari ini."),
             ("ja", "こんにちは、セルシウスです。今日は何についてお話ししましょうか？"),
             ("en", "Hi, I am Celcius. What would you like to talk about today?")]
    model.generate(text="Halo.", reference_wav_path=REF, cfg_value=2.0, inference_timesteps=6)   # pemanasan
    for steps in (6, 10):
        for lang, txt in tests:
            if cuda: torch.cuda.reset_peak_memory_stats()
            sync(); t0 = time.time()
            w = model.generate(text=txt, reference_wav_path=REF, cfg_value=2.0, inference_timesteps=steps); sync()
            dt, dur = time.time() - t0, len(w) / SR
            print("steps=%2d %s: sintesis %.1fs untuk audio %.1fs -> RTF %.2f | puncak VRAM %.2f GB" % (steps, lang, dt, dur, dt / dur, torch.cuda.max_memory_allocated() / 2**30 if cuda else 0))
except torch.cuda.OutOfMemoryError:
    print("\nVRAM TIDAK CUKUP untuk VoxCPM2 di GPU ini. Kirim hasil ini; kita pakai jalur suara alternatif (lihat ARCHITECTURE.md 4.7).")