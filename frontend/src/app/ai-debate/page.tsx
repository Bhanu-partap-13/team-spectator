"use client";

import { useEffect, useRef, useState, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import { v4 as uuidv4 } from "uuid";
import ReactMarkdown from "react-markdown";

import type { AppDispatch, RootState } from "@/store/store";
import {
  setIdentity,
  setAIDebate,
  setAIConnected,
  setDebating,
  setMicActive,
  addTranscript,
  setAnalysis,
  resetDebate,
} from "@/store/slices/debateSlice";
import { WS_URL } from "@/lib/utils";
import { DeepgramTranscriber, captureMicPCM } from "@/lib/deepgram";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Mic, MicOff, PhoneOff, Bot, Play } from "lucide-react";

// ── Audio playback helper ──────────────────────────────────────────────────────

class PCMPlayer {
  private ctx: AudioContext;
  private nextTime = 0;
  private sampleRate: number;

  constructor(sampleRate = 24000) {
    this.ctx = new AudioContext({ sampleRate });
    this.sampleRate = sampleRate;
  }

  /** Queue raw PCM-16 (Int16) for playback and return the decoded Float32 buffer. */
  play(pcmBytes: ArrayBuffer): Float32Array {
    const int16 = new Int16Array(pcmBytes);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    const buffer = this.ctx.createBuffer(1, float32.length, this.sampleRate);
    buffer.copyToChannel(float32, 0);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);

    const currentTime = this.ctx.currentTime;
    if (this.nextTime < currentTime) {
      this.nextTime = currentTime;
    }
    source.start(this.nextTime);
    this.nextTime += buffer.duration;

    return float32;
  }

  close() {
    this.ctx.close();
  }
}

// ── Main component ─────────────────────────────────────────────────────────────

function AIDebateContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();

  const debate = useSelector((s: RootState) => s.debate);

  const topic = searchParams.get("topic") || "Open Debate";
  const category = searchParams.get("category") || "general";

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const dgUserRef = useRef<DeepgramTranscriber | null>(null);
  const dgAIRef = useRef<DeepgramTranscriber | null>(null);
  const micStopRef = useRef<(() => void) | null>(null);
  const playerRef = useRef<PCMPlayer | null>(null);
  const interimRef = useRef<string>("");

  const [started, setStarted] = useState(false);

  // ── Ensure identity ───────────────────────────────────────────────────

  useEffect(() => {
    if (debate.userId) return;
    const stored = localStorage.getItem("debate_user");
    if (stored) {
      const { userId, userName } = JSON.parse(stored);
      dispatch(setIdentity({ userId, userName }));
    } else {
      const userId = uuidv4();
      const userName = `Debater-${userId.slice(0, 4)}`;
      localStorage.setItem("debate_user", JSON.stringify({ userId, userName }));
      dispatch(setIdentity({ userId, userName }));
    }
    dispatch(setAIDebate(true));
  }, [debate.userId, dispatch]);

  // ── Start debate ──────────────────────────────────────────────────────

  const startDebate = useCallback(async () => {
    if (started) return;
    setStarted(true);

    const wsUrl = `${WS_URL}/api/ai-debate/ws`;
    console.log("[AI Debate] Opening WS to", wsUrl);

    // 1. Open WS to backend AI debate endpoint
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    playerRef.current = new PCMPlayer(24000);

    ws.onopen = () => {
      console.log("[AI Debate] WS connected — sending start message");
      dispatch(setAIConnected(true));
      const startMsg = {
        type: "start",
        data: {
          user_id: debate.userId,
          user_name: debate.userName,
          topic,
        },
      };
      console.log("[AI Debate] →", startMsg);
      ws.send(JSON.stringify(startMsg));
    };

    let audioChunksReceived = 0;

    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);

      switch (msg.type) {
        case "started":
          console.log("[AI Debate] ✓ Debate STARTED (backend confirmed)");
          dispatch(setDebating(true));
          break;

        case "audio": {
          audioChunksReceived++;
          if (audioChunksReceived % 50 === 1) {
            console.log(`[AI Debate] Audio chunk #${audioChunksReceived} received (${msg.data.audio.length} base64 chars)`);
          }
          const raw = atob(msg.data.audio);
          const bytes = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

          const float32 = playerRef.current?.play(bytes.buffer);

          if (float32 && dgAIRef.current) {
            const int16 = new Int16Array(float32.length);
            for (let i = 0; i < float32.length; i++) {
              const s = Math.max(-1, Math.min(1, float32[i]));
              int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
            dgAIRef.current.sendAudio(int16.buffer);
          }
          break;
        }

        case "ai_transcript":
          console.log("[AI Debate] AI transcript:", msg.data.text);
          dispatch(
            addTranscript({
              speaker: "AI Opponent",
              text: msg.data.text,
              is_final: true,
              timestamp: new Date().toISOString(),
            })
          );
          break;

        case "turn_complete":
          console.log("[AI Debate] Turn complete (total audio chunks:", audioChunksReceived, ")");
          break;

        case "ended":
          console.log("[AI Debate] Session ENDED");
          dispatch(setDebating(false));
          dispatch(setAIConnected(false));
          break;

        case "analysis":
          console.log("[AI Debate] Analysis received:", msg.data.result?.length, "chars");
          dispatch(setAnalysis(msg.data.result));
          break;

        case "error":
          console.error("[AI Debate] ✗ SERVER ERROR:", msg.data.message);
          break;

        default:
          console.warn("[AI Debate] Unknown message type:", msg.type, msg);
      }
    };

    ws.onclose = (ev) => {
      console.log("[AI Debate] WS closed  code=%d  reason=%s", ev.code, ev.reason);
      dispatch(setAIConnected(false));
    };

    ws.onerror = (ev) => {
      console.error("[AI Debate] ✗ WS error:", ev);
    };

    // 2. Start Deepgram for user transcript (display)
    console.log("[AI Debate] Starting Deepgram for user audio…");
    const dgUser = new DeepgramTranscriber((text, isFinal) => {
      if (isFinal && text.trim()) {
        const fullText = interimRef.current
          ? `${interimRef.current} ${text}`.trim()
          : text.trim();

        console.log("[AI Debate] User transcript (final):", fullText);

        dispatch(
          addTranscript({
            speaker: debate.userName || "You",
            text: fullText,
            is_final: true,
            timestamp: new Date().toISOString(),
          })
        );

        ws.send(
          JSON.stringify({
            type: "user_transcript",
            data: { text: fullText },
          })
        );

        interimRef.current = "";
      } else if (!isFinal) {
        interimRef.current = text;
      }
    });
    dgUser.connect();
    dgUserRef.current = dgUser;

    // 3. Second Deepgram for AI audio transcript (frontend display)
    console.log("[AI Debate] Starting Deepgram for AI audio…");
    const dgAI = new DeepgramTranscriber((text, isFinal) => {
      if (isFinal && text.trim()) {
        console.log("[AI Debate] AI transcript via DG:", text.trim());
        dispatch(
          addTranscript({
            speaker: "AI Opponent (DG)",
            text: text.trim(),
            is_final: true,
            timestamp: new Date().toISOString(),
          })
        );
      }
    });
    dgAI.connect();
    dgAIRef.current = dgAI;

    // 4. Capture mic → send PCM to both backend WS (binary) and Deepgram
    console.log("[AI Debate] Requesting microphone access…");
    try {
      const { stop } = await captureMicPCM((pcm) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(pcm);
        }
        dgUser.sendAudio(pcm);
      });
      micStopRef.current = stop;
      dispatch(setMicActive(true));
      console.log("[AI Debate] ✓ Mic capture active — streaming to backend + Deepgram");
    } catch (err) {
      console.error("[AI Debate] ✗ Mic capture failed:", err);
    }
  }, [started, debate.userId, debate.userName, topic, dispatch]);

  // ── End debate ────────────────────────────────────────────────────────

  function endDebate() {
    // Notify backend
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "end" }));
    }
    stopAll();
  }

  function stopAll() {
    micStopRef.current?.();
    micStopRef.current = null;
    dgUserRef.current?.close();
    dgUserRef.current = null;
    dgAIRef.current?.close();
    dgAIRef.current = null;
    playerRef.current?.close();
    playerRef.current = null;
    dispatch(setMicActive(false));
    dispatch(setDebating(false));
  }

  function toggleMic() {
    // We can't easily pause/resume the PCM capture, so toggle via track
    // This is a simplified toggle — in production use AudioWorklet
    dispatch(setMicActive(!debate.micActive));
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAll();
      wsRef.current?.close();
      dispatch(resetDebate());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <header className="space-y-1">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bot className="h-6 w-6" /> AI Debate
          </h1>
          <div className="flex items-center gap-2">
            {debate.isDebating && (
              <Badge className="bg-red-600 animate-pulse">LIVE</Badge>
            )}
            <Badge variant="outline">
              {debate.aiConnected ? "Connected" : "Disconnected"}
            </Badge>
          </div>
        </div>
        <p className="text-muted-foreground">{topic}</p>
        <Badge variant="secondary">{category}</Badge>
      </header>

      {/* Controls */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-3 items-center">
            {!started && (
              <Button onClick={startDebate}>
                <Play className="h-4 w-4 mr-1" /> Start Debate
              </Button>
            )}

            {debate.isDebating && (
              <>
                <Button
                  variant={debate.micActive ? "default" : "destructive"}
                  onClick={toggleMic}
                >
                  {debate.micActive ? (
                    <Mic className="h-4 w-4" />
                  ) : (
                    <MicOff className="h-4 w-4" />
                  )}
                </Button>
                <Button variant="destructive" onClick={endDebate}>
                  <PhoneOff className="h-4 w-4 mr-1" /> End Debate
                </Button>
              </>
            )}

            {!debate.isDebating && started && (
              <Button variant="outline" onClick={() => router.push("/")}>
                Back to Home
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Transcripts */}
      <Card className="flex-1">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Live Transcript</CardTitle>
          <CardDescription>
            Transcription by Deepgram Nova — AI audio + your speech
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-80">
            <div className="space-y-2 pr-4">
              {debate.transcripts.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {started
                    ? "Start speaking — the AI will respond"
                    : 'Click "Start Debate" to begin'}
                </p>
              )}
              {debate.transcripts.map((t, i) => (
                <div
                  key={i}
                  className={`p-2 rounded-lg text-sm ${
                    t.speaker.includes("AI")
                      ? "bg-secondary mr-8"
                      : "bg-primary/10 border border-primary/20 ml-8"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-semibold text-xs">{t.speaker}</span>
                    {t.timestamp && (
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(t.timestamp).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                  <p>{t.text}</p>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Analysis */}
      {debate.analysis && (
        <Card className="border-primary/50">
          <CardHeader>
            <CardTitle className="text-base">Debate Analysis</CardTitle>
            <CardDescription>
              Powered by Gemini — post-debate review
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-96">
              <div className="prose prose-invert prose-sm max-w-none">
                <ReactMarkdown>{debate.analysis}</ReactMarkdown>
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function AIDebatePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading...</div>}>
      <AIDebateContent />
    </Suspense>
  );
}
