from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# ── Enums ──────────────────────────────────────────────────────────────────────


class RoomStatus(str, Enum):
    WAITING = "waiting"          # Only creator has joined
    READY = "ready"              # Both participants joined
    DEBATING = "debating"        # Debate is live
    FINISHED = "finished"        # Debate ended


class ParticipantRole(str, Enum):
    DEBATER = "debater"
    SPECTATOR = "spectator"


# ── Topic Models ───────────────────────────────────────────────────────────────


class Topic(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    category: str
    description: str = ""
    is_topic_of_day: bool = False
    is_trending: bool = False
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class TopicCreate(BaseModel):
    title: str
    category: str
    description: str = ""


class TopicOfDayUpdate(BaseModel):
    topic_id: str


# ── Room / Participant Models ──────────────────────────────────────────────────


class Participant(BaseModel):
    user_id: str
    user_name: str
    role: ParticipantRole = ParticipantRole.DEBATER
    joined_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class TranscriptEntry(BaseModel):
    speaker: str
    text: str
    is_final: bool = False
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class Room(BaseModel):
    room_id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    topic: str = ""
    category: str = ""
    status: RoomStatus = RoomStatus.WAITING
    created_by: str = ""
    participants: list[Participant] = Field(default_factory=list)
    spectator_count: int = 0
    transcripts: list[TranscriptEntry] = Field(default_factory=list)
    start_requester: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class RoomCreate(BaseModel):
    topic: str
    category: str = "general"
    user_id: str
    user_name: str


class RoomJoin(BaseModel):
    user_id: str
    user_name: str


class RoomResponse(BaseModel):
    room_id: str
    topic: str
    category: str
    status: RoomStatus
    participants: list[Participant]
    spectator_count: int
    created_at: str


# ── AI Debate Models ──────────────────────────────────────────────────────────


class AIDebateStart(BaseModel):
    user_id: str
    user_name: str
    topic: str
    category: str = "general"


# ── Analysis Models ────────────────────────────────────────────────────────────


class AnalysisRequest(BaseModel):
    transcripts: list[TranscriptEntry]
    topic: str


class AnalysisResponse(BaseModel):
    analysis: str
    topic: str
    generated_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
