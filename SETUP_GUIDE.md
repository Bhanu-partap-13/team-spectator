# Debate Arena — Complete Setup Guide

A real-time, gamified debate platform where users can debate each other (PvP) or challenge an AI opponent, with live transcription and post-debate analysis.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Environment Variables](#environment-variables)
4. [Backend Setup](#backend-setup)
5. [Frontend Setup](#frontend-setup)
6. [Running the Application](#running-the-application)
7. [Feature Walkthrough](#feature-walkthrough)
8. [Tech Stack Details](#tech-stack-details)
9. [API Reference](#api-reference)
10. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Next.js)                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │  Home /   │  │  Debate  │  │    AI    │  │  Spectator   │   │
│  │  Topics   │  │   Room   │  │  Debate  │  │    View      │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘   │
│       │              │              │              │             │
│       │         WebRTC (P2P)   WebSocket       WebSocket        │
│       │         + WebSocket    (binary+JSON)   (JSON)           │
│       │         + Deepgram     + Deepgram                       │
│       REST           │              │              │             │
└───────┼──────────────┼──────────────┼──────────────┼────────────┘
        │              │              │              │
        ▼              ▼              ▼              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      BACKEND (FastAPI)                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │ Topics   │  │  Room    │  │  Gemini  │  │  Gemini      │   │
│  │   API    │  │ Manager  │  │   Live   │  │  Analysis    │   │
│  │  (REST)  │  │  (WS)    │  │  (WS)    │  │  (REST)      │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘   │
│                      │              │              │             │
│                In-Memory     Gemini Live     Gemini Flash       │
│                  Store         API             API              │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow — PvP Debate

1. **Room Creation**: User A creates a room via REST → gets a `room_id`.
2. **Joining**: User B navigates to `/debate/{room_id}` and joins via WebSocket.
3. **WebRTC Setup**: Once both are in, the creator sends an SDP offer through the server to the peer. The peer responds with an answer. ICE candidates are exchanged.
4. **Audio**: Peer-to-peer WebRTC audio flows directly between the two browsers.
5. **Transcription**: Each browser captures its own mic audio, sends to Deepgram Nova (via browser WebSocket), receives transcript, and sends it to the backend WebSocket.
6. **Spectators**: Spectators connect via a separate WebSocket and receive transcripts in real time.
7. **Analysis**: When the debate ends, all transcripts are sent to `gemini-3-flash-preview` for analysis. The result is broadcast to everyone.

### Data Flow — AI Debate

1. **Session Start**: User opens `/ai-debate`, clicks Start. A WebSocket to the backend opens.
2. **Audio to Gemini**: The browser captures mic audio (PCM 16 kHz) and sends it as binary WebSocket frames to the backend. The backend forwards it to **Gemini Live** (`gemini-2.5-flash-native-audio-preview-12-2025`).
3. **AI Response**: Gemini responds with audio (PCM) and optional text. The backend base64-encodes the audio and sends it back. The frontend decodes and plays it.
4. **Frontend Transcription**: Two Deepgram Nova WebSocket connections run in the browser — one for the user's mic audio and one for the AI's output audio. Both transcripts are displayed.
5. **Backend Transcription**: Gemini Live also provides text internally; the backend logs these for analysis.
6. **Analysis**: On debate end, the backend sends all transcripts to Gemini for analysis.

---

## Prerequisites

| Tool            | Version  | Purpose                       |
|-----------------|----------|-------------------------------|
| **Python**      | ≥ 3.10   | Backend runtime               |
| **Node.js**     | ≥ 18     | Frontend runtime              |
| **npm**         | ≥ 9      | Frontend package manager      |
| **pip**         | latest   | Python package manager        |

### API Keys Required

| Service      | Key Name              | Where to Get It                                    |
|--------------|-----------------------|----------------------------------------------------|
| **Gemini**   | `GEMINI_API_KEY`      | [Google AI Studio](https://aistudio.google.com/)   |
| **Deepgram** | `DEEPGRAM_API_KEY`    | [Deepgram Console](https://console.deepgram.com/)  |

---

## Environment Variables

### Backend (`backend/.env`)

Create `backend/.env` from the example:

```bash
cp backend/.env.example backend/.env
```

Then fill in:

```env
GEMINI_API_KEY=your_gemini_api_key_here
DEEPGRAM_API_KEY=your_deepgram_api_key_here
FRONTEND_URL=http://localhost:3000
HOST=0.0.0.0
PORT=8000
```

### Frontend (`frontend/.env.local`)

Create `frontend/.env.local` from the example:

```bash
cp frontend/.env.local.example frontend/.env.local
```

Then fill in:

```env
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000
NEXT_PUBLIC_DEEPGRAM_API_KEY=your_deepgram_api_key_here
```

> **Security Note**: The Deepgram API key is exposed to the browser (via `NEXT_PUBLIC_` prefix). This is acceptable for development / demo but should be proxied through the backend in production.

---

## Backend Setup

```bash
cd backend

# Create a virtual environment
python -m venv venv

# Activate it
# Windows PowerShell:
.\venv\Scripts\Activate.ps1
# macOS / Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Create .env file (see Environment Variables section)
cp .env.example .env
# Edit .env and add your API keys
```

---

## Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Create .env.local (see Environment Variables section)
cp .env.local.example .env.local
# Edit .env.local and add your Deepgram key + backend URLs
```

---

## Running the Application

You need **two terminal windows** — one for backend, one for frontend.

### Terminal 1 — Backend

```bash
cd backend
# Activate venv first (see above)
python main.py
```

The backend starts on `http://localhost:8000`. You should see:

```
INFO:     Uvicorn running on http://0.0.0.0:8000
INFO:     Started reloader process
```

Verify it's working: open `http://localhost:8000/` in a browser — you should see `{"status":"ok","service":"Debate Arena API"}`.

### Terminal 2 — Frontend

```bash
cd frontend
npm run dev
```

The frontend starts on `http://localhost:3000`.

---

## Feature Walkthrough

### 1. Topic Selection (Home Page)

- **Topic of the Day**: A curated daily topic shown prominently.
- **Trending Topics**: Scrollable list of popular debate topics across categories (English, geopolitics, economics, history, technology, etc.).
- **Custom Topic**: Users can type any topic and optionally save it.
- **Category Filter**: Quick filter buttons for topic categories.

### 2. Person vs Person Debate

1. Enter your name on the home page.
2. Select or type a topic.
3. Click **"Create Debate Room"** → you're taken to `/debate/{roomId}`.
4. **Share the room code** (or full link) with your opponent.
5. Opponent enters the code on the home page → **"Join"**, or navigates to the link directly.
6. Once both are in:
   - WebRTC audio connection is established automatically.
   - A **Spectator Link** appears — share it with anyone who wants to watch.
7. One person clicks **"Request to Start"** → the other sees the request and clicks **"Accept"**.
8. Debate begins:
   - Audio flows peer-to-peer.
   - Deepgram transcribes each person's speech in real time.
   - Transcripts appear for both debaters and all spectators.
9. Either person can click **"End Debate"**.
10. Gemini analyzes the full transcript and produces a detailed scorecard.

### 3. AI Debate

1. Select a topic on the home page.
2. Click **"Start AI Debate"** → you're taken to `/ai-debate`.
3. Click **"Start Debate"**:
   - Your mic is captured.
   - Audio streams to the backend → Gemini Live.
   - Gemini responds with spoken audio that plays in your browser.
   - Deepgram transcribes both your speech and the AI's audio.
4. Click **"End Debate"** when done.
5. Gemini analyzes the debate and shows the scorecard.

### 4. Spectating

1. Get a room code from a debater (the spectator link becomes available once both debaters have joined).
2. Enter the code on the home page → **"Watch"**, or navigate to `/spectate/{roomId}`.
3. See:
   - Who's debating.
   - Real-time transcripts.
   - Post-debate analysis when it ends.
4. Spectators do **not** receive audio — they see transcripts only.

### 5. Topic Management

- **View trending**: `GET /api/topics/trending`
- **Topic of the Day**: `GET /api/topics/topic-of-day`
- **Add custom topic**: `POST /api/topics/` with `{"title": "...", "category": "...", "description": "..."}`
- **Update Topic of Day** (admin): `PUT /api/topics/topic-of-day` with `{"topic_id": "..."}`

---

## Tech Stack Details

### Frontend

| Library             | Purpose                                        |
|---------------------|------------------------------------------------|
| Next.js 15          | React framework with App Router                |
| TypeScript          | Type safety                                    |
| Redux Toolkit       | Global state management                        |
| shadcn/ui           | Accessible UI components (Radix + Tailwind)    |
| Tailwind CSS 3      | Utility-first styling                          |
| Zod                 | Runtime schema validation                      |
| Deepgram Nova 2     | Browser-side real-time speech-to-text          |
| WebRTC              | Peer-to-peer audio for PvP debates             |
| react-markdown      | Rendering Gemini analysis as rich markdown      |
| uuid                | Generating user IDs                            |

### Backend

| Library              | Purpose                                       |
|----------------------|-----------------------------------------------|
| FastAPI              | Async Python web framework                    |
| Uvicorn              | ASGI server with WebSocket support            |
| google-genai         | Gemini Live API + standard generation         |
| Pydantic             | Data validation and serialization             |
| python-dotenv        | Environment variable loading                  |

### External APIs

| API                  | Model Used                                      | Purpose                         |
|----------------------|-------------------------------------------------|---------------------------------|
| Gemini Live          | `gemini-2.5-flash-native-audio-preview-12-2025` | AI debate opponent (audio)      |
| Gemini Generation    | `gemini-3-flash-preview`                        | Post-debate analysis            |
| Deepgram Streaming   | `nova-2`                                        | Real-time speech transcription  |

---

## API Reference

### REST Endpoints

| Method | Path                       | Description                          |
|--------|----------------------------|--------------------------------------|
| GET    | `/`                        | Health check                         |
| GET    | `/api/topics/`             | List all topics (optional `?category=`) |
| GET    | `/api/topics/trending`     | Trending topics                      |
| GET    | `/api/topics/topic-of-day` | Current topic of the day             |
| PUT    | `/api/topics/topic-of-day` | Set topic of the day                 |
| POST   | `/api/topics/`             | Create a custom topic                |
| GET    | `/api/topics/categories`   | List all categories                  |
| POST   | `/api/rooms/`              | Create a debate room                 |
| GET    | `/api/rooms/{room_id}`     | Get room state                       |
| GET    | `/api/rooms/`              | List active rooms                    |

### WebSocket Endpoints

| Path                                   | Purpose                    |
|----------------------------------------|----------------------------|
| `ws://.../api/rooms/ws/{room_id}`      | Debater connection         |
| `ws://.../api/rooms/ws/spectate/{room_id}` | Spectator connection   |
| `ws://.../api/ai-debate/ws`            | AI debate session          |

### WebSocket Protocol — Debater

**Client → Server:**

```jsonc
{"type": "join", "data": {"user_id": "...", "user_name": "..."}}
{"type": "offer", "data": {"sdp": "...", "type": "offer"}}
{"type": "answer", "data": {"sdp": "...", "type": "answer"}}
{"type": "ice_candidate", "data": {"candidate": {...}}}
{"type": "request_start"}
{"type": "accept_start"}
{"type": "reject_start"}
{"type": "transcript", "data": {"text": "...", "speaker": "...", "is_final": true}}
{"type": "end_debate"}
```

**Server → Client:**

```jsonc
{"type": "room_state", "data": {...}}
{"type": "user_joined", "data": {"user_id": "...", "user_name": "..."}}
{"type": "user_left", "data": {"user_id": "...", "user_name": "..."}}
{"type": "offer", "data": {"sdp": "...", "type": "offer", "from": "..."}}
{"type": "answer", "data": {"sdp": "...", "type": "answer", "from": "..."}}
{"type": "ice_candidate", "data": {"candidate": {...}, "from": "..."}}
{"type": "start_requested", "data": {"by": "..."}}
{"type": "start_rejected", "data": {"by": "..."}}
{"type": "debate_started"}
{"type": "debate_ended"}
{"type": "spectator_link", "data": {"link": "/spectate/{room_id}"}}
{"type": "transcript", "data": {"text": "...", "speaker": "...", "is_final": true, "timestamp": "..."}}
{"type": "analysis", "data": {"result": "..."}}
{"type": "error", "data": {"message": "..."}}
```

### WebSocket Protocol — AI Debate

**Client → Server (text frames):**

```jsonc
{"type": "start", "data": {"user_id": "...", "user_name": "...", "topic": "..."}}
{"type": "user_transcript", "data": {"text": "..."}}
{"type": "end"}
```

**Client → Server (binary frames):** Raw PCM-16 audio at 16 kHz.

**Server → Client:**

```jsonc
{"type": "started"}
{"type": "audio", "data": {"audio": "<base64 PCM>"}}
{"type": "ai_transcript", "data": {"speaker": "ai", "text": "..."}}
{"type": "turn_complete"}
{"type": "ended"}
{"type": "analysis", "data": {"result": "..."}}
{"type": "error", "data": {"message": "..."}}
```

---

## Troubleshooting

### "Room not found" when joining

The room only exists in memory. Make sure the backend is running and hasn't been restarted since the room was created.

### No audio between debaters

- Make sure both browsers have granted microphone permission.
- If behind a restrictive NAT/firewall, you may need a TURN server. The default config only uses Google's public STUN servers.
- Check the browser console for WebRTC errors.

### Deepgram transcript not showing

- Verify `NEXT_PUBLIC_DEEPGRAM_API_KEY` is set in `frontend/.env.local`.
- Check the browser console for Deepgram WebSocket errors.
- Ensure your Deepgram plan supports streaming.

### Gemini AI debate not responding

- Verify `GEMINI_API_KEY` is set in `backend/.env`.
- Ensure you have access to the `gemini-2.5-flash-native-audio-preview-12-2025` model (may require allowlisting).
- **Check the backend terminal** — detailed logs now print at every step:
  - `[gemini_live] Connecting to Gemini Live…` — if you don't see this, the WS message isn't reaching the handler.
  - `[gemini_live] FAILED to connect to Gemini Live:` — the full traceback will be printed.
  - `[ai_debate] session.connect FAILED:` — the error is also sent to the browser.
- **Check the browser console** — every step now logs:
  - `[AI Debate] WS connected — sending start message`
  - `[AI Debate] ✓ Debate STARTED (backend confirmed)`
  - `[AI Debate] ✗ SERVER ERROR:` — if Gemini returned an error, you'll see the full traceback here.

### Analysis not generating

- The analysis model is `gemini-3-flash-preview`. Ensure your API key has access.
- **Check the backend terminal** for:
  - `[gemini_analysis] Starting debate analysis:` — confirms the request was made.
  - `[gemini_analysis] Gemini analysis FAILED:` — the full traceback will appear.
  - `[gemini_analysis] Analysis complete — N chars returned` — success.
- If the model name is wrong, change `GEMINI_ANALYSIS_MODEL` in `backend/config.py`.

### CORS errors

- The backend allows `http://localhost:3000` by default. If your frontend runs on a different port, update `FRONTEND_URL` in the backend `.env`.

---

## Project Structure

```
lastride/
├── backend/
│   ├── main.py                  # FastAPI app entry point
│   ├── config.py                # Settings & env vars
│   ├── requirements.txt         # Python dependencies
│   ├── .env.example             # Env template
│   ├── data/
│   │   └── topics.json          # Seed topics
│   ├── models/
│   │   └── schemas.py           # Pydantic models
│   ├── services/
│   │   ├── room_manager.py      # In-memory room state
│   │   ├── gemini_live.py       # Gemini Live API wrapper
│   │   └── gemini_analysis.py   # Post-debate analysis
│   └── routers/
│       ├── topics.py            # Topics REST API
│       ├── rooms.py             # Rooms REST + WebSocket
│       └── ai_debate.py         # AI Debate WebSocket
├── frontend/
│   ├── package.json
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   ├── .env.local.example
│   └── src/
│       ├── app/
│       │   ├── layout.tsx       # Root layout with Redux provider
│       │   ├── page.tsx         # Home — topic selection
│       │   ├── globals.css      # Dark theme + Tailwind
│       │   ├── debate/
│       │   │   └── [roomId]/
│       │   │       └── page.tsx # PvP debate room
│       │   ├── ai-debate/
│       │   │   └── page.tsx     # AI debate
│       │   └── spectate/
│       │       └── [roomId]/
│       │           └── page.tsx # Spectator view
│       ├── components/ui/       # shadcn components
│       ├── store/
│       │   ├── store.ts         # Redux store config
│       │   ├── provider.tsx     # Client-side provider
│       │   └── slices/
│       │       ├── debateSlice.ts
│       │       └── topicSlice.ts
│       ├── lib/
│       │   ├── utils.ts         # cn(), API_URL, WS_URL
│       │   └── deepgram.ts      # Deepgram WebSocket + mic capture
│       └── types/
│           └── index.ts         # Zod schemas + TS types
└── SETUP_GUIDE.md               # This file
```

---

## Notes on Design Decisions

### Why peer-to-peer WebRTC instead of mediasoup SFU?

For a 2-person debate, direct peer-to-peer WebRTC is simpler, has lower latency, and requires no media server. The backend only handles signaling (offer/answer/ICE relay via WebSocket). Spectators receive transcripts rather than audio streams, keeping the architecture lightweight. If audio streaming to spectators is needed in the future, a media server (mediasoup, Janus, etc.) can be added.

### Why Deepgram on the frontend?

Each debater transcribes their own audio locally using Deepgram, then sends the text to the server. This avoids routing all audio through the server and keeps latency low. For the AI debate, two Deepgram connections handle user and AI audio separately.

### Why no database?

This is an MVP. All state (rooms, participants, transcripts) lives in Python dictionaries. Restarting the backend clears everything. Users are identified by UUID generated on the frontend and stored in `localStorage`. For production, add PostgreSQL or Redis.

---

## Debugging

The application has comprehensive logging on both frontend and backend. Here's how to use it.

### Backend Logs

All backend logs are printed to **stdout** (the terminal where `python main.py` runs). The format is:

```
HH:MM:SS  LEVEL     [logger]  message
```

**Logger names and what they cover:**

| Logger            | What it logs                                                                 |
|-------------------|-----------------------------------------------------------------------------|
| `config`          | Startup: API key presence, model names                                      |
| `gemini_live`     | Gemini Live connect/disconnect, audio chunks sent/received, transcripts, errors |
| `gemini_analysis` | Analysis request, model call, success/failure with traceback                |
| `ai_debate`       | AI debate WS lifecycle: connect, start, audio frames, end, errors           |
| `rooms`           | Room creation, join/leave, WebRTC signaling, debate flow, analysis trigger  |

**Key messages to look for:**

```
# Startup — are keys loaded?
INFO  [config]  GEMINI_API_KEY   = AIzaSyDF…
INFO  [config]  GEMINI_LIVE_MODEL    = gemini-2.5-flash-native-audio-preview-12-2025

# AI debate connection
INFO  [ai_debate]  AI debate WebSocket ACCEPTED
INFO  [ai_debate]  START debate:  topic='...'
INFO  [gemini_live] Connecting to Gemini Live…
INFO  [gemini_live] Gemini Live session CONNECTED successfully   ← good
ERROR [gemini_live] FAILED to connect to Gemini Live:            ← bad, check traceback

# Audio flowing
DEBUG [ai_debate]  Audio frame #1  (8192 bytes) → Gemini
DEBUG [gemini_live] Gemini audio chunk #1  (4200 bytes)

# Analysis
INFO  [gemini_analysis] Starting debate analysis…
INFO  [gemini_analysis] Calling Gemini generate_content  model=gemini-3-flash-preview
ERROR [gemini_analysis] Gemini analysis FAILED:                  ← check traceback
```

### Frontend Logs

Open the browser DevTools Console (F12 → Console tab). All messages are prefixed:

| Prefix             | Component                   |
|--------------------|-----------------------------|
| `[Deepgram]`       | Deepgram WebSocket connection, transcripts |
| `[AI Debate]`      | AI debate WS, audio chunks, mic capture   |
| `[Room WS]` / `[Room]` | PvP debate room WS, WebRTC signaling  |

**Key messages:**

```
[Deepgram] ✓ Connected successfully              ← Deepgram working
[Deepgram] ✗ WebSocket error:                     ← check API key
[AI Debate] WS connected — sending start message
[AI Debate] ✓ Debate STARTED (backend confirmed)  ← Gemini connected
[AI Debate] ✗ SERVER ERROR: ...                   ← Gemini failed, read error
[AI Debate] Audio chunk #1 received               ← AI is responding
[Room WS] room_state: status=ready participants=2
[Room WS] ✓ DEBATE STARTED — starting Deepgram
```

### Common Errors and Fixes

| Error in logs | Cause | Fix |
|---|---|---|
| `GEMINI_API_KEY = *** MISSING ***` | No key in `.env` | Add your key to `backend/.env` |
| `FAILED to connect to Gemini Live: 403` | API key doesn't have access to the Live model | Check Google AI Studio for model access |
| `FAILED to connect to Gemini Live: 404` | Model name doesn't exist | Update `GEMINI_LIVE_MODEL` in `config.py` |
| `Gemini analysis FAILED: 404` | Analysis model doesn't exist | Update `GEMINI_ANALYSIS_MODEL` in `config.py` |
| `[Deepgram] *** NO API KEY ***` | Frontend env missing | Create `frontend/.env` with `NEXT_PUBLIC_DEEPGRAM_API_KEY=...` |
| `[Deepgram] Disconnected code=1008` | Invalid API key | Check your Deepgram key is valid |
| `[AI Debate] ✗ WS error` | Backend not running or wrong port | Verify backend is on `:8000` and `NEXT_PUBLIC_WS_URL` matches |
