"""
AI Debate WebSocket router.

Handles the full lifecycle of a human-vs-AI debate:
  1. Client opens WS and sends a "start" message with topic.
  2. Client streams raw PCM-16 kHz audio as binary frames.
  3. Server forwards audio to Gemini Live and relays Gemini's audio back.
  4. Text control messages (JSON) flow alongside binary audio frames.
  5. On "end", the server runs post-debate Gemini analysis and sends it back.
"""

from __future__ import annotations

import asyncio
import json
import logging
import traceback

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from services.gemini_live import GeminiLiveSession
from services.gemini_analysis import analyze_debate

router = APIRouter()
log = logging.getLogger("ai_debate")


@router.websocket("/ws")
async def ai_debate_ws(websocket: WebSocket):
    """
    Mixed-mode WebSocket:
      TEXT frames  → JSON control messages
      BINARY frames → raw PCM-16kHz audio from user's mic
    """
    await websocket.accept()
    log.info("AI debate WebSocket ACCEPTED  client=%s", websocket.client)

    session = GeminiLiveSession()
    receiver_task: asyncio.Task | None = None
    topic = ""
    user_name = ""
    audio_frames_sent = 0

    async def _gemini_receiver():
        """Background task: read from Gemini Live and push to the client."""
        log.info("Gemini receiver task STARTED")
        msg_count = 0
        try:
            async for msg in session.receive_responses():
                msg_count += 1
                mtype = msg["type"]

                if mtype == "audio":
                    await websocket.send_json(
                        {"type": "audio", "data": {"audio": msg["data"]}}
                    )
                elif mtype == "transcript":
                    log.info("→ Sending AI transcript to client: %r", msg["data"].get("text", "")[:80])
                    await websocket.send_json(
                        {"type": "ai_transcript", "data": msg["data"]}
                    )
                elif mtype == "turn_complete":
                    log.debug("→ turn_complete sent to client")
                    await websocket.send_json({"type": "turn_complete"})
                elif mtype == "error":
                    log.error("→ Gemini error forwarded to client: %s", msg["data"])
                    await websocket.send_json(
                        {"type": "error", "data": msg["data"]}
                    )
        except asyncio.CancelledError:
            log.info("Gemini receiver task cancelled")
        except Exception:
            log.error("Gemini receiver task CRASHED:\n%s", traceback.format_exc())
            try:
                await websocket.send_json(
                    {"type": "error", "data": {"message": f"Gemini receiver error: {traceback.format_exc()}"}}
                )
            except Exception:
                pass
        log.info("Gemini receiver task ENDED  (relayed %d messages)", msg_count)

    try:
        while True:
            message = await websocket.receive()

            # ── Binary frame → raw PCM audio to Gemini ────────────────────
            if "bytes" in message and message["bytes"]:
                audio_frames_sent += 1
                if audio_frames_sent % 100 == 1:
                    log.debug("Audio frame #%d  (%d bytes) → Gemini", audio_frames_sent, len(message["bytes"]))
                await session.send_audio(message["bytes"])
                continue

            # ── Text frame → JSON control message ─────────────────────────
            if "text" in message and message["text"]:
                data = json.loads(message["text"])
                mtype = data.get("type", "")
                log.info("← Client text message:  type=%s", mtype)

                if mtype == "start":
                    topic = data["data"]["topic"]
                    user_name = data["data"].get("user_name", "User")
                    log.info("START debate:  topic=%r  user=%s", topic, user_name)

                    try:
                        await session.connect(topic)
                    except Exception:
                        err = traceback.format_exc()
                        log.error("session.connect FAILED:\n%s", err)
                        await websocket.send_json(
                            {"type": "error", "data": {"message": f"Failed to connect to Gemini: {err}"}}
                        )
                        return

                    receiver_task = asyncio.create_task(_gemini_receiver())
                    await websocket.send_json({"type": "started"})
                    log.info("Sent 'started' to client — debate is LIVE")

                elif mtype == "user_transcript":
                    text = data["data"].get("text", "")
                    if text:
                        log.debug("User transcript received: %r", text[:80])
                        session.add_user_transcript(text)

                elif mtype == "end":
                    log.info("Client requested END — breaking main loop")
                    break

    except WebSocketDisconnect:
        log.info("Client disconnected (WebSocketDisconnect)")
    except json.JSONDecodeError as exc:
        log.error("Invalid JSON from client: %s", exc)
        try:
            await websocket.send_json(
                {"type": "error", "data": {"message": f"Invalid JSON: {exc}"}}
            )
        except Exception:
            pass
    except Exception:
        log.error("Unexpected error in AI debate WS handler:\n%s", traceback.format_exc())
        try:
            await websocket.send_json(
                {"type": "error", "data": {"message": traceback.format_exc()}}
            )
        except Exception:
            pass
    finally:
        log.info("AI debate cleanup:  audio_frames_sent=%d  transcripts=%d", audio_frames_sent, len(session.transcripts))

        # Cancel the Gemini receiver
        if receiver_task and not receiver_task.done():
            receiver_task.cancel()
            try:
                await receiver_task
            except asyncio.CancelledError:
                pass

        # Close Gemini session
        await session.close()

        # Run post-debate analysis
        transcripts = session.transcripts
        if transcripts:
            log.info("Running post-debate analysis on %d transcript entries…", len(transcripts))
            try:
                analysis = await analyze_debate(
                    transcripts, topic, (user_name, "AI Opponent")
                )
                log.info("Analysis complete (%d chars) — sending to client", len(analysis))
                await websocket.send_json(
                    {"type": "analysis", "data": {"result": analysis}}
                )
            except Exception:
                log.error("Failed to send analysis:\n%s", traceback.format_exc())
        else:
            log.warning("No transcripts to analyze — skipping analysis")

        try:
            await websocket.send_json({"type": "ended"})
            log.info("Sent 'ended' to client")
        except Exception:
            log.warning("Could not send 'ended' (client already disconnected)")

        try:
            await websocket.close()
        except Exception:
            pass

        log.info("AI debate session FINISHED")
