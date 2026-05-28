from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import NoTranscriptFound
import re

class YoutubeTranscriptDownloader:
    def _extract_video_id(self, url):
        match = re.search(r'(?:v=|youtu\.be/)([^&?/]+)', url)
        if match:
            return match.group(1)
        return url

    def get_transcript(self, video_url):
        video_id = self._extract_video_id(video_url)
        ytt_api = YouTubeTranscriptApi()
        transcript_list = ytt_api.list(video_id)
        try:
            transcript = transcript_list.find_generated_transcript(
                [t.language_code for t in transcript_list]
            )
        except NoTranscriptFound:
            transcript = transcript_list.find_transcript(
                [t.language_code for t in transcript_list]
            )
        fetched = transcript.fetch()
        snippets = [{'text': s.text, 'start': s.start, 'duration': s.duration} for s in fetched]
        return snippets, transcript.language_code
