"use client";

import { useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import { v4 as uuidv4 } from "uuid";
import ReactMarkdown from "react-markdown";

import type { AppDispatch, RootState } from "@/store/store";
import {
  setIdentity,
  setRoom,
  setDebating,
  addTranscript,
  setAnalysis,
  setWSConnected,
  updateRoomStatus,
  setSpectatorCount,
  resetDebate,
} from "@/store/slices/debateSlice";
import { WS_URL } from "@/lib/utils";

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
import { Eye, Users } from "lucide-react";

export default function SpectatePage() {
  const { roomId } = useParams<{ roomId: string }>();
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();
  const debate = useSelector((s: RootState) => s.debate);

  const wsRef = useRef<WebSocket | null>(null);

  // ── Ensure identity ───────────────────────────────────────────────────

  useEffect(() => {
    if (debate.userId) return;
    const stored = localStorage.getItem("debate_user");
    if (stored) {
      const { userId, userName } = JSON.parse(stored);
      dispatch(setIdentity({ userId, userName }));
    } else {
      const userId = uuidv4();
      const userName = `Spectator-${userId.slice(0, 4)}`;
      localStorage.setItem(
        "debate_user",
        JSON.stringify({ userId, userName })
      );
      dispatch(setIdentity({ userId, userName }));
    }
  }, [debate.userId, dispatch]);

  // ── WebSocket ─────────────────────────────────────────────────────────

  const handleWSMessage = useCallback(
    (evt: MessageEvent) => {
      const msg = JSON.parse(evt.data);

      switch (msg.type) {
        case "room_state": {
          const d = msg.data;
          dispatch(
            setRoom({
              roomId: d.room_id,
              topic: d.topic,
              category: d.category,
              status: d.status,
              participants: d.participants,
              spectatorCount: d.spectator_count,
            })
          );
          if (d.status === "debating") dispatch(setDebating(true));
          break;
        }

        case "transcript":
          dispatch(
            addTranscript({
              speaker: msg.data.speaker,
              text: msg.data.text,
              is_final: msg.data.is_final,
              timestamp: msg.data.timestamp,
            })
          );
          break;

        case "debate_started":
          dispatch(setDebating(true));
          dispatch(updateRoomStatus("debating"));
          break;

        case "debate_ended":
          dispatch(setDebating(false));
          dispatch(updateRoomStatus("finished"));
          break;

        case "analysis":
          dispatch(setAnalysis(msg.data.result));
          break;

        case "spectator_joined":
        case "spectator_left":
          dispatch(setSpectatorCount(msg.data.spectator_count));
          break;

        case "error":
          console.error("[Spectator WS] Error:", msg.data.message);
          break;
      }
    },
    [dispatch]
  );

  useEffect(() => {
    if (!debate.userId || !roomId) return;

    const ws = new WebSocket(`${WS_URL}/api/rooms/ws/spectate/${roomId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      dispatch(setWSConnected(true));
      ws.send(
        JSON.stringify({
          type: "join",
          data: { user_id: debate.userId, user_name: debate.userName },
        })
      );
    };

    ws.onmessage = handleWSMessage;

    ws.onclose = () => {
      dispatch(setWSConnected(false));
    };

    return () => {
      ws.close();
      dispatch(resetDebate());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debate.userId, roomId]);

  // Re-attach handler on change
  useEffect(() => {
    if (wsRef.current) wsRef.current.onmessage = handleWSMessage;
  }, [handleWSMessage]);

  // ── Derived state ─────────────────────────────────────────────────────

  const isLive = debate.roomStatus === "debating";
  const isFinished = debate.roomStatus === "finished";

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <header className="space-y-1">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Eye className="h-6 w-6" /> Spectating
          </h1>
          <div className="flex items-center gap-2">
            {isLive && (
              <Badge className="bg-red-600 animate-pulse">LIVE</Badge>
            )}
            <Badge variant="outline">
              {debate.roomStatus ?? "connecting"}
            </Badge>
          </div>
        </div>
        <p className="text-muted-foreground">{debate.topic || "Loading…"}</p>
      </header>

      {/* Participants */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" /> Debaters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 flex-wrap">
            {debate.participants.map((p) => (
              <div
                key={p.user_id}
                className="flex items-center gap-2 bg-secondary rounded-lg px-4 py-2"
              >
                <div className="w-2 h-2 rounded-full bg-blue-400" />
                <span className="text-sm font-medium">{p.user_name}</span>
              </div>
            ))}
          </div>
          {debate.spectatorCount > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              <Eye className="h-3 w-3 inline mr-1" />
              {debate.spectatorCount} spectator
              {debate.spectatorCount !== 1 && "s"} watching
            </p>
          )}
        </CardContent>
      </Card>

      {/* Transcripts */}
      <Card className="flex-1">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Live Transcript</CardTitle>
          <CardDescription>
            You are watching as a spectator — audio is not available
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-96">
            <div className="space-y-2 pr-4">
              {debate.transcripts.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {isLive
                    ? "Waiting for speech…"
                    : isFinished
                    ? "Debate has ended"
                    : "Waiting for the debate to start…"}
                </p>
              )}
              {debate.transcripts.map((t, i) => (
                <div
                  key={i}
                  className={`p-2 rounded-lg text-sm ${
                    i % 2 === 0 ? "bg-secondary mr-8" : "bg-primary/10 border border-primary/20 ml-8"
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

      {/* Back button */}
      <div className="text-center">
        <Button variant="outline" onClick={() => router.push("/")}>
          Back to Home
        </Button>
      </div>
    </div>
  );
}
