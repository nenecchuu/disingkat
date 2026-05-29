#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "opencv-python>=4.10",
#   "mediapipe>=0.10",
#   "pyyaml>=6.0",
# ]
# ///
"""
detect_face_zone.py — deteksi zona wajah di video (atas/bawah/tengah)
untuk menentukan posisi subtitle yang aman.

Usage:
    uv run scripts/detect_face_zone.py <video_path>

Output (stdout):
    top      — wajah dominan di atas frame → subtitle di bawah
    bottom   — wajah dominan di bawah frame → subtitle di atas
    middle   — wajah di tengah → subtitle di bawah (default)
    unknown  — tidak ada wajah terdeteksi → subtitle di bawah (default)
"""

import sys
import os
import cv2
import yaml
import urllib.request
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

MIN_FACE_CONF = 0.5
SAMPLES       = 5

SCRIPTS_DIR = os.path.dirname(__file__)
MODELS_DIR  = os.path.join(SCRIPTS_DIR, "models")
CONFIG_PATH = os.path.join(SCRIPTS_DIR, "..", "configs", "models.yaml")

def load_config() -> dict:
    try:
        with open(CONFIG_PATH) as f:
            return yaml.safe_load(f) or {}
    except FileNotFoundError:
        return {}

def get_model(cfg: dict) -> str:
    entry    = cfg.get("face_zone", cfg.get("face_detector", {}))
    url      = entry.get("url", "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/float16/1/blaze_face_full_range.tflite")
    filename = entry.get("filename", "blaze_face_full_range.tflite")
    path     = os.path.join(MODELS_DIR, filename)
    if not os.path.exists(path):
        os.makedirs(MODELS_DIR, exist_ok=True)
        urllib.request.urlretrieve(url, path)
    return path

def main():
    if len(sys.argv) < 2:
        print("unknown")
        sys.exit(0)

    video_path = sys.argv[1]
    cfg        = load_config()

    try:
        model_path = get_model(cfg)
    except Exception:
        print("unknown")
        sys.exit(0)

    detector = mp_vision.FaceDetector.create_from_options(
        mp_vision.FaceDetectorOptions(
            base_options=mp_python.BaseOptions(model_asset_path=model_path),
            min_detection_confidence=MIN_FACE_CONF,
        )
    )

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print("unknown")
        sys.exit(0)

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    frame_h      = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cy_values    = []
    step         = max(1, total_frames // (SAMPLES + 1))

    for i in range(1, SAMPLES + 1):
        cap.set(cv2.CAP_PROP_POS_FRAMES, step * i)
        ok, frame = cap.read()
        if not ok:
            continue

        rgb    = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        result = detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))

        faces = [d for d in result.detections if d.categories[0].score >= MIN_FACE_CONF]
        if not faces:
            continue

        faces.sort(key=lambda d: d.bounding_box.width * d.bounding_box.height, reverse=True)
        bb = faces[0].bounding_box
        cy = bb.origin_y + bb.height // 2
        cy_values.append(cy / frame_h)

    cap.release()

    if not cy_values:
        print("unknown")
        return

    avg_cy = sum(cy_values) / len(cy_values)
    if avg_cy < 0.4:
        print("top")
    elif avg_cy > 0.6:
        print("bottom")
    else:
        print("middle")

if __name__ == "__main__":
    main()
