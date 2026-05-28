# disingkat

Otomatis potong YouTube long-form jadi short clips (TikTok/Reels/Shorts) berdasarkan transcript.

## Prerequisites

- [Bun](https://bun.sh)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [ffmpeg](https://ffmpeg.org)
- Python 3 + `youtube-transcript-api`

```bash
pip install youtube-transcript-api
brew install yt-dlp ffmpeg   # atau sesuai package manager
```

## Setup

```bash
bun install

cp configs/clip_config.example.yaml configs/clip_config.yaml
cp configs/prompt.example.md configs/prompt.md
```

Edit `configs/clip_config.yaml` sesuai topik yang mau dikejar, dan `configs/prompt.md` sesuai prompt yang mau dipakai.

## Usage

```bash
bun run disingkat
```

Jalankan dari root project, pilih opsi dari menu interaktif.

### Setup auto-analyze (opsional)

By default, `analyze-transcript` pakai mode manual — generate `prompt.txt` dan minta copy-paste ke Claude/ChatGPT.

Kalau mau fully automated, jalanin:

```bash
bun run configure
```

Wizard interaktif buat pilih model (Claude/GPT-4o) dan simpan API key ke `.env`. Setelah itu pipeline langsung call LLM tanpa interupsi.

## Stages

Pipeline terdiri dari 5 stage yang bisa dijalanin secara standalone:

| Stage | Input | Output |
|---|---|---|
| `download-transcript` | YouTube URL | `transcript.txt`, `subtitle.vtt` |
| `analyze-transcript` | video ID | `clips.json` |
| `download-video` | video ID + `clips.json` | `clip_NN_raw.mp4` per clip |
| `process-editing` | video ID | `clip_NN_reframed.mp4` (9:16) |
| `process-rendering` | video ID | `clip_NN_final.mp4` dengan subtitle |

Semua artifact disimpan di `workdir/<video-id>/`.

### analyze-transcript

Kalau `DISINGKAT_MODEL` di-set (via `bun run configure`) → auto call LLM, langsung simpan ke `clips.json`.

Kalau belum dikonfigure → manual:
1. Buka `workdir/<id>/prompt.txt`
2. Paste ke Claude/ChatGPT
3. Simpan JSON response ke `workdir/<id>/clips.json`
4. Lanjut dari stage `download-video`

Format `clips.json`:
```json
[
  { "start": 123.5, "end": 178.2, "title": "...", "reason": "..." }
]
```

### Reframe modes

- `split-vertical` — split kiri/kanan, stack vertikal (default, cocok untuk 2 orang)
- `center-crop` — crop tengah ke 9:16
- `letterbox` — scale fit + black bars
