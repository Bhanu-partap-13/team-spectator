"use client";

import { useRef } from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import debateReducer from "./slices/debateSlice";
import topicReducer from "./slices/topicSlice";

function makeStore() {
  return configureStore({
    reducer: {
      debate: debateReducer,
      topics: topicReducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: false,
      }),
  });
}

type AppStore = ReturnType<typeof makeStore>;

export function StoreProvider({ children }: { children: React.ReactNode }) {
  // Create the store once per component mount (client-side) so SSR and
  // client always start from the same clean initial state, eliminating
  // hydration mismatches caused by a shared server-side singleton.
  const storeRef = useRef<AppStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = makeStore();
  }
  return <Provider store={storeRef.current}>{children}</Provider>;
}
