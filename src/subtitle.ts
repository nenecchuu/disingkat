export interface Cue {
  start: number;
  end: number;
  text: string;
}

export function parseVtt(vtt: string): Cue[] {
  const lines = vtt.replace(/\r/g, "").split("\n");
  const raw: Cue[] = [];
  let i = 0;
  if (lines[0]?.startsWith("WEBVTT")) i = 1;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line || /^NOTE/i.test(line) || /^WEBVTT/.test(line)) { i++; continue; }

    const tsLine = line.includes("-->") ? line : lines[i + 1] ?? "";
    if (!tsLine.includes("-->")) { i++; continue; }
    if (!line.includes("-->")) i++;

    const [startStr, endStr] = tsLine.split("-->").map((s) => s.trim().split(" ")[0]);
    const start = toSeconds(startStr);
    const end = toSeconds(endStr);
    i++;

    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") {
      textLines.push(lines[i]);
      i++;
    }

    const text = stripTags(textLines.join("\n")).trim();
    if (text) raw.push({ start, end, text });
    i++;
  }

  return cleanYoutubeCues(raw);
}

function stripTags(s: string): string {
  return s
    .replace(/<\d{2}:\d{2}:\d{2}\.\d+>/g, "")
    .replace(/<\/?\w[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function cleanYoutubeCues(raw: Cue[]): Cue[] {
  const result: Cue[] = [];

  for (const cue of raw) {
    const lines = cue.text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    // YouTube auto-sub: multi-line cue = [old line] + [new building line]
    // Take only the last line (the new/current sentence)
    const text = lines[lines.length - 1];

    const last = result[result.length - 1];
    if (last && last.text === text) {
      last.end = cue.end;
    } else {
      result.push({ start: cue.start, end: cue.end, text });
    }
  }

  return result;
}

export function sliceToSrt(cues: Cue[], clipStart: number, clipEnd: number): string {
  const sliced = cues
    .filter((c) => c.end > clipStart && c.start < clipEnd)
    .map((c) => ({
      start: Math.max(0, c.start - clipStart),
      end: Math.min(clipEnd - clipStart, c.end - clipStart),
      text: c.text,
    }));

  return sliced
    .map((c, idx) => `${idx + 1}\n${toSrtTs(c.start)} --> ${toSrtTs(c.end)}\n${c.text}\n`)
    .join("\n");
}

function toSeconds(ts: string): number {
  const parts = ts.split(":");
  let h = 0, m = 0, s = 0;
  if (parts.length === 3) {
    h = parseInt(parts[0], 10);
    m = parseInt(parts[1], 10);
    s = parseFloat(parts[2].replace(",", "."));
  } else if (parts.length === 2) {
    m = parseInt(parts[0], 10);
    s = parseFloat(parts[1].replace(",", "."));
  }
  return h * 3600 + m * 60 + s;
}

function toSrtTs(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec - h * 3600 - m * 60;
  const whole = Math.floor(s);
  const ms = Math.round((s - whole) * 1000);
  return `${pad2(h)}:${pad2(m)}:${pad2(whole)},${pad3(ms)}`;
}

function pad2(n: number): string { return String(n).padStart(2, "0"); }
function pad3(n: number): string { return String(n).padStart(3, "0"); }
