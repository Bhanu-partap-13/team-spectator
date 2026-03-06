import { z } from "zod";

// ── Enums ──────────────────────────────────────────────────────────────────────

export const RoomStatusSchema = z.enum([
  "waiting",
  "ready",
  "debating",
  "finished",
]);
export type RoomStatus = z.infer<typeof RoomStatusSchema>;

export const ParticipantRoleSchema = z.enum(["debater", "spectator"]);
export type ParticipantRole = z.infer<typeof ParticipantRoleSchema>;

// ── Topic ──────────────────────────────────────────────────────────────────────

export const TopicSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  description: z.string().optional().default(""),
  is_topic_of_day: z.boolean().optional().default(false),
  is_trending: z.boolean().optional().default(false),
  created_at: z.string().optional(),
});
export type Topic = z.infer<typeof TopicSchema>;

export const TopicCreateSchema = z.object({
  title: z.string().min(5, "Topic must be at least 5 characters"),
  category: z.string().min(1, "Category is required"),
  description: z.string().optional().default(""),
});
export type TopicCreate = z.infer<typeof TopicCreateSchema>;

// ── Participant ────────────────────────────────────────────────────────────────

export const ParticipantSchema = z.object({
  user_id: z.string(),
  user_name: z.string(),
  role: ParticipantRoleSchema,
  joined_at: z.string().optional(),
});
export type Participant = z.infer<typeof ParticipantSchema>;

// ── Room ───────────────────────────────────────────────────────────────────────

export const RoomSchema = z.object({
  room_id: z.string(),
  topic: z.string(),
  category: z.string(),
  status: RoomStatusSchema,
  participants: z.array(ParticipantSchema),
  spectator_count: z.number(),
  created_at: z.string(),
});
export type Room = z.infer<typeof RoomSchema>;

export const RoomCreateSchema = z.object({
  topic: z.string().min(1),
  category: z.string().default("general"),
  user_id: z.string(),
  user_name: z.string(),
});
export type RoomCreate = z.infer<typeof RoomCreateSchema>;

// ── Transcript ─────────────────────────────────────────────────────────────────

export const TranscriptEntrySchema = z.object({
  speaker: z.string(),
  text: z.string(),
  is_final: z.boolean().optional().default(false),
  timestamp: z.string().optional(),
});
export type TranscriptEntry = z.infer<typeof TranscriptEntrySchema>;

// ── WebSocket Messages ─────────────────────────────────────────────────────────

export interface WSMessage {
  type: string;
  data?: Record<string, unknown>;
}

// ── Debate Mode ────────────────────────────────────────────────────────────────

export type DebateMode = "pvp" | "ai";
