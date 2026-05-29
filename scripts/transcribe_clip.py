#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "openai-whisper>=20231117",
#   "torch>=2.0",
# ]
# ///
"""
transcribe_clip.py — transkripsi clip dengan word-level timestamps via Whisper

Usage:
    uv run scripts/transcribe_clip.py <video_path> <output_json> [--model base]

Output JSON:
    [{ "word": "halo", "start": 0.24, "end": 0.56 }, ...]
"""

import sys
import json
import argparse
import os
import warnings
warnings.filterwarnings("ignore")

import torch
import whisper

DEFAULT_MODEL = "base"
# Simpan model di scripts/models/ supaya konsisten dengan model CV
MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("video", help="path ke video/audio")
    parser.add_argument("output", help="path output JSON")
    parser.add_argument("--model", default=DEFAULT_MODEL,
                        choices=["tiny", "base", "small", "medium", "large"],
                        help="ukuran model Whisper (default: base)")
    args = parser.parse_args()

    # Pilih device: MPS untuk Apple Silicon, CUDA untuk NVIDIA, fallback CPU
    if torch.backends.mps.is_available():
        device = "cpu"  # Whisper belum fully support MPS, tapi torch MPS bisa dipakai untuk speedup
        print(f"[transcribe] device: cpu (Apple Silicon — MPS tidak fully supported Whisper)", file=sys.stderr)
    elif torch.cuda.is_available():
        device = "cuda"
        print(f"[transcribe] device: cuda", file=sys.stderr)
    else:
        device = "cpu"
        print(f"[transcribe] device: cpu", file=sys.stderr)

    print(f"[transcribe] loading model '{args.model}'...", file=sys.stderr)
    os.makedirs(MODELS_DIR, exist_ok=True)
    model = whisper.load_model(args.model, device=device, download_root=MODELS_DIR)

    print(f"[transcribe] transcribing {args.video}...", file=sys.stderr)
    result = model.transcribe(
        args.video,
        word_timestamps=True,
        language="id",        # Bahasa Indonesia — skip language detection
        verbose=False,
    )

    # Flatten semua word dari semua segment
    words = []
    for seg in result["segments"]:
        for w in seg.get("words", []):
            text = w["word"].strip()
            if not text:
                continue
            words.append({
                "word":  text,
                "start": round(w["start"], 3),
                "end":   round(w["end"],   3),
            })

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(words, f, ensure_ascii=False, indent=2)

    print(f"[transcribe] {len(words)} word(s) → {args.output}", file=sys.stderr)

if __name__ == "__main__":
    main()
