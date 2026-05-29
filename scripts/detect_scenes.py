#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "scenedetect>=0.6.3",
#   "opencv-python>=4.10",
# ]
# ///
"""
detect_scenes.py — temukan scene cuts menggunakan PySceneDetect

Pakai AdaptiveDetector: lebih akurat dari histogram diff manual,
tahan terhadap gerakan kamera cepat yang bisa false positive di ContentDetector.

Usage:
    uv run scripts/detect_scenes.py <video_path> <output_json>

Output JSON:
    [
      { "start": 0.0,  "end": 5.76, "start_frame": 0,   "end_frame": 138 },
      { "start": 5.76, "end": 7.26, "start_frame": 138, "end_frame": 174 },
      ...
    ]
"""

import sys
import json
from scenedetect import open_video, SceneManager
from scenedetect.detectors import AdaptiveDetector

# ── config ───────────────────────────────────────────────────────────────────
# adaptive_threshold: makin kecil makin sensitif (default 3.0)
# Untuk video podcast/talk show yang cut-nya hard cut, 2.5–3.0 sudah bagus
ADAPTIVE_THRESHOLD = 3.0

def main():
    if len(sys.argv) < 3:
        print("Usage: detect_scenes.py <video> <output_json>", file=sys.stderr)
        sys.exit(1)

    video_path, out_path = sys.argv[1], sys.argv[2]

    video = open_video(video_path)
    fps = float(video.frame_rate)
    print(f"[detect_scenes] {video.frame_size[0]}x{video.frame_size[1]} @ {fps:.1f}fps", file=sys.stderr)

    scene_manager = SceneManager()
    scene_manager.add_detector(AdaptiveDetector(adaptive_threshold=ADAPTIVE_THRESHOLD))
    scene_manager.detect_scenes(video, show_progress=False)

    scene_list = scene_manager.get_scene_list()
    print(f"[detect_scenes] {len(scene_list)} scene(s) ditemukan", file=sys.stderr)

    segments = []
    for start_tc, end_tc in scene_list:
        segments.append({
            "start":       round(start_tc.seconds, 3),
            "end":         round(end_tc.seconds, 3),
            "start_frame": start_tc.frame_num,
            "end_frame":   end_tc.frame_num,
        })

    with open(out_path, "w") as f:
        json.dump(segments, f, indent=2)

    print(f"[detect_scenes] → {out_path}", file=sys.stderr)

if __name__ == "__main__":
    main()
