import { configureStore } from "@reduxjs/toolkit";
import debateReducer from "./slices/debateSlice";
import topicReducer from "./slices/topicSlice";

export const store = configureStore({
  reducer: {
    debate: debateReducer,
    topics: topicReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false, // WebSocket/AudioContext aren't serializable
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
