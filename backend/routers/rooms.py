"""
Room endpoints – REST for creation / listing, WebSocket for real-time
signaling, transcripts, and spectator feeds.
"""

from __future__ import annotations

import json
import logging
import traceback
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from models.schemas import RoomCreate, RoomResponse, RoomStatus
from services.room_manager import room_manager
from services.gemini_analysis import analyze_debate

router = APIRouter()
log = logging.getLogger("rooms")


# ── REST ───────────────────────────────────────────────────────────────────────


@router.post("/", response_model=RoomResponse, status_code=201)
async def create_room(body: RoomCreate):
    log.info("CREATE room:  topic=%r  user=%s", body.topic, body.user_name)
    room = room_manager.create_room(
        topic=body.topic,
        category=body.category,
        user_id=body.user_id,
        user_name=body.user_name,
    )
    log.info("Room created:  room_id=%s", room.room_id)
    return RoomResponse(
        room_id=room.room_id,
        topic=room.topic,
        category=room.category,
        status=room.status,
        participants=room.participants,
        spectator_count=room.spectator_count,
        created_at=room.created_at,
    )


@router.get("/{room_id}")
async def get_room(room_id: str):
    room = room_manager.get_room(room_id)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    return room_manager.room_state_dict(room_id)


@router.get("/")
async def list_rooms():
    return [room_manager.room_state_dict(r.room_id) for r in room_manager.get_active_rooms()]


# ── Debater WebSocket ──────────────────────────────────────────────────────────


@router.websocket("/ws/{room_id}")
async def room_ws(websocket: WebSocket, room_id: str):
    await websocket.accept()
    log.info("Debater WS ACCEPTED  room=%s  client=%s", room_id, websocket.client)

    user_id: Optional[str] = None
    user_name: Optional[str] = None

    try:
        # ── 1. First message must be a "join" ──────────────────────────────
        raw = await websocket.receive_text()
        msg = json.loads(raw)

        if msg.get("type") != "join":
            log.warning("First message was not 'join': %s", msg.get("type"))
            await websocket.send_json(
                {"type": "error", "data": {"message": "First message must be type 'join'"}}
            )
            await websocket.close(code=1008)
            return

        user_id = msg["data"]["user_id"]
        user_name = msg["data"]["user_name"]
        log.info("JOIN  room=%s  user=%s (%s)", room_id, user_name, user_id[:8])

        err = room_manager.add_participant(room_id, user_id, user_name, websocket)
        if err:
            log.warning("JOIN rejected:  %s", err)
            await websocket.send_json({"type": "error", "data": {"message": err}})
            await websocket.close(code=1008)
            return

        await websocket.send_json(
            {"type": "room_state", "data": room_manager.room_state_dict(room_id)}
        )

        await room_manager.broadcast_to_room(
            room_id,
            {"type": "user_joined", "data": {"user_id": user_id, "user_name": user_name}},
            exclude=user_id,
        )

        room = room_manager.get_room(room_id)
        if room and len(room.participants) == 2:
            log.info("Room %s is FULL — sending spectator link", room_id)
            await room_manager.broadcast_to_room(
                room_id,
                {"type": "spectator_link", "data": {"link": f"/spectate/{room_id}"}},
            )
            await room_manager.broadcast_to_room(
                room_id,
                {"type": "room_state", "data": room_manager.room_state_dict(room_id)},
            )

        # ── 2. Main message loop ──────────────────────────────────────────
        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)
            mtype = msg.get("type", "")
            log.debug("← room=%s  user=%s  type=%s", room_id, user_name, mtype)

            room = room_manager.get_room(room_id)
            if room is None:
                log.warning("Room %s disappeared — breaking", room_id)
                break

            if mtype == "offer":
                await room_manager.relay_to_peer(
                    room_id, user_id,
                    {"type": "offer", "data": {**msg["data"], "from": user_id}},
                )

            elif mtype == "answer":
                await room_manager.relay_to_peer(
                    room_id, user_id,
                    {"type": "answer", "data": {**msg["data"], "from": user_id}},
                )

            elif mtype == "ice_candidate":
                await room_manager.relay_to_peer(
                    room_id, user_id,
                    {"type": "ice_candidate", "data": {**msg["data"], "from": user_id}},
                )

            elif mtype == "request_start":
                log.info("START requested by %s in room %s", user_name, room_id)
                room.start_requester = user_id
                await room_manager.relay_to_peer(
                    room_id, user_id,
                    {"type": "start_requested", "data": {"by": user_name}},
                )

            elif mtype == "accept_start":
                log.info("START accepted in room %s — debate LIVE", room_id)
                room.status = RoomStatus.DEBATING
                await room_manager.broadcast_to_all(
                    room_id, {"type": "debate_started"}
                )

            elif mtype == "reject_start":
                log.info("START rejected by %s", user_name)
                room.start_requester = None
                await room_manager.relay_to_peer(
                    room_id, user_id,
                    {"type": "start_rejected", "data": {"by": user_name}},
                )

            elif mtype == "transcript":
                ts = datetime.utcnow().isoformat()
                entry = {**msg.get("data", {}), "timestamp": ts}
                room_manager.add_transcript(
                    room_id,
                    entry.get("speaker", user_name),
                    entry.get("text", ""),
                    entry.get("is_final", False),
                )
                await room_manager.broadcast_to_all(
                    room_id,
                    {"type": "transcript", "data": entry},
                    exclude=user_id,
                )

            elif mtype == "end_debate":
                log.info("DEBATE ENDED in room %s by %s", room_id, user_name)
                room.status = RoomStatus.FINISHED
                await room_manager.broadcast_to_all(
                    room_id, {"type": "debate_ended"}
                )

                transcripts = [t.model_dump() for t in room_manager.get_transcripts(room_id)]
                log.info("Running analysis on %d transcript entries…", len(transcripts))
                names = tuple(p.user_name for p in room.participants[:2]) if len(room.participants) >= 2 else ("Participant 1", "Participant 2")
                try:
                    analysis = await analyze_debate(transcripts, room.topic, names)
                    log.info("Analysis done (%d chars) — broadcasting", len(analysis))
                    await room_manager.broadcast_to_all(
                        room_id, {"type": "analysis", "data": {"result": analysis}}
                    )
                except Exception:
                    log.error("Analysis broadcast failed:\n%s", traceback.format_exc())

    except WebSocketDisconnect:
        log.info("Debater %s disconnected from room %s", user_name, room_id)
    except json.JSONDecodeError as exc:
        log.error("Invalid JSON from debater: %s", exc)
        try:
            await websocket.send_json(
                {"type": "error", "data": {"message": "Invalid JSON"}}
            )
        except Exception:
            pass
    except Exception:
        log.error("Unexpected error in room WS:\n%s", traceback.format_exc())
        try:
            await websocket.send_json(
                {"type": "error", "data": {"message": traceback.format_exc()}}
            )
        except Exception:
            pass
    finally:
        if user_id:
            room_manager.remove_participant(room_id, user_id)
            log.info("Removed %s from room %s", user_name, room_id)
            await room_manager.broadcast_to_room(
                room_id,
                {"type": "user_left", "data": {"user_id": user_id, "user_name": user_name}},
            )


