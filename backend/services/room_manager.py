"""
In-memory room manager.

Keeps track of every active debate room, its participants, spectators, and
transcript history.  All state lives in RAM – restarting the server clears it.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime
from typing import Optional

from fastapi import WebSocket

from models.schemas import (
    Participant,
    ParticipantRole,
    Room,
    RoomStatus,
    TranscriptEntry,
)


class _Connection:
    """Thin wrapper around a WebSocket so we can tag it with metadata."""

    def __init__(self, ws: WebSocket, user_id: str, user_name: str, role: ParticipantRole):
        self.ws = ws
        self.user_id = user_id
        self.user_name = user_name
        self.role = role

    async def send_json(self, data: dict) -> None:
        try:
            await self.ws.send_json(data)
        except Exception:
            pass  # connection may already be closed


class RoomManager:
    """Singleton that manages all debate rooms."""

    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}
        # room_id -> list[_Connection]  (debaters)
        self.connections: dict[str, list[_Connection]] = {}
        # room_id -> list[_Connection]  (spectators)
        self.spectators: dict[str, list[_Connection]] = {}

    # ── Room lifecycle ─────────────────────────────────────────────────────

    def create_room(self, topic: str, category: str, user_id: str, user_name: str) -> Room:
        room = Room(
            room_id=str(uuid.uuid4())[:8],
            topic=topic,
            category=category,
            status=RoomStatus.WAITING,
            created_by=user_id,
        )
        self.rooms[room.room_id] = room
        self.connections[room.room_id] = []
        self.spectators[room.room_id] = []
        return room

    def get_room(self, room_id: str) -> Optional[Room]:
        return self.rooms.get(room_id)

    def delete_room(self, room_id: str) -> None:
        self.rooms.pop(room_id, None)
        self.connections.pop(room_id, None)
        self.spectators.pop(room_id, None)

    def get_active_rooms(self) -> list[Room]:
        """Return rooms that are waiting or debating (for potential spectators)."""
        return [r for r in self.rooms.values() if r.status in (RoomStatus.READY, RoomStatus.DEBATING)]

    # ── Participant management ─────────────────────────────────────────────

    def add_participant(
        self, room_id: str, user_id: str, user_name: str, ws: WebSocket
    ) -> Optional[str]:
        """
        Add a debater to the room.
        Returns an error string if something goes wrong, None on success.
        """
        room = self.rooms.get(room_id)
        if room is None:
            return "Room not found"
        if len(room.participants) >= 2:
            return "Room is full"
        if any(p.user_id == user_id for p in room.participants):
            return "Already in room"

        room.participants.append(
            Participant(user_id=user_id, user_name=user_name, role=ParticipantRole.DEBATER)
        )
        self.connections[room_id].append(
            _Connection(ws, user_id, user_name, ParticipantRole.DEBATER)
        )

        if len(room.participants) == 2:
            room.status = RoomStatus.READY

        return None

    def remove_participant(self, room_id: str, user_id: str) -> None:
        room = self.rooms.get(room_id)
        if room is None:
            return
        room.participants = [p for p in room.participants if p.user_id != user_id]
        self.connections[room_id] = [
            c for c in self.connections.get(room_id, []) if c.user_id != user_id
        ]
        if not room.participants:
            self.delete_room(room_id)
        elif room.status in (RoomStatus.READY,):
            room.status = RoomStatus.WAITING

    # ── Spectator management ──────────────────────────────────────────────

    def add_spectator(
        self, room_id: str, user_id: str, user_name: str, ws: WebSocket
    ) -> Optional[str]:
        room = self.rooms.get(room_id)
        if room is None:
            return "Room not found"
        if room.status == RoomStatus.WAITING:
            return "Debate hasn't started yet – need two participants first"

        room.spectator_count += 1
        self.spectators.setdefault(room_id, []).append(
            _Connection(ws, user_id, user_name, ParticipantRole.SPECTATOR)
        )
        return None

    def remove_spectator(self, room_id: str, user_id: str) -> None:
        room = self.rooms.get(room_id)
        if room is None:
            return
        room.spectator_count = max(0, room.spectator_count - 1)
        self.spectators[room_id] = [
            c for c in self.spectators.get(room_id, []) if c.user_id != user_id
        ]

    # ── Transcript management ──────────────────────────────────────────────

    def add_transcript(self, room_id: str, speaker: str, text: str, is_final: bool) -> None:
        room = self.rooms.get(room_id)
        if room is None:
            return
        room.transcripts.append(
            TranscriptEntry(
                speaker=speaker,
                text=text,
                is_final=is_final,
                timestamp=datetime.utcnow().isoformat(),
            )
        )

    def get_transcripts(self, room_id: str) -> list[TranscriptEntry]:
        room = self.rooms.get(room_id)
        return room.transcripts if room else []

    # ── Broadcasting ───────────────────────────────────────────────────────

    async def broadcast_to_room(
        self, room_id: str, message: dict, exclude: Optional[str] = None
    ) -> None:
        """Send a message to all debaters in a room (optionally excluding one)."""
        for conn in self.connections.get(room_id, []):
            if exclude and conn.user_id == exclude:
                continue
            await conn.send_json(message)

    async def broadcast_to_spectators(self, room_id: str, message: dict) -> None:
        """Send a message to all spectators of a room."""
        for conn in self.spectators.get(room_id, []):
            await conn.send_json(message)

    async def broadcast_to_all(
        self, room_id: str, message: dict, exclude: Optional[str] = None
    ) -> None:
        """Send to both debaters and spectators."""
        await self.broadcast_to_room(room_id, message, exclude=exclude)
        await self.broadcast_to_spectators(room_id, message)

    async def relay_to_peer(self, room_id: str, from_user_id: str, message: dict) -> None:
        """Send a signaling message to the *other* debater in the room."""
        for conn in self.connections.get(room_id, []):
            if conn.user_id != from_user_id:
                await conn.send_json(message)
                return

    # ── Room state helpers ─────────────────────────────────────────────────

    def room_state_dict(self, room_id: str) -> dict:
        room = self.rooms.get(room_id)
        if room is None:
            return {}
        return {
            "room_id": room.room_id,
            "topic": room.topic,
            "category": room.category,
            "status": room.status.value,
            "participants": [
                {"user_id": p.user_id, "user_name": p.user_name, "role": p.role.value}
                for p in room.participants
            ],
            "spectator_count": room.spectator_count,
            "created_at": room.created_at,
        }


# Module-level singleton
room_manager = RoomManager()
