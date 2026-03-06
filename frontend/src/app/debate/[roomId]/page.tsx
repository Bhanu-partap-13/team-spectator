"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import { v4 as uuidv4 } from "uuid";
import ReactMarkdown from "react-markdown";

import type { AppDispatch, RootState } from "@/store/store";
import {
  setIdentity,
  setRoom,
  updateRoomStatus,
  addParticipant,
  removeParticipant,
  setSpectatorLink,
  setSpectatorCount,
  setDebating,
  setStartRequested,
  addTranscript,
  setAnalysis,
  setWSConnected,
  setRTCConnected,
  setMicActive,
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
import {
  Mic,
  MicOff,
  PhoneOff,
  Play,
  Check,
  X,
  Copy,
  Eye,
  Users,
} from "lucide-react";

// ── WebRTC config ──────────────────────────────────────────────────────────────

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export default function DebateRoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();

  const debate = useSelector((s: RootState) => s.debate);

  // Refs for mutable resources
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const dgRef = useRef<DeepgramTranscriber | null>(null);
  const micStopRef = useRef<(() => void) | null>(null);
  const interimRef = useRef<string>("");

  // Is this the first participant (the room creator)?
  const [isCreator, setIsCreator] = useState(false);
  const [copied, setCopied] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // ── Ensure identity ─────────────────────────────────────────────────────

  useEffect(() => {
    if (debate.userId) return;
    const stored = localStorage.getItem("debate_user");
    if (stored) {
      const { userId, userName } = JSON.parse(stored);
      dispatch(setIdentity({ userId, userName }));
    } else {
      const userId = uuidv4();
      const userName = `Debater-${userId.slice(0, 4)}`;
      localStorage.setItem(
        "debate_user",
        JSON.stringify({ userId, userName })
      );
      dispatch(setIdentity({ userId, userName }));
    }
  }, [debate.userId, dispatch]);

  // ── WebSocket connection ────────────────────────────────────────────────

  const handleWSMessage = useCallback(
    (evt: MessageEvent) => {
      const msg = JSON.parse(evt.data);
      console.log("[Room WS] ←", msg.type, msg.type === "transcript" ? msg.data?.text?.slice(0, 60) : "");
      switch (msg.type) {
        case "room_state": {
          const d = msg.data;
          console.log("[Room WS] room_state: status=%s  participants=%d", d.status, d.participants.length);
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
          if (
            d.participants.length === 1 &&
            d.participants[0].user_id === debate.userId
          ) {
            setIsCreator(true);
          }
          break;
        }
        case "user_joined":
          console.log("[Room WS] User joined:", msg.data.user_name);
          dispatch(
            addParticipant({
              user_id: msg.data.user_id,
              user_name: msg.data.user_name,
              role: "debater",
            })
          );
          if (isCreator) {
            console.log("[Room WS] I'm creator — initiating WebRTC offer");
            createOffer();
          }
          break;

        case "user_left":
          console.log("[Room WS] User left:", msg.data.user_name);
          dispatch(removeParticipant(msg.data.user_id));
          break;

        case "spectator_link":
          console.log("[Room WS] Spectator link:", msg.data.link);
          dispatch(setSpectatorLink(msg.data.link));
          break;

        case "spectator_joined":
        case "spectator_left":
          dispatch(setSpectatorCount(msg.data.spectator_count));
          break;

        case "start_requested":
          console.log("[Room WS] Start requested by:", msg.data.by);
          dispatch(
            setStartRequested({ requested: true, by: msg.data.by })
          );
          break;

        case "start_rejected":
          console.log("[Room WS] Start rejected");
          dispatch(setStartRequested({ requested: false, by: null }));
          break;

        case "debate_started":
          console.log("[Room WS] ✓ DEBATE STARTED — starting Deepgram");
          dispatch(setDebating(true));
          dispatch(updateRoomStatus("debating"));
          startDeepgram();
          break;

        case "debate_ended":
          console.log("[Room WS] DEBATE ENDED");
          dispatch(setDebating(false));
          dispatch(updateRoomStatus("finished"));
          stopDeepgram();
          break;

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

        case "analysis":
          console.log("[Room WS] Analysis received:", msg.data.result?.length, "chars");
          dispatch(setAnalysis(msg.data.result));
          break;

        // WebRTC signaling
        case "offer":
          console.log("[Room WS] Received WebRTC offer from", msg.data.from);
          handleRemoteOffer(msg.data);
          break;
        case "answer":
          console.log("[Room WS] Received WebRTC answer from", msg.data.from);
          handleRemoteAnswer(msg.data);
          break;
        case "ice_candidate":
          handleRemoteICE(msg.data);
          break;

        case "error":
          console.error("[Room WS] ✗ SERVER ERROR:", msg.data.message);
          setServerError(msg.data.message);
          break;

        default:
          console.warn("[Room WS] Unknown message type:", msg.type, msg);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dispatch, debate.userId, isCreator]
  );

  useEffect(() => {
    if (!debate.userId || !roomId) return;

    const wsUrl = `${WS_URL}/api/rooms/ws/${roomId}`;
    console.log("[Room] Opening WS to", wsUrl, "as", debate.userName);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[Room] WS connected — sending join");
      dispatch(setWSConnected(true));
      ws.send(
        JSON.stringify({
          type: "join",
          data: { user_id: debate.userId, user_name: debate.userName },
        })
      );
    };

    ws.onmessage = handleWSMessage;

    ws.onclose = (ev) => {
      console.log("[Room] WS closed  code=%d  reason=%s", ev.code, ev.reason);
      dispatch(setWSConnected(false));
      // Code 1008 = backend rejected the connection (e.g. room not found / full)
      // Only set error here if onmessage hasn't already set one
      if (ev.code === 1008) {
        setServerError((prev) =>
          prev ?? "Room not found or rejected. The room may no longer exist — please go back and create a new one."
        );
      }
    };

    ws.onerror = (ev) => {
      // Browser WebSocket ErrorEvent never exposes details — log what we can
      const target = ev.target as WebSocket | null;
      const state = target?.readyState;
      console.error(
        "[Room] ✗ WS error — url:",
        target?.url ?? wsUrl,
        "readyState:",
        state
      );
      dispatch(setWSConnected(false));
      // readyState 3 = CLOSED — connection was refused or immediately closed
      if (state === WebSocket.CLOSED) {
        setServerError((prev) =>
          prev ?? "Could not connect to the room. The backend may be down or the room no longer exists."
        );
      }
    };

    return () => {
      ws.close();
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debate.userId, roomId]);

  // Re-attach the message handler when deps change
  useEffect(() => {
    if (wsRef.current) {
      wsRef.current.onmessage = handleWSMessage;
    }
  }, [handleWSMessage]);

  // ── WebRTC helpers ──────────────────────────────────────────────────────

  async function getLocalStream(): Promise<MediaStream> {
    if (localStreamRef.current) return localStreamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    localStreamRef.current = stream;
    return stream;
  }

  function createPeerConnection(): RTCPeerConnection {
    if (pcRef.current) return pcRef.current;
    const pc = new RTCPeerConnection(RTC_CONFIG);

    pc.onicecandidate = (e) => {
      if (e.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "ice_candidate",
            data: { candidate: e.candidate.toJSON() },
          })
        );
      }
    };

    pc.ontrack = (e) => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = e.streams[0];
      }
    };

    pc.onconnectionstatechange = () => {
      dispatch(
        setRTCConnected(
          pc.connectionState === "connected"
        )
      );
    };

    pcRef.current = pc;
    return pc;
  }

  async function createOffer() {
    const stream = await getLocalStream();
    const pc = createPeerConnection();
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    wsRef.current?.send(
      JSON.stringify({ type: "offer", data: { sdp: offer.sdp, type: offer.type } })
    );
  }

  async function handleRemoteOffer(data: { sdp: string; type: string; from: string }) {
    const stream = await getLocalStream();
    const pc = createPeerConnection();
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    await pc.setRemoteDescription(new RTCSessionDescription({ sdp: data.sdp, type: data.type as RTCSdpType }));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    wsRef.current?.send(
      JSON.stringify({ type: "answer", data: { sdp: answer.sdp, type: answer.type } })
    );
  }

  async function handleRemoteAnswer(data: { sdp: string; type: string }) {
    await pcRef.current?.setRemoteDescription(
      new RTCSessionDescription({ sdp: data.sdp, type: data.type as RTCSdpType })
    );
  }

  async function handleRemoteICE(data: { candidate: RTCIceCandidateInit }) {
    try {
      await pcRef.current?.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (e) {
      console.warn("ICE candidate error:", e);
    }
  }

  // ── Deepgram transcription ──────────────────────────────────────────────

  function startDeepgram() {
    if (dgRef.current) return;

    const dg = new DeepgramTranscriber((text, isFinal, speechFinal) => {
      if (isFinal && text.trim()) {
        const fullText = interimRef.current
          ? `${interimRef.current} ${text}`.trim()
          : text.trim();

        // Send final transcript to server
        wsRef.current?.send(
          JSON.stringify({
            type: "transcript",
            data: {
              text: fullText,
              speaker: debate.userName,
              is_final: true,
            },
          })
        );

        // Also add locally
        dispatch(
          addTranscript({
            speaker: debate.userName,
            text: fullText,
            is_final: true,
            timestamp: new Date().toISOString(),
          })
        );

        interimRef.current = "";
      } else if (!isFinal) {
        interimRef.current = text;
      }
    });
    dg.connect();
    dgRef.current = dg;

    // Capture mic PCM and feed to Deepgram
    captureMicPCM((pcm) => {
      dg.sendAudio(pcm);
    }).then(({ stop }) => {
      micStopRef.current = stop;
      dispatch(setMicActive(true));
    });
  }

  function stopDeepgram() {
    dgRef.current?.close();
    dgRef.current = null;
    micStopRef.current?.();
    micStopRef.current = null;
    dispatch(setMicActive(false));
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────

  function cleanup() {
    stopDeepgram();
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    dispatch(resetDebate());
  }

  // ── Actions ─────────────────────────────────────────────────────────────

  function requestStart() {
    wsRef.current?.send(JSON.stringify({ type: "request_start" }));
    dispatch(setStartRequested({ requested: true, by: debate.userName }));
  }

  function acceptStart() {
    wsRef.current?.send(JSON.stringify({ type: "accept_start" }));
  }

  function rejectStart() {
    wsRef.current?.send(JSON.stringify({ type: "reject_start" }));
    dispatch(setStartRequested({ requested: false, by: null }));
  }

  function endDebate() {
    wsRef.current?.send(JSON.stringify({ type: "end_debate" }));
  }

  function toggleMic() {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getAudioTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        dispatch(setMicActive(track.enabled));
      }
    }
  }

  function copyLink(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ── Derived state ───────────────────────────────────────────────────────

  const isWaiting = debate.roomStatus === "waiting";
  const isReady = debate.roomStatus === "ready";
  const isLive = debate.roomStatus === "debating";
  const isFinished = debate.roomStatus === "finished";
  const otherParticipant = debate.participants.find(
    (p) => p.user_id !== debate.userId
  );
  const incomingRequest =
    debate.startRequested && debate.startRequestedBy !== debate.userName;

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      {/* Hidden audio element for remote stream */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* Server error banner */}
      {serverError && (
        <div className="rounded-md border border-red-500 bg-red-50 p-4 text-red-700 dark:bg-red-950 dark:text-red-300">
          <strong>Connection error:</strong> {serverError}. The room may not exist or the server restarted — please{" "}
          <button className="underline" onClick={() => router.push("/")}>go back home</button> and create a new room.
        </div>
      )}

      {/* Header */}
      <header className="space-y-1">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Debate Room</h1>
          <div className="flex items-center gap-2">
            {isLive && (
              <Badge className="bg-red-600 animate-pulse">LIVE</Badge>
            )}
            <Badge variant="outline">{debate.roomStatus ?? "connecting"}</Badge>
          </div>
        </div>
        <p className="text-muted-foreground">{debate.topic}</p>
      </header>

      {/* Room Code + Links */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Room Code:</span>
            <code className="bg-secondary px-3 py-1 rounded text-sm font-mono">
              {roomId}
            </code>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                copyLink(`${window.location.origin}/debate/${roomId}`)
              }
            >
              <Copy className="h-3 w-3" />
              {copied ? " Copied!" : " Copy Link"}
            </Button>
          </div>

          {debate.spectatorLink && (
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                Spectator Link:
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  copyLink(
                    `${window.location.origin}${debate.spectatorLink}`
                  )
                }
              >
                <Copy className="h-3 w-3" /> Copy Spectator Link
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Participants */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" /> Participants
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 flex-wrap">
            {debate.participants.map((p) => (
              <div
                key={p.user_id}
                className="flex items-center gap-2 bg-secondary rounded-lg px-4 py-2"
              >
                <div
                  className={`w-2 h-2 rounded-full ${
                    p.user_id === debate.userId
                      ? "bg-green-400"
                      : "bg-blue-400"
                  }`}
                />
                <span className="text-sm font-medium">{p.user_name}</span>
                {p.user_id === debate.userId && (
                  <Badge variant="outline" className="text-[10px]">
                    you
                  </Badge>
                )}
              </div>
            ))}
            {isWaiting && (
              <div className="flex items-center gap-2 bg-secondary/50 rounded-lg px-4 py-2 border border-dashed border-border">
                <span className="text-sm text-muted-foreground">
                  Waiting for opponent…
                </span>
              </div>
            )}
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

      {/* Controls */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-3 items-center">
            {/* Start / Accept / Reject */}
            {isReady && !debate.isDebating && !incomingRequest && (
              <Button onClick={requestStart}>
                <Play className="h-4 w-4 mr-1" /> Request to Start
              </Button>
            )}
            {incomingRequest && (
              <div className="flex items-center gap-2">
                <span className="text-sm">
                  {debate.startRequestedBy} wants to start!
                </span>
                <Button size="sm" onClick={acceptStart}>
                  <Check className="h-4 w-4 mr-1" /> Accept
                </Button>
                <Button size="sm" variant="destructive" onClick={rejectStart}>
                  <X className="h-4 w-4 mr-1" /> Reject
                </Button>
              </div>
            )}
            {debate.startRequested &&
              debate.startRequestedBy === debate.userName &&
              !debate.isDebating && (
                <span className="text-sm text-muted-foreground">
                  Waiting for opponent to accept…
                </span>
              )}

            {/* Mic toggle (during debate) */}
            {isLive && (
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

            {isFinished && (
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
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-72">
            <div className="space-y-2 pr-4">
              {debate.transcripts.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {isLive
                    ? "Start speaking — transcripts will appear here"
                    : "Transcripts will appear once the debate starts"}
                </p>
              )}
              {debate.transcripts.map((t, i) => (
                <div
                  key={i}
                  className={`p-2 rounded-lg text-sm ${
                    t.speaker === debate.userName
                      ? "bg-primary/10 border border-primary/20 ml-8"
                      : "bg-secondary mr-8"
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
