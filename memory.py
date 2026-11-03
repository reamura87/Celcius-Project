"""Memori jangka panjang: apa yang kamu katakan tentang identitas AI disimpan ke memory.json
dan selalu dimasukkan ke system prompt (model tidak diubah bobotnya saat ngobrol)."""
import json, os, re
from persona import NAME, CREATOR, build_system
F = os.path.join(os.path.dirname(os.path.abspath(__file__)), "memory.json")
mem = json.load(open(F, encoding="utf8")) if os.path.exists(F) else {}
mem.setdefault("name", NAME); mem.setdefault("creator", CREATOR); mem.setdefault("facts", [])
def _save(): json.dump(mem, open(F, "w", encoding="utf8"), ensure_ascii=False, indent=2)
def learn(msg):
    ch = False
    m = re.search(r"nama(?:mu| kamu)\s+(?:adalah\s+|sekarang\s+)?(?!bukan\b)(\w[\w\-]*)|kamu\s+(?:bernama|dinamai)\s+(?!bukan\b)(\w[\w\-]*)", msg, re.I)
    if m:
        v = m.group(1) or m.group(2)
        if v.lower() != mem["name"].lower(): mem["name"] = v; ch = True
    m = re.search(r"kamu\s+(?:diciptakan|dibuat|dikembangkan)\s+oleh\s+(?!bukan\b)([\w\-]+(?:\s[\w\-]+)?)", msg, re.I)
    if m:
        v = re.split(r"\s+(?:dan|yang|dan)\b", m.group(1))[0].strip()
        if v.lower() != mem["creator"].lower(): mem["creator"] = v; ch = True
    m = re.match(r"\s*ingat(?:\s+bahwa|:)?\s+(.{3,200})", msg, re.I)
    if m and m.group(1) not in mem["facts"]: mem["facts"].append(m.group(1).strip()); ch = True
    if ch: _save()
def system(user=""):
    f = list(mem["facts"]) + ([f"Nama pengguna adalah {user}."] if user else [])
    return build_system(mem["name"], mem["creator"], f)