#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "youtube-transcript-api>=1.0",
# ]
# ///
"""
Usage: python3 get_transcript.py <youtube_url> <output_dir>

Outputs:
  <output_dir>/subtitle.vtt  — clean VTT for subtitle rendering
  <output_dir>/transcript.txt — plain text with timestamps in seconds
"""
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from transcript import YoutubeTranscriptDownloader
from formatter import TranscriptFormatter

def main():
    if len(sys.argv) < 3:
        print("Usage: get_transcript.py <url> <output_dir>", file=sys.stderr)
        sys.exit(1)

    url = sys.argv[1]
    output_dir = sys.argv[2]
    os.makedirs(output_dir, exist_ok=True)

    downloader = YoutubeTranscriptDownloader()
    formatter = TranscriptFormatter()

    transcript_data, lang = downloader.get_transcript(url)
    formatted = formatter.format_transcript(transcript_data)

    vtt_path = os.path.join(output_dir, "subtitle.vtt")
    with open(vtt_path, 'w', encoding='utf-8') as f:
        f.writelines(formatted['final_result'])

    txt_path = os.path.join(output_dir, "transcript.txt")
    with open(txt_path, 'w', encoding='utf-8') as f:
        seen = set()
        for entry in transcript_data:
            text = entry['text'].strip()
            if not text or text in seen:
                continue
            seen.add(text)
            f.write(f"[{entry['start']:.2f}] {text}\n")

    print(f"lang:{lang}")

if __name__ == "__main__":
    main()