# ── Spectator WebSocket ────────────────────────────────────────────────────────


@router.websocket("/ws/spectate/{room_id}")
async def spectator_ws(websocket: WebSocket, room_id: str):
    await websocket.accept()
    log.info("Spectator WS ACCEPTED  room=%s  client=%s", room_id, websocket.client)

    user_id: Optional[str] = None
    user_name: Optional[str] = None

    try:
        raw = await websocket.receive_text()
        msg = json.loads(raw)

        if msg.get("type") != "join":
            await websocket.send_json(
                {"type": "error", "data": {"message": "First message must be 'join'"}}
            )
            await websocket.close(code=1008)
            return

        user_id = msg["data"]["user_id"]
        user_name = msg["data"].get("user_name", "Spectator")
        log.info("Spectator JOIN  room=%s  user=%s", room_id, user_name)

        err = room_manager.add_spectator(room_id, user_id, user_name, websocket)
        if err:
            log.warning("Spectator JOIN rejected: %s", err)
            await websocket.send_json({"type": "error", "data": {"message": err}})
            await websocket.close(code=1008)
            return

        await websocket.send_json(
            {"type": "room_state", "data": room_manager.room_state_dict(room_id)}
        )

        existing = room_manager.get_transcripts(room_id)
        for t in existing:
            await websocket.send_json({"type": "transcript", "data": t.model_dump()})
        log.info("Sent %d existing transcripts to spectator %s", len(existing), user_name)

        room = room_manager.get_room(room_id)
        if room:
            await room_manager.broadcast_to_room(
                room_id,
                {"type": "spectator_joined", "data": {"spectator_count": room.spectator_count}},
            )

        while True:
            await websocket.receive_text()

    except WebSocketDisconnect:
        log.info("Spectator %s disconnected from room %s", user_name, room_id)
    except Exception:
        log.error("Spectator WS error:\n%s", traceback.format_exc())
    finally:
        if user_id:
            room_manager.remove_spectator(room_id, user_id)
            room = room_manager.get_room(room_id)
            if room:
                await room_manager.broadcast_to_room(
                    room_id,
                    {"type": "spectator_left", "data": {"spectator_count": room.spectator_count}},
                )
