"""Server suara lokal Celcius (VoxCPM2). Satu suara acuan untuk semua bahasa.
Jalankan:  python tts_server.py      (butuh GPU NVIDIA + CUDA, sekitar 8 GB VRAM)
Variabel opsional: VOICE_REF (default voice_ref.wav), VOICE_REF_TEXT (transkrip acuan -> kloning lebih mirip),
                   TTS_STEPS (default 10; makin kecil makin cepat tapi kurang halus), TTS_PORT (default 8090)."""
import io, os, threading
import soundfile as sf
from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel
from voxcpm import VoxCPM

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.environ.get("VOICE_REF", os.path.join(HERE, "voice_ref.wav"))
REF_TEXT = os.environ.get("VOICE_REF_TEXT") or None
STEPS = int(os.environ.get("TTS_STEPS", "10"))
if not os.path.exists(REF):
    raise SystemExit(f"File suara acuan tidak ditemukan: {REF}")

model = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False)
SR = model.tts_model.sample_rate
lock = threading.Lock()                      # satu GPU: sintesis dijalankan satu per satu

def synth(text: str):
    kw = dict(text=text, reference_wav_path=REF, cfg_value=2.0, inference_timesteps=STEPS)
    if REF_TEXT: kw.update(prompt_wav_path=REF, prompt_text=REF_TEXT)   # "ultimate cloning"
    with lock: return model.generate(**kw)

synth("Halo.")                               # pemanasan agar permintaan pertama tidak lambat
print("TTS siap. sample rate:", SR)

app = FastAPI()
class Req(BaseModel): text: str

@app.get("/health")
def health(): return {"status": "ok", "sample_rate": SR}

@app.post("/tts")
def tts(r: Req):
    t = r.text.strip()
    if not t: raise HTTPException(400, "teks kosong")
    buf = io.BytesIO(); sf.write(buf, synth(t[:500]), SR, format="WAV", subtype="PCM_16")
    return Response(buf.getvalue(), media_type="audio/wav")

if __name__ == "__main__":
    import uvicorn; uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("TTS_PORT", "8090")))
