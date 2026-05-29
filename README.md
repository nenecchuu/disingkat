# disingkat

Otomatis potong YouTube long-form jadi short clips (TikTok/Reels/Shorts).

Pipeline: download transcript → analisa LLM → download segmen → reframe 9:16 → burn subtitle.

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

Edit `configs/clip_config.yaml` dan `configs/prompt.md` sesuai kebutuhan (lihat bagian [Konfigurasi](#konfigurasi) di bawah).

---

## Usage

```bash
bun run disingkat
```

Jalankan dari root project. Akan muncul menu interaktif:

```
? Mau ngapain?
  Proses video baru (dari URL YouTube)
  Lanjutin video yang udah ada
  Jalanin 1 stage doang
  Keluar
```

---

## Auto-analyze dengan LLM (opsional)

Default-nya, stage `analyze-transcript` mode manual — generate `prompt.txt` dan minta copy-paste ke Claude/ChatGPT.

Untuk fully automated, setup dulu:

```bash
bun run configure
```

Wizard interaktif untuk pilih platform dan model. Tersedia:

| Platform | Contoh model | Auth |
|---|---|---|
| Anthropic (Claude) | `claude-opus-4-7` | API key |
| OpenAI | `gpt-4.1`, `o3`, `gpt-4o` | API key |
| Codex | `codex` | OAuth (login via browser) |

Config disimpan ke `.env` di root project. Jalanin lagi `bun run configure` untuk ganti model/platform atau switch balik ke manual.

---

## Konfigurasi

### `configs/clip_config.yaml`

```yaml
# Target audiens — dimasukkan ke prompt LLM
audience: Indonesia, urban, 18-35

# Tone konten
tone: provocative-but-factual

# Topik yang dicari oleh LLM
topics_of_interest:
  - quotes yang menginspirasi
  - kritik kebijakan pemerintah

# Keyword prioritas — segmen yang nyebut ini lebih diprioritaskan
keywords:
  - Dollar
  - Sawit

# Hal yang harus dihindari
exclude:
  - Clip yang jadi out of context karena diambil dari bagian yang salah

# Durasi clip yang diinginkan (detik)
duration:
  min: 30
  max: 90

# Detik ekstra yang ditambah ke akhir setiap clip saat download
# Berguna agar potongan tidak terlalu kasar di ending. Default: 1.5
end_buffer: 3
```

### `configs/prompt.md`

Template prompt yang dikirim ke LLM. Placeholder yang tersedia:

| Placeholder | Diisi dengan |
|---|---|
| `{{audience}}` | `audience` dari clip_config.yaml |
| `{{tone}}` | `tone` dari clip_config.yaml |
| `{{topics_of_interest}}` | list `topics_of_interest` |
| `{{keywords}}` | list `keywords` |
| `{{exclude}}` | list `exclude` |
| `{{duration_min}}` | `duration.min` |
| `{{duration_max}}` | `duration.max` |
| `{{subtitle}}` | transcript video (diisi otomatis saat runtime) |

---

## Stages

Pipeline terdiri dari 5 stage yang bisa dijalanin secara standalone via menu interaktif:

| Stage | Baca | Tulis |
|---|---|---|
| `download-transcript` | YouTube URL | `data/transcript.txt`, `data/subtitle.vtt` |
| `analyze-transcript` | `data/subtitle.vtt` | `data/clips.json` |
| `download-video` | `data/clips.json` | `raw/clip_NN_raw.mp4` per clip |
| `process-editing` | `raw/clip_NN_raw.mp4` | `data/clip_NN_reframed.mp4` (9:16) |
| `process-rendering` | `data/clip_NN_reframed.mp4` | `clip_NN_final.mp4` (dengan subtitle) |

Semua artifact disimpan di `workdir/<video-id>/`.

### analyze-transcript

**Auto** (kalau `DISINGKAT_MODEL` di-set via `bun run configure`): langsung call LLM, simpan hasil ke `data/clips.json`.

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
    "title": "Judul singkat max 60 char",
    "reason": "1 kalimat kenapa ini berpotensi viral"
  }
]
```

Field `title` dan `reason` opsional — tidak berpengaruh ke proses rendering, hanya untuk referensi.

### process-editing — reframe modes

Pilih mode saat stage `process-editing` dijalankan:

| Mode | Deskripsi |
|---|---|
| `center-crop` | Crop bagian tengah frame ke rasio 9:16. **Default.** |
| `speaker-crop` | Auto-detect scene cut, crop ke wajah speaker di tiap scene. |
| `split-vertical` | Split frame kiri/kanan, stack vertikal. |
| `letterbox` | Scale fit + black bars atas-bawah. |

#### speaker-crop

Mode ini tidak butuh setup tambahan — dependency (`opencv-python`, `mediapipe`, `scenedetect`) dikelola otomatis oleh `uv`.

Cara kerjanya:
1. **Detect scene cuts** via PySceneDetect `AdaptiveDetector` — lebih akurat dari histogram diff manual
2. **Per segment**, sample beberapa frame → detect wajah pakai MediaPipe `blaze_face_full_range`
3. Pilih wajah terbesar (paling dekat kamera), dengan NMS untuk eliminasi double detection
4. **Encode tiap segment** dengan crop yang sudah fix, lalu concat — tidak ada transisi, cut langsung snap ke posisi baru

Model CV di-download otomatis ke `scripts/models/` saat pertama kali dijalankan.

Fallback ke `center-crop` kalau deteksi gagal atau tidak ada wajah terdeteksi.

### process-rendering — subtitle quality

Subtitle di-burn ke video menggunakan `libass` kalau tersedia, fallback ke `drawtext` kalau tidak.

`ffmpeg` dari Homebrew default tidak include `libass`. Untuk kualitas lebih baik di macOS:

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
| `ANTHROPIC_API_KEY` | API key Anthropic (kalau platform = anthropic) |
| `OPENAI_API_KEY` | API key OpenAI (kalau platform = openai) |
| `DISINGKAT_WORKDIR` | Override lokasi workdir. Default: `./workdir` |

Semua variable ini bisa diset di file `.env` di root project — Bun auto-load saat runtime.

---

## Struktur project

```
disingkat/
├── configs/
│   ├── clip_config.yaml        # konfigurasi clip (audience, topik, durasi)
│   └── prompt.md               # template prompt LLM
├── scripts/
│   ├── get_transcript.py       # download transcript dari YouTube
│   ├── detect_scenes.py        # deteksi scene cut via PySceneDetect
│   ├── detect_speakers.py      # deteksi posisi wajah per scene
│   └── models/                 # model CV (di-download otomatis, di-gitignore)
│       └── blaze_face_full_range.tflite
├── src/
│   ├── cli.ts                  # menu interaktif
│   ├── pipeline.ts             # orchestrator stage
│   ├── stages/
│   │   ├── download-transcript.ts
│   │   ├── analyze-transcript.ts
│   │   ├── download-video.ts
│   │   ├── process-editing.ts
│   │   └── process-rendering.ts
│   ├── llm.ts                  # integrasi Anthropic / OpenAI / Codex
│   ├── subtitle.ts             # parser VTT + slicer SRT
│   ├── types.ts
│   └── workdir.ts              # path helpers
└── workdir/
    └── <video-id>/
        ├── clip_01_final.mp4   # ← output akhir
        ├── raw/
        │   └── clip_NN_raw.mp4
        └── data/
            ├── clips.json
            ├── subtitle.vtt
            ├── transcript.txt
            ├── prompt.txt
            ├── clip_NN_reframed.mp4
            ├── clip_NN.srt
            ├── clip_NN_scenes.json
            └── clip_NN_speaker_events.json
```
