# disingkat

Otomatis potong YouTube long-form jadi short clips (TikTok/Reels/Shorts).

Pipeline: download transcript → analisa → download segmen → reframe 9:16 → burn subtitle.

---

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.1
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [ffmpeg](https://ffmpeg.org)
- Python 3 + `youtube-transcript-api`

```bash
pip install youtube-transcript-api

# macOS
brew install yt-dlp ffmpeg

# Ubuntu/Debian
sudo apt install yt-dlp ffmpeg
```

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

Jalankan dari root project. Akan muncul menu interaktif untuk pilih video dan stage yang mau dijalankan.

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
| `download-transcript` | YouTube URL | `transcript.txt`, `subtitle.vtt` |
| `analyze-transcript` | `subtitle.vtt` | `clips.json` |
| `download-video` | `clips.json` | `clip_NN_raw.mp4` per clip |
| `process-editing` | `clip_NN_raw.mp4` | `clip_NN_reframed.mp4` (9:16) |
| `process-rendering` | `clip_NN_reframed.mp4` | `clip_NN_final.mp4` (dengan subtitle) |

Semua artifact disimpan di `workdir/<video-id>/`.

### analyze-transcript

**Auto** (kalau `DISINGKAT_MODEL` di-set via `bun run configure`): langsung call LLM, simpan hasil ke `clips.json`.

**Manual**: generate `prompt.txt`, lalu:
1. Copy isi `workdir/<id>/prompt.txt`
2. Paste ke Claude/ChatGPT
3. Simpan JSON response ke `workdir/<id>/clips.json`
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
| `split-vertical` | Split frame kiri/kanan, stack vertikal. Default. Cocok untuk video 2 orang (wawancara, podcast). |
| `center-crop` | Crop bagian tengah frame ke rasio 9:16. Cocok untuk talking head single orang. |
| `letterbox` | Scale fit + black bars atas-bawah. Cocok kalau nggak mau ada yang terpotong. |

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

## Struktur workdir

```
workdir/
└── <video-id>/
    ├── transcript.txt          # transcript teks biasa
    ├── subtitle.vtt            # subtitle dengan timestamp
    ├── prompt.txt              # prompt siap pakai (mode manual)
    ├── clips.json              # hasil analisa: array ClipSpec
    ├── clip_01_raw.mp4         # segmen mentah hasil yt-dlp
    ├── clip_01_reframed.mp4    # setelah reframe 9:16
    ├── clip_01.srt             # subtitle per-clip (untuk debug)
    └── clip_01_final.mp4       # output akhir dengan subtitle ter-burn
```
