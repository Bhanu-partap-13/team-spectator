import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Backend REST base URL (no trailing slash).
 */
export const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

/**
 * Backend WebSocket base URL (no trailing slash).
 */
export const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000";

/**
 * Deepgram API key for browser-side real-time transcription.
 */
export const DEEPGRAM_API_KEY =
  process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY || "";
