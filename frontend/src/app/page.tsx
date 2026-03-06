"use client";

import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";

import type { AppDispatch, RootState } from "@/store/store";
import {
  fetchTrending,
  fetchTopicOfDay,
  fetchCategories,
  createTopic,
} from "@/store/slices/topicSlice";
import { setIdentity } from "@/store/slices/debateSlice";
import { API_URL } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Swords,
  Bot,
  Plus,
  Trophy,
  TrendingUp,
  Flame,
  Link,
  Eye,
} from "lucide-react";

export default function HomePage() {
  const dispatch = useDispatch<AppDispatch>();
  const router = useRouter();

  const { trending, topicOfDay, categories } = useSelector(
    (s: RootState) => s.topics
  );

  // Local form state
  const [userName, setUserName] = useState("");
  const [selectedTopic, setSelectedTopic] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("general");
  const [customTopic, setCustomTopic] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [spectateCode, setSpectateCode] = useState("");

  // Persist / restore identity
  useEffect(() => {
    const stored = localStorage.getItem("debate_user");
    if (stored) {
      const { userId, userName: name } = JSON.parse(stored);
      dispatch(setIdentity({ userId, userName: name }));
      setUserName(name);
    }
  }, [dispatch]);

  useEffect(() => {
    dispatch(fetchTrending());
    dispatch(fetchTopicOfDay());
    dispatch(fetchCategories());
  }, [dispatch]);

  // ── Helpers ──────────────────────────────────────────────────────────────

  function ensureIdentity(): { userId: string; userName: string } {
    const userId = uuidv4();
    const name = userName.trim() || `Debater-${userId.slice(0, 4)}`;
    const identity = { userId, userName: name };
    localStorage.setItem("debate_user", JSON.stringify(identity));
    dispatch(setIdentity(identity));
    return identity;
  }

  function getTopicText(): string {
    if (customTopic.trim()) return customTopic.trim();
    if (selectedTopic) return selectedTopic;
    if (topicOfDay) return topicOfDay.title;
    return "Open Debate";
  }

  // ── Actions ─────────────────────────────────────────────────────────────

  async function handleCreateRoom() {
    const { userId, userName: name } = ensureIdentity();
    const topic = getTopicText();

    const res = await fetch(`${API_URL}/api/rooms/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic,
        category: selectedCategory,
        user_id: userId,
        user_name: name,
      }),
    });
    const room = await res.json();
    router.push(`/debate/${room.room_id}`);
  }

  function handleJoinRoom() {
    if (!joinCode.trim()) return;
    ensureIdentity();
    router.push(`/debate/${joinCode.trim()}`);
  }

  function handleSpectate() {
    if (!spectateCode.trim()) return;
    ensureIdentity();
    router.push(`/spectate/${spectateCode.trim()}`);
  }

  function handleAIDebate() {
    ensureIdentity();
    const topic = getTopicText();
    router.push(`/ai-debate?topic=${encodeURIComponent(topic)}&category=${selectedCategory}`);
  }

  async function handleAddCustomTopic() {
    if (!customTopic.trim()) return;
    await dispatch(
      createTopic({
        title: customTopic.trim(),
        category: selectedCategory,
        description: "",
      })
    );
    setSelectedTopic(customTopic.trim());
    setCustomTopic("");
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <header className="text-center space-y-2 pt-8">
        <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent">
          Debate Arena
        </h1>
        <p className="text-muted-foreground text-lg">
          Pick a topic. Find an opponent. Prove your point.
        </p>
      </header>

      {/* Name input */}
      <Card>
        <CardContent className="pt-6">
          <label className="text-sm text-muted-foreground mb-1 block">
            Your display name
          </label>
          <Input
            placeholder="Enter your name…"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            className="max-w-sm"
          />
        </CardContent>
      </Card>

      {/* Topic of the Day */}
      {topicOfDay && (
        <Card className="border-primary/50 bg-gradient-to-br from-purple-950/30 to-background">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-yellow-400" />
              <CardTitle className="text-lg">Topic of the Day</CardTitle>
            </div>
            <CardDescription>{topicOfDay.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <button
              onClick={() => {
                setSelectedTopic(topicOfDay.title);
                setCustomTopic("");
              }}
              className={`text-left w-full p-3 rounded-lg border transition ${
                selectedTopic === topicOfDay.title
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <span className="font-medium">{topicOfDay.title}</span>
              <Badge className="ml-2" variant="secondary">
                {topicOfDay.category}
              </Badge>
            </button>
          </CardContent>
        </Card>
      )}

      {/* Trending Topics */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-orange-400" />
            <CardTitle className="text-lg">Trending Topics</CardTitle>
          </div>
          <CardDescription>Scroll through what people are debating</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-64">
            <div className="space-y-2 pr-4">
              {trending.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setSelectedTopic(t.title);
                    setSelectedCategory(t.category);
                    setCustomTopic("");
                  }}
                  className={`text-left w-full p-3 rounded-lg border transition ${
                    selectedTopic === t.title
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-sm">{t.title}</span>
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {t.category}
                    </Badge>
                  </div>
                  {t.description && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {t.description}
                    </p>
                  )}
                </button>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Custom Topic */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Flame className="h-5 w-5 text-red-400" />
            <CardTitle className="text-lg">Your Own Topic</CardTitle>
          </div>
          <CardDescription>
            Don&apos;t see what you want? Add your own.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Type your debate topic…"
            value={customTopic}
            onChange={(e) => {
              setCustomTopic(e.target.value);
              setSelectedTopic("");
            }}
          />
          <div className="flex gap-2 flex-wrap">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1 rounded-full text-xs border transition ${
                  selectedCategory === cat
                    ? "border-primary bg-primary/20 text-primary"
                    : "border-border hover:border-primary/50"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
          {customTopic.trim() && (
            <Button size="sm" variant="secondary" onClick={handleAddCustomTopic}>
              <Plus className="h-3 w-3 mr-1" /> Save to topic list
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Selected Topic Display */}
      {(selectedTopic || customTopic.trim()) && (
        <div className="text-center text-sm text-muted-foreground">
          Selected topic:{" "}
          <span className="text-foreground font-semibold">
            {getTopicText()}
          </span>
        </div>
      )}

      {/* Action Buttons */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Swords className="h-5 w-5" /> Person vs Person
            </CardTitle>
            <CardDescription>
              Create a room and share the link with your opponent
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button className="w-full" onClick={handleCreateRoom}>
              Create Debate Room
            </Button>
            <div className="flex gap-2">
              <Input
                placeholder="Enter room code…"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
              />
              <Button variant="outline" onClick={handleJoinRoom}>
                <Link className="h-4 w-4 mr-1" /> Join
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="h-5 w-5" /> Debate the AI
            </CardTitle>
            <CardDescription>
              Challenge Gemini to an audio debate on your chosen topic
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button className="w-full" variant="secondary" onClick={handleAIDebate}>
              Start AI Debate
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Spectate */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Eye className="h-5 w-5" /> Spectate a Debate
          </CardTitle>
          <CardDescription>
            Watch live debates and see real-time transcripts
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="Enter room code to spectate…"
              value={spectateCode}
              onChange={(e) => setSpectateCode(e.target.value)}
            />
            <Button variant="outline" onClick={handleSpectate}>
              <Eye className="h-4 w-4 mr-1" /> Watch
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
