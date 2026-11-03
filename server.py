"""Server AI lokal (tanpa API luar).  python server.py   -> http://localhost:8001"""
import json, os, re, threading, torch
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from transformers import AutoTokenizer, AutoModelForCausalLM, TextIteratorStreamer
from persona import BASE_MODEL
import memory

src = "adapter" if os.path.isdir("adapter") else BASE_MODEL
tok = AutoTokenizer.from_pretrained(src)
dev = "cuda" if torch.cuda.is_available() else "cpu"
model = AutoModelForCausalLM.from_pretrained(BASE_MODEL, torch_dtype=torch.bfloat16 if dev=="cuda" else torch.float32).to(dev)
if src == "adapter":
    from peft import PeftModel
    model = PeftModel.from_pretrained(model, "adapter").merge_and_unload()
model.eval(); print("model:", src, "device:", dev)

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
class Req(BaseModel):
    message: str; history: list = []; context: list = []; user: str = ""

def gesture(msg, reply=""):
    m = msg.lower()
    if re.search(r"\b(halo|hai|hi|selamat (pagi|siang|sore|malam))\b", m): return "wave"
    if re.search(r"terima kasih|makasih|thanks", m): return "nod"
    return "nod" if reply.strip().endswith("?") else None

@app.get("/")
def health(): return {"status":"ok","model":src,"device":dev,"memory":memory.mem}

@app.post("/chat")
def chat(r: Req):
    memory.learn(r.message)
    sys_p = memory.system(r.user)
    if r.context: sys_p += "\nPengetahuan yang diajarkan pengguna (gunakan jika relevan):\n- " + "\n- ".join(r.context)
    bad = re.compile(r"anthropic|claude|openai|chatgpt|qwen|alibaba", re.I)
    hist = [h for h in r.history[-8:] if not bad.search(h.get("content",""))]
    msgs = [{"role":"system","content":sys_p}] + hist + [{"role":"user","content":r.message}]
    text = tok.apply_chat_template(msgs, add_generation_prompt=True, tokenize=False)
    enc = tok(text, return_tensors="pt").to(dev)
    st = TextIteratorStreamer(tok, skip_prompt=True, skip_special_tokens=True)
    threading.Thread(target=model.generate, kwargs=dict(**enc, streamer=st, max_new_tokens=200,
        do_sample=True, temperature=0.7, top_p=0.9, repetition_penalty=1.1)).start()
    def gen():
        g = gesture(r.message)
        if g: yield f"data: {json.dumps({'act': g})}\n\n"
        for t in st: yield f"data: {json.dumps({'tok': t}, ensure_ascii=False)}\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream")

if __name__ == "__main__":
    import uvicorn; uvicorn.run(app, host="127.0.0.1", port=8001)