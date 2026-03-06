"""
REST endpoints for browsing, creating, and managing debate topics.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException

from models.schemas import Topic, TopicCreate, TopicOfDayUpdate

router = APIRouter()

# ── In-memory topic store (seeded from data/topics.json) ──────────────────────

DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "topics.json"

_topics: list[Topic] = []
_topic_of_day: Optional[Topic] = None
_categories: list[str] = []


def _load_seed_data() -> None:
    global _topic_of_day, _categories
    if not DATA_FILE.exists():
        return
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    tod = data.get("topic_of_day")
    if tod:
        _topic_of_day = Topic(**tod)
        _topics.append(_topic_of_day)

    for item in data.get("trending", []):
        t = Topic(**item)
        _topics.append(t)

    _categories.extend(data.get("categories", []))


_load_seed_data()


# ── Endpoints ──────────────────────────────────────────────────────────────────


@router.get("/")
async def list_topics(category: Optional[str] = None):
    """Return all topics, optionally filtered by category."""
    if category:
        return [t for t in _topics if t.category == category]
    return _topics


@router.get("/trending")
async def trending_topics():
    """Return topics marked as trending."""
    return [t for t in _topics if t.is_trending]


@router.get("/topic-of-day")
async def get_topic_of_day():
    """Return the current Topic of the Day."""
    if _topic_of_day is None:
        raise HTTPException(status_code=404, detail="No topic of the day set")
    return _topic_of_day


@router.put("/topic-of-day")
async def set_topic_of_day(body: TopicOfDayUpdate):
    """Admin: set a specific topic as Topic of the Day."""
    global _topic_of_day
    for t in _topics:
        t.is_topic_of_day = False
        if t.id == body.topic_id:
            t.is_topic_of_day = True
            _topic_of_day = t
    if _topic_of_day is None or _topic_of_day.id != body.topic_id:
        raise HTTPException(status_code=404, detail="Topic not found")
    return _topic_of_day


@router.post("/", status_code=201)
async def create_topic(body: TopicCreate):
    """Let a user add their own debate topic."""
    topic = Topic(title=body.title, category=body.category, description=body.description)
    _topics.append(topic)
    return topic


@router.get("/categories")
async def list_categories():
    """Return all available categories."""
    return _categories
