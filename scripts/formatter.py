class TranscriptFormatter:
    def format_transcript(self, transcript_data):
        seen = set()
        vtt_lines = ['WEBVTT\n', '\n']
        transcript_parts = []

        for entry in transcript_data:
            text = entry['text'].strip()
            if not text or text in seen:
                continue
            seen.add(text)

            start = self._seconds_to_vtt_time(entry['start'])
            end = self._seconds_to_vtt_time(entry['start'] + entry['duration'])
            vtt_lines.append(f"{start} --> {end}\n")
            vtt_lines.append(f"{text}\n\n")
            transcript_parts.append(text)

        return {
            'final_result': vtt_lines,
            'transcript': ' '.join(transcript_parts)
        }

    def _seconds_to_vtt_time(self, seconds):
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = seconds % 60
        return f"{hours:02}:{minutes:02}:{secs:06.3f}"
