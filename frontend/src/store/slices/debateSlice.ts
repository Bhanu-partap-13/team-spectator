import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { RoomStatus, TranscriptEntry, Participant } from "@/types";

interface DebateState {
  // Identity
  userId: string;
  userName: string;

  // Room
  roomId: string | null;
  topic: string;
  category: string;
  roomStatus: RoomStatus | null;
  participants: Participant[];
  spectatorCount: number;
  spectatorLink: string | null;

  // Debate
  isDebating: boolean;
  startRequested: boolean;
  startRequestedBy: string | null;
  transcripts: TranscriptEntry[];
  analysis: string | null;

  // AI debate
  isAIDebate: boolean;
  aiConnected: boolean;

  // Connectivity
  wsConnected: boolean;
  rtcConnected: boolean;
  micActive: boolean;
}

const initialState: DebateState = {
  userId: "",
  userName: "",
  roomId: null,
  topic: "",
  category: "",
  roomStatus: null,
  participants: [],
  spectatorCount: 0,
  spectatorLink: null,
  isDebating: false,
  startRequested: false,
  startRequestedBy: null,
  transcripts: [],
  analysis: null,
  isAIDebate: false,
  aiConnected: false,
  wsConnected: false,
  rtcConnected: false,
  micActive: false,
};

const debateSlice = createSlice({
  name: "debate",
  initialState,
  reducers: {
    setIdentity(state, action: PayloadAction<{ userId: string; userName: string }>) {
      state.userId = action.payload.userId;
      state.userName = action.payload.userName;
    },
    setRoom(
      state,
      action: PayloadAction<{
        roomId: string;
        topic: string;
        category: string;
        status: RoomStatus;
        participants: Participant[];
        spectatorCount: number;
      }>
    ) {
      state.roomId = action.payload.roomId;
      state.topic = action.payload.topic;
      state.category = action.payload.category;
      state.roomStatus = action.payload.status;
      state.participants = action.payload.participants;
      state.spectatorCount = action.payload.spectatorCount;
    },
    updateRoomStatus(state, action: PayloadAction<RoomStatus>) {
      state.roomStatus = action.payload;
    },
    addParticipant(state, action: PayloadAction<Participant>) {
      if (!state.participants.find((p) => p.user_id === action.payload.user_id)) {
        state.participants.push(action.payload);
      }
    },
    removeParticipant(state, action: PayloadAction<string>) {
      state.participants = state.participants.filter(
        (p) => p.user_id !== action.payload
      );
    },
    setSpectatorLink(state, action: PayloadAction<string>) {
      state.spectatorLink = action.payload;
    },
    setSpectatorCount(state, action: PayloadAction<number>) {
      state.spectatorCount = action.payload;
    },
    setDebating(state, action: PayloadAction<boolean>) {
      state.isDebating = action.payload;
    },
    setStartRequested(
      state,
      action: PayloadAction<{ requested: boolean; by: string | null }>
    ) {
      state.startRequested = action.payload.requested;
      state.startRequestedBy = action.payload.by;
    },
    addTranscript(state, action: PayloadAction<TranscriptEntry>) {
      state.transcripts.push(action.payload);
    },
    setAnalysis(state, action: PayloadAction<string>) {
      state.analysis = action.payload;
    },
    setWSConnected(state, action: PayloadAction<boolean>) {
      state.wsConnected = action.payload;
    },
    setRTCConnected(state, action: PayloadAction<boolean>) {
      state.rtcConnected = action.payload;
    },
    setMicActive(state, action: PayloadAction<boolean>) {
      state.micActive = action.payload;
    },
    setAIDebate(state, action: PayloadAction<boolean>) {
      state.isAIDebate = action.payload;
    },
    setAIConnected(state, action: PayloadAction<boolean>) {
      state.aiConnected = action.payload;
    },
    resetDebate() {
      return initialState;
    },
  },
});

export const {
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
  setAIDebate,
  setAIConnected,
  resetDebate,
} = debateSlice.actions;

export default debateSlice.reducer;
