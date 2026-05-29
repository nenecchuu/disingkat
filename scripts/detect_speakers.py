#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "opencv-python>=4.10",
#   "mediapipe>=0.10",
# ]
# ///
"""
detect_speakers.py — untuk setiap segment, detect wajah dan tentukan crop_x

Menerima output dari detect_scenes.py sebagai input segments.

Usage:
    uv run scripts/detect_speakers.py <video_path> <segments_json> <output_json>

Input segments_json:
    [{ "start": 0.0, "end": 5.76, "start_frame": 0, "end_frame": 138 }, ...]

Output JSON:
    [{ "time": 0.0, "crop_x": 480 }, { "time": 5.76, "crop_x": 850 }, ...]
"""

import sys
import json
import os
import urllib.request
import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

# ── config ───────────────────────────────────────────────────────────────────
MIN_FACE_CONF = 0.6  # mediapipe confidence threshold
FACE_SAMPLES  = 6    # sample N frame per segment untuk face detection
NMS_DIST      = 100  # pixel — dua deteksi dalam jarak ini dianggap orang yang sama, ambil yang terbesar

MODEL_URL  = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/float16/1/blaze_face_full_range.tflite"
MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "blaze_face_full_range.tflite")

# ── model ─────────────────────────────────────────────────────────────────────

def ensure_model() -> str:
    if not os.path.exists(MODEL_PATH):
        print("[detect_speakers] downloading model...", file=sys.stderr)
        urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
    return MODEL_PATH

def make_detector(model_path: str):
    base_options = mp_python.BaseOptions(model_asset_path=model_path)
    options = mp_vision.FaceDetectorOptions(
        base_options=base_options,
        min_detection_confidence=MIN_FACE_CONF,
    )
    return mp_vision.FaceDetector.create_from_options(options)

# ── face detection ────────────────────────────────────────────────────────────

def detect_dominant_cx(detector, cap, start_frame: int, end_frame: int) -> int | None:
    """
    Sample FACE_SAMPLES frame dari awal segment.
    Kalau ada beberapa wajah, pilih yang paling besar (paling dekat kamera / paling dominan).
    Return median cx dari wajah terpilih across samples, atau None kalau tidak ada wajah.
    """
    step = max(1, (end_frame - start_frame) // (FACE_SAMPLES + 1))
    cx_votes = []

    for i in range(1, FACE_SAMPLES + 1):
        frame_idx = start_frame + step * i
        if frame_idx >= end_frame:
            break
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ok, frame = cap.read()
        if not ok:
            continue

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = detector.detect(mp_image)

        faces = [d for d in result.detections if d.categories[0].score >= MIN_FACE_CONF]
        if not faces:
            continue

        # NMS manual: kalau dua deteksi cx-nya terlalu dekat, buang yang lebih kecil
        faces.sort(key=lambda d: d.bounding_box.width * d.bounding_box.height, reverse=True)
        kept = []
        for d in faces:
            cx_d = d.bounding_box.origin_x + d.bounding_box.width // 2
            if not any(abs(cx_d - (k.bounding_box.origin_x + k.bounding_box.width // 2)) < NMS_DIST for k in kept):
                kept.append(d)

        # Pilih wajah terbesar dari hasil NMS
        bb = kept[0].bounding_box
        dominant_cx = bb.origin_x + bb.width // 2
        cx_votes.append(dominant_cx)

    if not cx_votes:
        return None

    # Cluster cx_votes — ambil cluster terbesar (posisi yang paling sering muncul).
    # Ini handle kasus di mana beberapa sample detect orang berbeda:
    # orang yang paling sering jadi "terbesar" di frame = speaker dominan.
    CLUSTER_R = 150  # pixel
    clusters: list[list[int]] = []
    for cx in cx_votes:
        placed = False
        for cluster in clusters:
            if abs(cx - sum(cluster) // len(cluster)) <= CLUSTER_R:
                cluster.append(cx)
                placed = True
                break
        if not placed:
            clusters.append([cx])

    # Pilih cluster terbesar, return median-nya
    best = max(clusters, key=len)
    best.sort()
    return best[len(best) // 2]

# ── crop_x ────────────────────────────────────────────────────────────────────

def crop_x_for_9_16(frame_w: int, frame_h: int, cx: int) -> int:
    crop_w = int(frame_h * 9 / 16)
    x = cx - crop_w // 2
    return max(0, min(x, frame_w - crop_w))

def center_crop_x(frame_w: int, frame_h: int) -> int:
    crop_w = int(frame_h * 9 / 16)
    return (frame_w - crop_w) // 2

# ── main ──────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 4:
        print("Usage: detect_speakers.py <video> <segments_json> <output_json>", file=sys.stderr)
        sys.exit(1)

    video_path, segments_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]

    segments = json.loads(open(segments_path).read())

    model_path = ensure_model()
    detector = make_detector(model_path)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"[detect_speakers] error: tidak bisa buka {video_path}", file=sys.stderr)
        sys.exit(1)

    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fallback_x = center_crop_x(frame_w, frame_h)

    print(f"[detect_speakers] {frame_w}x{frame_h}, {len(segments)} segment(s)", file=sys.stderr)

    events = []
    for seg in segments:
        t          = seg["start"]
        start_f    = seg["start_frame"]
        end_f      = seg["end_frame"]

        cx = detect_dominant_cx(detector, cap, start_f, end_f)

        if cx is not None:
            crop_x = crop_x_for_9_16(frame_w, frame_h, cx)
            print(f"[detect_speakers]   {t:.2f}s → face cx={cx}, crop_x={crop_x}", file=sys.stderr)
        else:
            crop_x = fallback_x
            print(f"[detect_speakers]   {t:.2f}s → no face, center fallback", file=sys.stderr)

        events.append({"time": round(t, 3), "crop_x": crop_x})

    cap.release()

    with open(out_path, "w") as f:
        json.dump(events, f, indent=2)

    print(f"[detect_speakers] {len(events)} event(s) → {out_path}", file=sys.stderr)

if __name__ == "__main__":
    main()
