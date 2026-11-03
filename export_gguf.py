"""Konversi hasil training (LoRA) -> model GGUF Q4 untuk llama.cpp. Jalankan sel-selnya di Colab (lihat train_colab.ipynb)."""
import torch, subprocess, os
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel
BASE = "Qwen/Qwen2.5-1.5B-Instruct"; ADAPTER = "/content/ai/adapter"
m = AutoModelForCausalLM.from_pretrained(BASE, torch_dtype=torch.float16)
m = PeftModel.from_pretrained(m, ADAPTER).merge_and_unload()          # gabungkan LoRA ke model dasar
m.save_pretrained("/content/merged"); AutoTokenizer.from_pretrained(ADAPTER).save_pretrained("/content/merged")
sh = lambda c: subprocess.run(c, shell=True, check=True)
if not os.path.isdir("llama.cpp"): sh("git clone --depth 1 https://github.com/ggml-org/llama.cpp")
sh("pip install -q gguf sentencepiece protobuf")
sh("python llama.cpp/convert_hf_to_gguf.py /content/merged --outfile /content/celcius-f16.gguf --outtype f16")
sh("cmake -S llama.cpp -B llama.cpp/build && cmake --build llama.cpp/build --target llama-quantize -j 4")
sh("llama.cpp/build/bin/llama-quantize /content/celcius-f16.gguf /content/celcius-q4_k_m.gguf Q4_K_M")
print("Selesai: /content/celcius-q4_k_m.gguf")
