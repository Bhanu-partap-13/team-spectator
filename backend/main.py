from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from routers import topics, rooms, ai_debate

app = FastAPI(
    title="Debate Arena API",
    description="Real-time gamified debate platform with AI opponent support",
    version="1.0.0",
)

# CORS – allow the Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(topics.router, prefix="/api/topics", tags=["Topics"])
app.include_router(rooms.router, prefix="/api/rooms", tags=["Rooms"])
app.include_router(ai_debate.router, prefix="/api/ai-debate", tags=["AI Debate"])


@app.get("/")
async def health():
    return {"status": "ok", "service": "Debate Arena API"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=settings.HOST, port=settings.PORT, reload=True)
