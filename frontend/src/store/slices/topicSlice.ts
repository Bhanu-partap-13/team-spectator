import { createSlice, createAsyncThunk, PayloadAction } from "@reduxjs/toolkit";
import type { Topic } from "@/types";
import { API_URL } from "@/lib/utils";

interface TopicState {
  all: Topic[];
  trending: Topic[];
  topicOfDay: Topic | null;
  categories: string[];
  loading: boolean;
  error: string | null;
}

const initialState: TopicState = {
  all: [],
  trending: [],
  topicOfDay: null,
  categories: [],
  loading: false,
  error: null,
};

export const fetchTopics = createAsyncThunk("topics/fetchAll", async () => {
  const res = await fetch(`${API_URL}/api/topics/`);
  return res.json();
});

export const fetchTrending = createAsyncThunk("topics/fetchTrending", async () => {
  const res = await fetch(`${API_URL}/api/topics/trending`);
  return res.json();
});

export const fetchTopicOfDay = createAsyncThunk("topics/fetchTopicOfDay", async () => {
  const res = await fetch(`${API_URL}/api/topics/topic-of-day`);
  if (!res.ok) return null;
  return res.json();
});

export const fetchCategories = createAsyncThunk("topics/fetchCategories", async () => {
  const res = await fetch(`${API_URL}/api/topics/categories`);
  return res.json();
});

export const createTopic = createAsyncThunk(
  "topics/create",
  async (topic: { title: string; category: string; description?: string }) => {
    const res = await fetch(`${API_URL}/api/topics/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(topic),
    });
    return res.json();
  }
);

const topicSlice = createSlice({
  name: "topics",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchTopics.pending, (state) => { state.loading = true; })
      .addCase(fetchTopics.fulfilled, (state, action) => {
        state.loading = false;
        state.all = action.payload;
      })
      .addCase(fetchTopics.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || "Failed to fetch topics";
      })
      .addCase(fetchTrending.fulfilled, (state, action) => {
        state.trending = action.payload;
      })
      .addCase(fetchTopicOfDay.fulfilled, (state, action) => {
        state.topicOfDay = action.payload;
      })
      .addCase(fetchCategories.fulfilled, (state, action) => {
        state.categories = action.payload;
      })
      .addCase(createTopic.fulfilled, (state, action) => {
        state.all.push(action.payload);
      });
  },
});

export default topicSlice.reducer;
