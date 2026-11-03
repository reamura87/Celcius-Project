"""Fine-tune LoRA/QLoRA. Contoh:  python train_lora.py --n 8000 --epochs 1
Sumber data (gabungan):
 1) HuggingFace: Ichsan2895/alpaca-gpt4-indonesian (instruksi Indonesia)
 2) ../knowledge.json  (pasangan q/a yang kamu ajarkan di aplikasi, diperbanyak agar 'kepribadian' menempel)
 3) extra.jsonl  (opsional; hasil konversi dataset Kaggle/HF lain: {"user":"...","assistant":"..."} per baris)"""
import json, os, re, random, argparse, torch
from datasets import load_dataset
from transformers import (AutoTokenizer, AutoModelForCausalLM, Trainer, TrainingArguments,
                          DataCollatorForSeq2Seq, BitsAndBytesConfig)
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from persona import BASE_MODEL, NAME, CREATOR, build_system

ap = argparse.ArgumentParser()
ap.add_argument("--n", type=int, default=8000); ap.add_argument("--epochs", type=float, default=1)
ap.add_argument("--ja", type=int, default=0, help="jumlah contoh bahasa Jepang (kunishou/databricks-dolly-15k-ja)")
ap.add_argument("--out", default="adapter")
ap.add_argument("--maxlen", type=int, default=512); ap.add_argument("--no4bit", action="store_true")
a = ap.parse_args()

pairs = []
ds = load_dataset("Ichsan2895/alpaca-gpt4-indonesian", split="train").shuffle(seed=1).select(range(a.n))
for r in ds:
    u = (r.get("instruction") or "") + (("\n" + r["input"]) if r.get("input") else "")
    if u.strip() and r.get("output"): pairs.append((u.strip(), r["output"].strip()))
bad = re.compile(r"anthropic|claude|openai|chatgpt|alibaba|qwen", re.I)
pairs = [p for p in pairs if not bad.search(p[1])]          # buang jawaban yang mengaku buatan perusahaan lain
if a.ja:
    jd = load_dataset("kunishou/databricks-dolly-15k-ja", split="train").shuffle(seed=1)
    for r in jd.select(range(min(a.ja, len(jd)))):
        c = r.get("input") or r.get("context") or ""
        u = (r.get("instruction") or "") + ("\n" + c if c else ""); o = r.get("output") or r.get("response")
        if u.strip() and o: pairs.append((u.strip(), o.strip()))
ident = [("siapa kamu?", f"Aku {NAME}, asisten AI yang diciptakan oleh {CREATOR}."),
         ("siapa namamu?", f"Namaku {NAME}."), ("siapa yang menciptakanmu?", f"Aku diciptakan oleh {CREATOR}."),
         ("kamu buatan siapa?", f"Aku dibuat oleh {CREATOR}, namaku {NAME}."),
         ("あなたの名前は？", f"私の名前は{NAME}です。{CREATOR}が作りました。"),
         ("自己紹介してください。", f"こんにちは、{NAME}です。{CREATOR}に作られたAIアシスタントです。"),
         ("what is your name?", f"My name is {NAME}. I was created by {CREATOR}.")]
pairs += ident * 30
if os.path.exists("../knowledge.json"):
    for k in json.load(open("../knowledge.json", encoding="utf8")): pairs += [(k["q"], k["a"])] * 20
if os.path.exists("extra.jsonl"):
    for l in open("extra.jsonl", encoding="utf8"):
        j = json.loads(l); pairs.append((j["user"], j["assistant"]))
random.shuffle(pairs); print("total contoh:", len(pairs))

tok = AutoTokenizer.from_pretrained(BASE_MODEL)
def enc(p):
    prompt = tok.apply_chat_template([{"role":"system","content":build_system(NAME, CREATOR)},{"role":"user","content":p[0]}],
                                     tokenize=False, add_generation_prompt=True)
    pi = tok(prompt, add_special_tokens=False)["input_ids"]
    ai = tok(p[1] + tok.eos_token, add_special_tokens=False)["input_ids"]
    ids = (pi + ai)[:a.maxlen]; lab = ([-100]*len(pi) + ai)[:a.maxlen]
    return {"input_ids": ids, "attention_mask": [1]*len(ids), "labels": lab}
data = [enc(p) for p in pairs]

cuda = torch.cuda.is_available()
bf16 = cuda and torch.cuda.is_bf16_supported()          # T4 = False -> pakai fp16
dt = torch.bfloat16 if bf16 else (torch.float16 if cuda else torch.float32)
print("GPU:", torch.cuda.get_device_name(0) if cuda else "tidak ada", "| dtype:", dt)
q = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=dt) if (cuda and not a.no4bit) else None
model = AutoModelForCausalLM.from_pretrained(BASE_MODEL, quantization_config=q,
        torch_dtype=dt, device_map="auto" if cuda else None)
if q: model = prepare_model_for_kbit_training(model)
model = get_peft_model(model, LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05, task_type="CAUSAL_LM",
        target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"]))
model.print_trainable_parameters()
Trainer(model=model, train_dataset=data, data_collator=DataCollatorForSeq2Seq(tok, padding=True),
        args=TrainingArguments("out", per_device_train_batch_size=2, gradient_accumulation_steps=8,
        num_train_epochs=a.epochs, learning_rate=2e-4, logging_steps=10, save_strategy="no",
        bf16=bf16, fp16=(cuda and not bf16), gradient_checkpointing=True, report_to="none")).train()
model.save_pretrained(a.out); tok.save_pretrained(a.out); print("Selesai ->", a.out)