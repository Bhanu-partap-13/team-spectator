/**
 * Browser-side Deepgram real-time transcription over WebSocket.
 *
 * Opens a persistent WebSocket to Deepgram's streaming endpoint, sends
 * raw PCM-16 kHz audio, and fires a callback for every transcript chunk.
 */

import { DEEPGRAM_API_KEY } from "./utils";

export type TranscriptCallback = (
  text: string,
  isFinal: boolean,
  speechFinal: boolean
) => void;

export class DeepgramTranscriber {
  private socket: WebSocket | null = null;
  private onTranscript: TranscriptCallback;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(onTranscript: TranscriptCallback) {
    this.onTranscript = onTranscript;
  }

  /** Open the Deepgram WebSocket. */
  connect(): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      console.log("[Deepgram] Already connected, skipping");
      return;
    }

    if (!DEEPGRAM_API_KEY) {
      console.error(
        "[Deepgram] *** NO API KEY *** Set NEXT_PUBLIC_DEEPGRAM_API_KEY in frontend/.env (or .env.local)"
      );
      return;
    }

    console.log("[Deepgram] Connecting… key prefix =", DEEPGRAM_API_KEY.slice(0, 8));

    const params = new URLSearchParams({
      model: "nova-2",
      punctuate: "true",
      interim_results: "true",
      encoding: "linear16",
      sample_rate: "16000",
      channels: "1",
      endpointing: "300",
      utterance_end_ms: "1000",
    });

    const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
    console.log("[Deepgram] URL:", url);

    this.socket = new WebSocket(url, ["token", DEEPGRAM_API_KEY]);

    this.socket.onopen = () => {
      console.log("[Deepgram] ✓ Connected successfully");
      this.keepAliveTimer = setInterval(() => {
        if (this.socket?.readyState === WebSocket.OPEN) {
          this.socket.send(JSON.stringify({ type: "KeepAlive" }));
        }
      }, 8000);
    };

    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const transcript: string =
          data?.channel?.alternatives?.[0]?.transcript ?? "";
        if (transcript) {
          console.log("[Deepgram] Transcript:", transcript, "| final:", data.is_final);
          this.onTranscript(
            transcript,
            !!data.is_final,
            !!data.speech_final
          );
        }
      } catch (e) {
        console.warn("[Deepgram] Non-JSON message:", e);
      }
    };

    this.socket.onerror = (err) => {
      console.error("[Deepgram] ✗ WebSocket error:", err);
    };

    this.socket.onclose = (ev) => {
      console.log("[Deepgram] Disconnected  code=%d  reason=%s", ev.code, ev.reason);
      if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    };
  }

  /** Send a chunk of raw PCM-16 kHz audio. */
  sendAudio(pcm: ArrayBuffer): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(pcm);
    }
  }

  /** Whether the connection is active. */
  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /** Gracefully close. */
  close(): void {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    if (this.socket) {
      try {
        if (this.socket.readyState === WebSocket.OPEN) {
          this.socket.send(JSON.stringify({ type: "CloseStream" }));
        }
        this.socket.close();
      } catch {
        // ignore close errors
      }
      this.socket = null;
    }
  }
}

// ── Mic capture helper ─────────────────────────────────────────────────────────

/**
 * Captures microphone audio as linear-16 PCM at 16 kHz and calls `onChunk`
 * with each buffer.  Returns a cleanup function.
 */
export async function captureMicPCM(
  onChunk: (pcm: ArrayBuffer) => void
): Promise<{ stream: MediaStream; stop: () => void }> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      sampleRate: 16000,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });

  const audioCtx = new AudioContext({ sampleRate: 16000 });
  const source = audioCtx.createMediaStreamSource(stream);

  // ScriptProcessorNode is deprecated but universally supported.
  // AudioWorklet would be better for production.
  const processor = audioCtx.createScriptProcessor(4096, 1, 1);

  source.connect(processor);
  processor.connect(audioCtx.destination);

  processor.onaudioprocess = (e) => {
    const float32 = e.inputBuffer.getChannelData(0);
    // Convert Float32 → Int16 PCM
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    onChunk(int16.buffer);
  };

  const stop = () => {
    processor.disconnect();
    source.disconnect();
    audioCtx.close();
    stream.getTracks().forEach((t) => t.stop());
  };

  return { stream, stop };
}
