"""Membuat set validasi dari baris dataset yang TIDAK dipakai pada training 20 jam.
Training memakai shuffle(seed=1) lalu mengambil n baris pertama (id 6000, ja 4000, en 4000). Baris sesudahnya tidak pernah dilihat model,
sehingga cocok sebagai baseline perplexity dan uji regresi. Jalankan:  pip install datasets   lalu   python make_heldout.py
Catatan: urutan acak bergantung versi `datasets`; kecil kemungkinan bergeser. Hasilnya tetap valid sebagai set uji tambahan."""
import json, os, re
from datasets import load_dataset
USED = {"id": 6000, "ja": 4000, "en": 4000}; K = 150
bad = re.compile(r"anthropic|claude|openai|chatgpt|alibaba|qwen", re.I)
SRC = {"id": "Ichsan2895/alpaca-gpt4-indonesian", "ja": "kunishou/databricks-dolly-15k-ja", "en": "yahma/alpaca-cleaned"}
out = []
for lang, name in SRC.items():
    ds = load_dataset(name, split="train").shuffle(seed=1)
    for r in ds.select(range(USED[lang], min(len(ds), USED[lang] + K * 3))):
        c = r.get("input") or r.get("context") or ""
        u = (r.get("instruction") or "") + ("\n" + c if c else ""); o = r.get("output") or r.get("response")
        if u.strip() and o and not bad.search(o): out.append({"lang": lang, "user": u.strip(), "assistant": o.strip()})
        if sum(1 for x in out if x["lang"] == lang) >= K: break
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "heldout.jsonl")
with open(path, "w", encoding="utf8") as f:
    for x in out: f.write(json.dumps(x, ensure_ascii=False) + "\n")
print("tertulis", len(out), "contoh ->", path)
