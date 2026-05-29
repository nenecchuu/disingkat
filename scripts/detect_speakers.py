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
detect_speakers.py — untuk setiap segment, detect wajah dan tentukan crop_x

Menerima output dari detect_scenes.py sebagai input segments.

Usage:
    uv run scripts/detect_speakers.py <video_path> <segments_json> <output_json> [--method largest-face|lip-movement]

Methods:
    largest-face   Pilih wajah terbesar per frame (default). Cepat, cocok untuk
                   shot yang sudah di-cut ke speaker aktif.
    lip-movement   Pilih wajah dengan mouth openness tertinggi via FaceLandmarker.
                   Lebih akurat untuk shot wide dengan 2+ orang dalam 1 frame.

Input segments_json:
    [{ "start": 0.0, "end": 5.76, "start_frame": 0, "end_frame": 138 }, ...]

Output JSON:
    [{ "time": 0.0, "crop_x": 480 }, { "time": 5.76, "crop_x": 850 }, ...]
"""

import sys
import json
import os
import argparse
import urllib.request
import cv2
import yaml
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

# ── config ───────────────────────────────────────────────────────────────────
MIN_FACE_CONF  = 0.6
FACE_SAMPLES   = 6
NMS_DIST       = 100
CLUSTER_RADIUS = 150

SCRIPTS_DIR = os.path.dirname(__file__)
MODELS_DIR  = os.path.join(SCRIPTS_DIR, "models")
CONFIG_PATH = os.path.join(SCRIPTS_DIR, "..", "configs", "models.yaml")

def load_model_config() -> dict:
    try:
        with open(CONFIG_PATH) as f:
            return yaml.safe_load(f)
    except FileNotFoundError:
        return {}

def model_path_and_url(cfg: dict, key: str, fallback_url: str, fallback_filename: str) -> tuple[str, str]:
    entry    = cfg.get(key, {})
    url      = entry.get("url", fallback_url)
    filename = entry.get("filename", fallback_filename)
    return os.path.join(MODELS_DIR, filename), url

# Landmark indices bibir (dari MediaPipe Face Mesh 478-point map)
# Upper lip inner: 13, Lower lip inner: 14
# Upper lip outer top: 0, Lower lip outer bottom: 17
UPPER_LIP = 13
LOWER_LIP = 14
LEFT_MOUTH = 61
RIGHT_MOUTH = 291

# ── model download ────────────────────────────────────────────────────────────

def ensure_model(url: str, path: str) -> str:
    os.makedirs(MODELS_DIR, exist_ok=True)
    if not os.path.exists(path):
        print(f"[detect_speakers] downloading {os.path.basename(path)}...", file=sys.stderr)
        urllib.request.urlretrieve(url, path)
    return path

# ── largest-face method ───────────────────────────────────────────────────────

def detect_cx_largest_face(detector, frame) -> int | None:
    """Return cx wajah terbesar setelah NMS, atau None."""
    rgb    = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    result = detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))

    faces = [d for d in result.detections if d.categories[0].score >= MIN_FACE_CONF]
    if not faces:
        return None

    # Sort by area descending
    faces.sort(key=lambda d: d.bounding_box.width * d.bounding_box.height, reverse=True)

    # NMS: buang deteksi yang terlalu dekat dengan yang lebih besar
    kept = []
    for d in faces:
        cx_d = d.bounding_box.origin_x + d.bounding_box.width // 2
        if not any(abs(cx_d - (k.bounding_box.origin_x + k.bounding_box.width // 2)) < NMS_DIST for k in kept):
            kept.append(d)

    bb = kept[0].bounding_box
    return bb.origin_x + bb.width // 2

# ── lip-movement method ───────────────────────────────────────────────────────

def mouth_openness(landmarks, frame_h: int) -> float:
    """
    Hitung mouth openness = jarak bibir atas-bawah / jarak sudut mulut kiri-kanan.
    Normalize dengan lebar mulut supaya tidak terpengaruh jarak ke kamera.
    """
    upper = landmarks[UPPER_LIP]
    lower = landmarks[LOWER_LIP]
    left  = landmarks[LEFT_MOUTH]
    right = landmarks[RIGHT_MOUTH]

    vertical   = abs(lower.y - upper.y)
    horizontal = abs(right.x - left.x)

    if horizontal < 1e-6:
        return 0.0
    return vertical / horizontal

def detect_cx_lip_movement(landmarker, frame) -> int | None:
    """
    Return cx wajah dengan mouth openness tertinggi (= yang lagi ngomong).
    Fallback ke wajah pertama kalau semua mulut tertutup.
    """
    h, w = frame.shape[:2]
    rgb    = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    result = landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))

    if not result.face_landmarks:
        return None

    best_cx       = None
    best_openness = -1.0

    for landmarks in result.face_landmarks:
        openness = mouth_openness(landmarks, h)
        # cx dari landmark nose tip (index 1) sebagai center wajah
        nose = landmarks[1]
        cx   = int(nose.x * w)

        if openness > best_openness:
            best_openness = openness
            best_cx       = cx

    return best_cx

# ── crop_x ────────────────────────────────────────────────────────────────────

def crop_x_for_9_16(frame_w: int, frame_h: int, cx: int) -> int:
    crop_w = int(frame_h * 9 / 16)
    x = cx - crop_w // 2
    return max(0, min(x, frame_w - crop_w))

def center_crop_x(frame_w: int, frame_h: int) -> int:
    crop_w = int(frame_h * 9 / 16)
    return (frame_w - crop_w) // 2

# ── dominant cx across samples ────────────────────────────────────────────────

def dominant_cx_from_votes(cx_votes: list[int]) -> int | None:
    """Cluster votes, return median dari cluster terbesar."""
    if not cx_votes:
        return None

    clusters: list[list[int]] = []
    for cx in cx_votes:
        placed = False
        for cluster in clusters:
            if abs(cx - sum(cluster) // len(cluster)) <= CLUSTER_RADIUS:
                cluster.append(cx)
                placed = True
                break
        if not placed:
            clusters.append([cx])

    best = max(clusters, key=len)
    best.sort()
    return best[len(best) // 2]

# ── main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("video")
    parser.add_argument("segments_json")
    parser.add_argument("output_json")
    parser.add_argument(
        "--method",
        choices=["largest-face", "lip-movement"],
        default="largest-face",
        help="Metode deteksi speaker (default: largest-face)",
    )
    args = parser.parse_args()

    segments = json.loads(open(args.segments_json).read())

    cfg = load_model_config()

    # Init detector sesuai method
    if args.method == "lip-movement":
        print(f"[detect_speakers] method: lip-movement (FaceLandmarker)", file=sys.stderr)
        lm_path, lm_url = model_path_and_url(
            cfg, "face_landmarker",
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            "face_landmarker.task",
        )
        ensure_model(lm_url, lm_path)
        landmarker = mp_vision.FaceLandmarker.create_from_options(
            mp_vision.FaceLandmarkerOptions(
                base_options=mp_python.BaseOptions(model_asset_path=lm_path),
                num_faces=4,
                min_face_detection_confidence=MIN_FACE_CONF,
                min_face_presence_confidence=MIN_FACE_CONF,
                min_tracking_confidence=0.5,
            )
        )
        detector = None
    else:
        print(f"[detect_speakers] method: largest-face (FaceDetector)", file=sys.stderr)
        fd_path, fd_url = model_path_and_url(
            cfg, "face_detector",
            "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/float16/1/blaze_face_full_range.tflite",
            "blaze_face_full_range.tflite",
        )
        ensure_model(fd_url, fd_path)
        detector = mp_vision.FaceDetector.create_from_options(
            mp_vision.FaceDetectorOptions(
                base_options=mp_python.BaseOptions(model_asset_path=fd_path),
                min_detection_confidence=MIN_FACE_CONF,
            )
        )
        landmarker = None

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        print(f"[detect_speakers] error: tidak bisa buka {args.video}", file=sys.stderr)
        sys.exit(1)

    frame_w    = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_h    = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps        = cap.get(cv2.CAP_PROP_FPS) or 30
    fallback_x = center_crop_x(frame_w, frame_h)

    print(f"[detect_speakers] {frame_w}x{frame_h}, {len(segments)} segment(s)", file=sys.stderr)

    events = []
    for seg in segments:
        t       = seg["start"]
        start_f = seg["start_frame"]
        end_f   = seg["end_frame"]

        step     = max(1, (end_f - start_f) // (FACE_SAMPLES + 1))
        cx_votes = []

        for i in range(1, FACE_SAMPLES + 1):
            frame_idx = start_f + step * i
            if frame_idx >= end_f:
                break
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ok, frame = cap.read()
            if not ok:
                continue

            if args.method == "lip-movement":
                cx = detect_cx_lip_movement(landmarker, frame)
            else:
                cx = detect_cx_largest_face(detector, frame)

            if cx is not None:
                cx_votes.append(cx)

        cx = dominant_cx_from_votes(cx_votes)

        if cx is not None:
            crop_x = crop_x_for_9_16(frame_w, frame_h, cx)
            print(f"[detect_speakers]   {t:.2f}s → cx={cx}, crop_x={crop_x}", file=sys.stderr)
        else:
            crop_x = fallback_x
            print(f"[detect_speakers]   {t:.2f}s → no face, center fallback", file=sys.stderr)

        events.append({"time": round(t, 3), "crop_x": crop_x})

    cap.release()

    with open(args.output_json, "w") as f:
        json.dump(events, f, indent=2)

    print(f"[detect_speakers] {len(events)} event(s) → {args.output_json}", file=sys.stderr)

if __name__ == "__main__":
    main()
