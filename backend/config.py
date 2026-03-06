import logging
import os
import sys

from dotenv import load_dotenv

load_dotenv()

# ── Logging setup ──────────────────────────────────────────────────────────────
# Force all our loggers to DEBUG so every message is visible in the terminal.

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s  %(levelname)-8s  [%(name)s]  %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)

# Silence noisy third-party loggers
for _quiet in ("httpcore", "httpx", "hpack", "urllib3", "watchfiles"):
    logging.getLogger(_quiet).setLevel(logging.WARNING)


class Settings:
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    DEEPGRAM_API_KEY: str = os.getenv("DEEPGRAM_API_KEY", "")
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:3000")
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))

    # Gemini model names
    GEMINI_LIVE_MODEL: str = "gemini-2.5-flash-native-audio-preview-12-2025"
    GEMINI_ANALYSIS_MODEL: str = "gemini-3-flash-preview"


settings = Settings()

# Startup sanity check – print to terminal so it's immediately obvious
_log = logging.getLogger("config")
_log.info("GEMINI_API_KEY   = %s", f"{settings.GEMINI_API_KEY[:8]}…" if settings.GEMINI_API_KEY else "*** MISSING ***")
_log.info("DEEPGRAM_API_KEY = %s", f"{settings.DEEPGRAM_API_KEY[:8]}…" if settings.DEEPGRAM_API_KEY else "*** MISSING ***")
_log.info("GEMINI_LIVE_MODEL    = %s", settings.GEMINI_LIVE_MODEL)
_log.info("GEMINI_ANALYSIS_MODEL = %s", settings.GEMINI_ANALYSIS_MODEL)
