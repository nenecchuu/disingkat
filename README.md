# disingkat

Otomatis potong YouTube long-form jadi short clips (TikTok/Reels/Shorts).

Pipeline: download transcript → analisa LLM → download segmen → reframe 9:16 → (opsional) subtitle → output final.

---

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.1
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [ffmpeg](https://ffmpeg.org)
- [uv](https://docs.astral.sh/uv/) — Python package manager (untuk transcript + speaker detection)

```bash
# macOS
brew install yt-dlp ffmpeg uv

# Ubuntu/Debian
sudo apt install yt-dlp ffmpeg
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Python dependencies dikelola otomatis oleh `uv` — tidak perlu `pip install` manual.

---

## Setup

```bash
bun install

cp configs/clip_config.example.yaml configs/clip_config.yaml
cp configs/prompt.example.md configs/prompt.md
```

Edit `configs/clip_config.yaml` dan `configs/prompt.md` sesuai kebutuhan.

---

## Usage

```bash
bun run disingkat
```

Menu interaktif:

```
? Mau ngapain?
  Full     — proses video baru dari URL YouTube
  Existing — lanjutin video yang udah ada
  Run      — jalanin 1 stage doang
  Keluar
```

**Full / Existing** akan tanya:
1. Mode reframe (center-crop, speaker-crop, split-vertical, letterbox)
2. Kalau speaker-crop: metode deteksi (largest-face atau lip-movement)
3. Tambahkan subtitle? → kalau ya, pilih Whisper model

Pipeline berhenti di `process-editing` by default. Subtitle opsional.

---

## Auto-analyze dengan LLM (opsional)

Default-nya, stage `analyze-transcript` mode manual — generate `prompt.txt` dan minta copy-paste ke Claude/ChatGPT.

Untuk fully automated:

```bash
bun run configure
```

Wizard interaktif untuk pilih platform dan model. Tersedia:

| Platform | Contoh model | Auth |
|---|---|---|
| Anthropic (Claude) | `claude-opus-4-7` | API key |
| OpenAI | `gpt-4.1`, `o3`, `gpt-4o` | API key |
| Codex | `codex` | OAuth (login via browser) |

Config disimpan ke `.env`. Jalanin lagi `bun run configure` untuk ganti atau switch ke manual.

---

## Konfigurasi

### `configs/clip_config.yaml`

```yaml
audience: Indonesia, urban, 18-35
tone: provocative-but-factual

topics_of_interest:
  - quotes yang menginspirasi
  - kritik kebijakan pemerintah

keywords:
  - Dollar
  - Sawit

exclude:
  - Clip yang jadi out of context

duration:
  min: 30
  max: 90

# Detik ekstra di akhir clip saat download. Default: 1.5
end_buffer: 3
```

### `configs/prompt.md`

Template prompt LLM untuk analisa transcript. Placeholder:

| Placeholder | Diisi dengan |
|---|---|
| `{{audience}}` | `audience` dari clip_config.yaml |
| `{{tone}}` | `tone` |
| `{{topics_of_interest}}` | list topik |
| `{{keywords}}` | list keyword |
| `{{exclude}}` | list exclusion |
| `{{duration_min}}` / `{{duration_max}}` | durasi min/max |
| `{{subtitle}}` | transcript (diisi otomatis) |

LLM diminta output `hook_start` — detik paling explosive dalam segmen untuk dijadikan opening clip. Kalau awal segmen sudah kuat, `hook_start == start`.

### `configs/subtitle_prompt.md`

Template prompt untuk koreksi subtitle via LLM (stage `verify-subtitle`). LLM menerima transcript semua clip sekaligus dan output daftar koreksi format `kata_salah -> kata_benar`.

### `configs/models.yaml`

URL dan filename model CV. Edit untuk pakai model yang berbeda tanpa ubah script:

```yaml
face_detector:
  url: "https://..."
  filename: "blaze_face_full_range.tflite"

face_landmarker:
  url: "https://..."
  filename: "face_landmarker.task"

whisper:
  default: "base"
  # tiny, base, small, medium, large
```

Model di-download otomatis ke `scripts/models/` saat pertama kali dibutuhkan.

---

## Stages

| Stage | Baca | Tulis |
|---|---|---|
| `download-transcript` | YouTube URL | `data/transcript.txt`, `data/subtitle.vtt` |
| `analyze-transcript` | `data/subtitle.vtt` | `data/clips.json` |
| `download-video` | `data/clips.json` | `raw/clip_NN_raw.mp4` |
| `process-editing` | `raw/clip_NN_raw.mp4` | `reframed/clip_NN_reframed.mp4` |
| `transcribe` | `reframed/clip_NN_reframed.mp4` | `data/clip_NN_words.json` |
| `verify-subtitle` | `data/clip_NN_words.json` | `data/clip_NN_words.json` (dikoreksi) |
| `burn-subtitle` | `reframed/` + `data/clip_NN_words.json` | `clip_NN_final.mp4` |

### analyze-transcript

**Auto** (kalau `DISINGKAT_MODEL` di-set): langsung call LLM → `data/clips.json`.

**Manual**: generate `data/prompt.txt`, lalu:
1. Copy isi `workdir/<id>/data/prompt.txt`
2. Paste ke Claude/ChatGPT
3. Simpan JSON response ke `workdir/<id>/data/clips.json`
4. Lanjut dari stage `download-video`

Format `clips.json`:
```json
[
  {
    "start": 123.5,
    "end": 178.2,
    "hook_start": 128.0,
    "title": "Judul singkat max 60 char",
    "reason": "1 kalimat kenapa ini berpotensi viral"
  }
]
```

`hook_start` — detik mulai yang explosive. Video di-download dari `hook_start`, bukan `start`. Kalau tidak ada, fallback ke `start`.

### process-editing — reframe modes

| Mode | Deskripsi |
|---|---|
| `center-crop` | Crop tengah ke 9:16. **Default.** |
| `speaker-crop` | Auto-detect scene cut, crop ke wajah speaker per scene. |
| `split-vertical` | Split frame kiri/kanan, stack vertikal. |
| `letterbox` | Scale fit + black bars. |

#### speaker-crop — metode deteksi

| Metode | Deskripsi |
|---|---|
| `largest-face` | Wajah terbesar di frame. **Default.** Cepat, cocok untuk shot yang sudah di-cut ke speaker. |
| `lip-movement` | Wajah dengan mulut paling terbuka (FaceLandmarker). Lebih akurat untuk 2 orang dalam 1 frame. |

#### Cara kerja speaker-crop:
1. Detect scene cuts via PySceneDetect `AdaptiveDetector`
2. Per segment, sample beberapa frame → detect wajah
3. Encode tiap segment dengan crop fix → concat (cut langsung, tanpa transisi)

### transcribe + verify-subtitle + burn-subtitle

Subtitle pipeline (opsional):

1. **transcribe** — Whisper word-level timestamps → `data/clip_NN_words.json`
2. **verify-subtitle** — koreksi kata via LLM (1 API call untuk semua clip), atau buka manual di editor kalau tidak ada LLM
3. **burn-subtitle** — group per kalimat (gap-based), detect posisi wajah untuk hindari overlap, burn ke video

Subtitle di-burn pakai `libass` kalau tersedia, fallback ke `drawtext`.

Untuk kualitas lebih baik di macOS:
```bash
brew tap homebrew-ffmpeg/ffmpeg
brew install homebrew-ffmpeg/ffmpeg/ffmpeg --with-libass
```

---

## Environment variables

| Variable | Keterangan |
|---|---|
| `DISINGKAT_PLATFORM` | Platform LLM: `anthropic`, `openai`, atau `codex` |
| `DISINGKAT_MODEL` | Model ID, misal `claude-opus-4-7` atau `gpt-4.1` |
| `ANTHROPIC_API_KEY` | API key Anthropic |
| `OPENAI_API_KEY` | API key OpenAI |
| `DISINGKAT_WORKDIR` | Override lokasi workdir. Default: `./workdir` |

Semua variable bisa diset di `.env` — Bun auto-load saat runtime.

---

## Struktur project

```
disingkat/
├── configs/
│   ├── clip_config.yaml        # konfigurasi clip
│   ├── prompt.md               # template prompt analisa
│   ├── subtitle_prompt.md      # template prompt koreksi subtitle
│   └── models.yaml             # URL & filename model CV
├── scripts/
│   ├── get_transcript.py       # download transcript YouTube
│   ├── detect_scenes.py        # scene cut detection (PySceneDetect)
│   ├── detect_speakers.py      # posisi wajah per scene
│   ├── detect_face_zone.py     # zona wajah untuk posisi subtitle
│   ├── transcribe_clip.py      # Whisper word-level transcription
│   └── models/                 # model CV (auto-download, gitignored)
├── src/
│   ├── cli.ts
│   ├── pipeline.ts
│   ├── stages/
│   │   ├── download-transcript.ts
│   │   ├── analyze-transcript.ts
│   │   ├── download-video.ts
│   │   ├── process-editing.ts
│   │   ├── transcribe.ts
│   │   ├── verify-subtitle.ts
│   │   └── burn-subtitle.ts
│   ├── llm.ts
│   ├── subtitle.ts
│   ├── types.ts
│   └── workdir.ts
└── workdir/
    └── <video-id>/
        ├── clip_NN_final.mp4   # ← output akhir
        ├── raw/
        │   └── clip_NN_raw.mp4
        ├── reframed/
        │   └── clip_NN_reframed.mp4
        └── data/
            ├── clips.json
            ├── subtitle.vtt
            ├── transcript.txt
            ├── prompt.txt
            ├── clip_NN_words.json
            ├── clip_NN.srt
            ├── clip_NN_scenes.json
            └── clip_NN_speaker_events.json
```
