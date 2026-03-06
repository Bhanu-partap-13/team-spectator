"""
Post-debate analysis powered by Gemini.

Takes a full transcript and produces a structured analysis covering
factual accuracy, rhetoric, logical reasoning, and an overall verdict.
"""

from __future__ import annotations

import logging
import traceback

from google import genai

from config import settings

log = logging.getLogger("gemini_analysis")

ANALYSIS_PROMPT = """You are an expert debate judge and analyst.  You have just reviewed the full transcript of a debate.

**Topic:** {topic}

**Transcript:**
{transcript}

Produce a detailed, fair, and insightful analysis covering **all** of the following sections.  Use markdown formatting.

## 1. Debate Overview
Summarise the debate in 3-4 sentences — what was discussed, the overall tone, and flow.

## 2. Key Arguments
For **each** participant, list their strongest arguments with brief commentary.

## 3. Factual Accuracy
Identify any claims that are factually correct, dubious, or outright wrong.  Cite specifics.

## 4. Logical Reasoning
Highlight strong logical chains and point out any logical fallacies (name the fallacy).

## 5. Rhetorical Effectiveness
Rate each participant's persuasiveness, use of evidence, and engagement style.

## 6. Scores (out of 10)
| Criterion              | {p1} | {p2} |
|------------------------|------|------|
| Factual Accuracy       |      |      |
| Logical Reasoning      |      |      |
| Rhetorical Skill       |      |      |
| Rebuttal Effectiveness |      |      |
| Overall                |      |      |

## 7. Verdict
Declare a winner (or draw) with justification.

## 8. Improvement Tips
Give 2-3 actionable tips for each participant to improve in future debates.
"""


async def analyze_debate(
    transcripts: list[dict],
    topic: str,
    participant_names: tuple[str, str] = ("Participant 1", "Participant 2"),
) -> str:
    """
    Send the complete transcript to Gemini for analysis.
    Returns the markdown-formatted analysis string.
    """
    log.info(
        "Starting debate analysis:  topic=%r  transcripts=%d  model=%s  participants=%s",
        topic, len(transcripts), settings.GEMINI_ANALYSIS_MODEL, participant_names,
    )

    if not settings.GEMINI_API_KEY:
        msg = "GEMINI_API_KEY is not set — cannot run analysis"
        log.error(msg)
        return msg

    client = genai.Client(api_key=settings.GEMINI_API_KEY)

    # Build readable transcript
    lines: list[str] = []
    for t in transcripts:
        speaker = t.get("speaker", "Unknown")
        text = t.get("text", "")
        ts = t.get("timestamp", "")
        if text.strip():
            lines.append(f"[{speaker}] ({ts}): {text}")

    transcript_text = "\n".join(lines) if lines else "(No transcript available)"
    log.debug("Transcript text length = %d chars", len(transcript_text))

    prompt = ANALYSIS_PROMPT.format(
        topic=topic,
        transcript=transcript_text,
        p1=participant_names[0],
        p2=participant_names[1],
    )

    try:
        log.info("Calling Gemini generate_content  model=%s …", settings.GEMINI_ANALYSIS_MODEL)
        response = await client.aio.models.generate_content(
            model=settings.GEMINI_ANALYSIS_MODEL,
            contents=prompt,
        )
        result = response.text or "Analysis could not be generated (empty response)."
        log.info("Analysis complete — %d chars returned", len(result))
        return result
    except Exception as exc:
        log.error("Gemini analysis FAILED:\n%s", traceback.format_exc())
        return f"Analysis failed: {exc}"
