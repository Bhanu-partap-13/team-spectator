"""
Gemini Live API integration using the Gemini 2.5 Native Audio model.
Uses v1alpha API and typed config/send pattern from working reference.
Note: Model is AUDIO-ONLY; we still capture any text from server_content for transcripts.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import traceback
import warnings
from typing import AsyncGenerator

from google import genai
from google.genai import types

from config import settings

# Suppress non-text parts warnings from SDK
warnings.filterwarnings("ignore", message=".*non-text parts.*")

log = logging.getLogger("gemini_live")

# v1alpha required for 2.5 Preview (per reference)
LIVE_MODEL = "models/gemini-2.5-flash-native-audio-preview-12-2025"

DEBATE_SYSTEM_PROMPT = """You are a world-class debate opponent in a live audio debate.

RULES:
1. Present well-reasoned, evidence-based arguments.
2. Directly counter the user's points with logic and verifiable facts.
3. Acknowledge strong opposing arguments before rebutting.
4. Use a variety of rhetorical strategies (analogy, reductio ad absurdum, Socratic questioning).
5. Keep each response concise – aim for 20-40 seconds of spoken audio.
6. Stay on the assigned topic at all times.
7. Be assertive but respectful; never resort to ad-hominem attacks.
8. If the user makes a factual error, politely correct it with a citation.

TOPIC: {topic}

Begin by presenting your opening argument when the user starts speaking.
"""


def _get_client():
    """Client with v1alpha for 2.5 Preview (required)."""
    if not settings.GEMINI_API_KEY:
        return None
    return genai.Client(
        api_key=settings.GEMINI_API_KEY,
        http_options={"api_version": "v1alpha"},
    )


class GeminiLiveSession:
    """Manages a single Gemini Live connection for one AI debate session."""

    def __init__(self) -> None:
        log.info("Creating GeminiLiveSession, api_key present = %s", bool(settings.GEMINI_API_KEY))
        self._client = _get_client()
        self._session = None
        self._cm = None  # async context manager from connect()
        self._transcripts: list[dict] = []
        self._running = False

    async def connect(self, topic: str) -> None:
        """Open a live connection to Gemini with the debate prompt.
        connect() returns an async context manager; we __aenter__ it to get the session.
        """
        if not self._client:
            log.warning("Gemini client not configured (no API key)")
            self._running = True
            return

        log.info("Connecting to Gemini Live…  model=%s  topic=%r", LIVE_MODEL, topic[:80])

        system_instruction = DEBATE_SYSTEM_PROMPT.format(topic=topic)
        try:
            config = types.LiveConnectConfig(
                response_modalities=["AUDIO"],
                system_instruction=types.Content(
                    parts=[types.Part(text=system_instruction)]
                ),
            )
            self._cm = self._client.aio.live.connect(model=LIVE_MODEL, config=config)
            self._session = await self._cm.__aenter__()
            self._running = True
            log.info("Gemini Live session CONNECTED successfully")
        except Exception:
            log.error("FAILED to connect to Gemini Live:\n%s", traceback.format_exc())
            raise

    async def send_audio(self, pcm_bytes: bytes) -> None:
        """Send raw PCM-16 kHz audio to Gemini WITHOUT ending the turn (streaming)."""
        if not self._session or not self._running:
            return
        try:
            await self._session.send(
                input=types.LiveClientRealtimeInput(
                    media_chunks=[
                        types.Blob(data=pcm_bytes, mime_type="audio/pcm;rate=16000")
                    ]
                ),
                end_of_turn=False,
            )
        except Exception:
            log.error("Error sending audio to Gemini:\n%s", traceback.format_exc())

    async def receive_responses(self) -> AsyncGenerator[dict, None]:
        """
        Yield dicts: {"type": "audio", "data": base64}, {"type": "transcript", "data": {...}}, {"type": "turn_complete"}.
        Matches reference: session.receive() then response.text, response.data, server_content.turn_complete.
        """
        if self._session is None:
            log.warning("receive_responses called but session is None")
            return

        log.info("Starting Gemini receive loop…")
        audio_chunks = 0
        text_chunks = 0

        try:
            while self._running:
                async for response in self._session.receive():
                    # Reference pattern: top-level response.text and response.data
                    if getattr(response, "text", None):
                        text_chunks += 1
                        log.info("Gemini transcript #%d: %r", text_chunks, response.text[:120])
                        self._transcripts.append({"speaker": "ai", "text": response.text})
                        yield {"type": "transcript", "data": {"speaker": "ai", "text": response.text}}

                    if getattr(response, "data", None):
                        data = response.data
                        if isinstance(data, bytes):
                            audio_chunks += 1
                            if audio_chunks % 50 == 1:
                                log.debug("Gemini audio chunk #%d  (%d bytes)", audio_chunks, len(data))
                            yield {"type": "audio", "data": base64.b64encode(data).decode()}
                        elif isinstance(data, str):
                            audio_chunks += 1
                            yield {"type": "audio", "data": data}

                    # Turn complete ends this turn
                    server_content = getattr(response, "server_content", None)
                    if server_content and getattr(server_content, "turn_complete", False):
                        log.debug("Gemini turn complete (audio_chunks=%d, text_chunks=%d)", audio_chunks, text_chunks)
                        yield {"type": "turn_complete"}
                        break

                    # Fallback: parse server_content.model_turn.parts (some SDK versions)
                    if server_content and getattr(server_content, "interrupted", False):
                        log.debug("Gemini turn was interrupted")
                        continue
                    model_turn = getattr(server_content, "model_turn", None) if server_content else None
                    if model_turn and model_turn.parts:
                        for part in model_turn.parts:
                            inline = getattr(part, "inline_data", None)
                            if inline and isinstance(getattr(inline, "data", None), bytes):
                                b = inline.data
                                audio_chunks += 1
                                if audio_chunks % 50 == 1:
                                    log.debug("Gemini audio chunk #%d  (%d bytes)", audio_chunks, len(b))
                                yield {"type": "audio", "data": base64.b64encode(b).decode()}
                            pt = getattr(part, "text", None)
                            if pt:
                                text_chunks += 1
                                log.info("Gemini transcript #%d: %r", text_chunks, pt[:120])
                                self._transcripts.append({"speaker": "ai", "text": pt})
                                yield {"type": "transcript", "data": {"speaker": "ai", "text": pt}}
                        if getattr(server_content, "turn_complete", False):
                            yield {"type": "turn_complete"}
                            break

        except asyncio.CancelledError:
            log.info("Gemini receive loop cancelled (expected on shutdown)")
        except Exception:
            err = traceback.format_exc()
            log.error("Gemini receive loop error:\n%s", err)
            yield {"type": "error", "data": {"message": str(err)}}

        log.info("Gemini receive loop ended. Total audio_chunks=%d  text_chunks=%d", audio_chunks, text_chunks)

    def add_user_transcript(self, text: str) -> None:
        log.debug("User transcript stored: %r", text[:100])
        self._transcripts.append({"speaker": "user", "text": text})

    @property
    def transcripts(self) -> list[dict]:
        return list(self._transcripts)

    async def close(self) -> None:
        log.info("Closing Gemini Live session…")
        self._running = False
        if self._cm is not None:
            try:
                await self._cm.__aexit__(None, None, None)
                log.info("Gemini Live session closed cleanly")
            except Exception:
                log.warning("Error closing Gemini context:\n%s", traceback.format_exc())
            self._cm = None
        self._session = None
