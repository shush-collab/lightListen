import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { api, resolveMediaUrl } from "@/src/api/client";
import type { Chapter, Novel } from "@/src/api/types";

import { useDownloads } from "./DownloadsContext";

export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export type SleepOption = 15 | 30 | 45 | 60 | "chapter" | null;

type Track = { novel: Novel; chapters: Chapter[]; index: number };

type PlayerActions = {
  track: Track | null;
  chapter: Chapter | null;
  novel: Novel | null;
  rate: number;
  sleep: SleepOption;
  sleepRemaining: number | null;
  isOffline: boolean;
  playChapter: (novel: Novel, chapters: Chapter[], index: number, startAt?: number) => void;
  togglePlay: () => void;
  next: () => void;
  previous: () => void;
  seekBy: (delta: number) => void;
  seekTo: (position: number) => void;
  setRate: (rate: number) => void;
  setSleep: (option: SleepOption) => void;
  stop: () => void;
  hydrate: () => Promise<void>;
};

type PlayerStatus = {
  playing: boolean;
  buffering: boolean;
  position: number;
  duration: number;
};

const ActionsContext = createContext<PlayerActions>({
  track: null,
  chapter: null,
  novel: null,
  rate: 1,
  sleep: null,
  sleepRemaining: null,
  isOffline: false,
  playChapter: () => {},
  togglePlay: () => {},
  next: () => {},
  previous: () => {},
  seekBy: () => {},
  seekTo: () => {},
  setRate: () => {},
  setSleep: () => {},
  stop: () => {},
  hydrate: async () => {},
});

const StatusContext = createContext<PlayerStatus>({
  playing: false,
  buffering: false,
  position: 0,
  duration: 0,
});

const SAVE_INTERVAL_MS = 12000;

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const player = useAudioPlayer(null, { updateInterval: 500 });
  const status = useAudioPlayerStatus(player);
  const { getLocalUri } = useDownloads();

  const [track, setTrack] = useState<Track | null>(null);
  const [rate, setRateState] = useState(1);
  const [sleep, setSleepState] = useState<SleepOption>(null);
  const [sleepRemaining, setSleepRemaining] = useState<number | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  const pendingSeek = useRef<number | null>(null);
  const lastSave = useRef(0);
  const trackRef = useRef<Track | null>(null);
  const positionRef = useRef(0);
  const sleepEndsAt = useRef<number | null>(null);
  const finishGuard = useRef(false);

  trackRef.current = track;
  positionRef.current = status.currentTime ?? 0;

  useEffect(() => {
    (async () => {
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          interruptionMode: "duckOthers",
        });
      } catch {
        /* web / unsupported */
      }
    })();
  }, []);

  const persistProgress = useCallback((force = false) => {
    const current = trackRef.current;
    if (!current) return;
    const chapter = current.chapters[current.index];
    if (!chapter) return;
    const now = Date.now();
    if (!force && now - lastSave.current < SAVE_INTERVAL_MS) return;
    lastSave.current = now;
    void api
      .saveProgress(current.novel.id, chapter.id, positionRef.current)
      .catch(() => undefined);
  }, []);

  const loadChapter = useCallback(
    (novel: Novel, chapters: Chapter[], index: number, startAt: number, autoplay: boolean) => {
      const chapter = chapters[index];
      if (!chapter) return;
      const localUri = getLocalUri(chapter.id);
      const uri = localUri ?? resolveMediaUrl(chapter.audio_file_url);
      if (!uri) return;
      setIsOffline(Boolean(localUri));
      setTrack({ novel, chapters, index });
      trackRef.current = { novel, chapters, index };
      pendingSeek.current = startAt > 1 ? startAt : null;
      finishGuard.current = false;
      player.replace({ uri });
      player.setPlaybackRate(rate, "medium");
      if (autoplay) player.play();
      lastSave.current = 0;
    },
    [getLocalUri, player, rate],
  );

  const playChapter = useCallback(
    (novel: Novel, chapters: Chapter[], index: number, startAt = 0) => {
      persistProgress(true);
      loadChapter(novel, chapters, index, startAt, true);
      void api.markPlay(novel.id).catch(() => undefined);
    },
    [loadChapter, persistProgress],
  );

  // Apply a deferred seek once the new source reports a usable duration.
  useEffect(() => {
    if (pendingSeek.current == null) return;
    if (!status.isLoaded) return;
    const target = pendingSeek.current;
    pendingSeek.current = null;
    player.seekTo(target);
  }, [status.isLoaded, player]);

  // Throttled progress persistence while playing.
  useEffect(() => {
    if (!status.playing) return;
    persistProgress(false);
  }, [status.currentTime, status.playing, persistProgress]);

  const next = useCallback(() => {
    const current = trackRef.current;
    if (!current) return;
    if (current.index + 1 >= current.chapters.length) return;
    persistProgress(true);
    loadChapter(current.novel, current.chapters, current.index + 1, 0, true);
  }, [loadChapter, persistProgress]);

  const previous = useCallback(() => {
    const current = trackRef.current;
    if (!current) return;
    if (positionRef.current > 5) {
      player.seekTo(0);
      return;
    }
    if (current.index === 0) return;
    persistProgress(true);
    loadChapter(current.novel, current.chapters, current.index - 1, 0, true);
  }, [loadChapter, persistProgress, player]);

  // Auto-advance / sleep-at-end-of-chapter.
  useEffect(() => {
    if (!status.didJustFinish || finishGuard.current) return;
    finishGuard.current = true;
    persistProgress(true);
    if (sleep === "chapter") {
      player.pause();
      setSleepState(null);
      return;
    }
    next();
  }, [status.didJustFinish, sleep, next, persistProgress, player]);

  // Countdown sleep timer.
  useEffect(() => {
    if (typeof sleep !== "number") {
      setSleepRemaining(null);
      sleepEndsAt.current = null;
      return;
    }
    sleepEndsAt.current = Date.now() + sleep * 60 * 1000;
    setSleepRemaining(sleep * 60);
    const id = setInterval(() => {
      if (!sleepEndsAt.current) return;
      const left = Math.round((sleepEndsAt.current - Date.now()) / 1000);
      if (left <= 0) {
        player.pause();
        sleepEndsAt.current = null;
        setSleepState(null);
        setSleepRemaining(null);
        return;
      }
      setSleepRemaining(left);
    }, 1000);
    return () => clearInterval(id);
  }, [sleep, player]);

  const togglePlay = useCallback(() => {
    if (!trackRef.current) return;
    if (status.playing) {
      player.pause();
      persistProgress(true);
    } else {
      player.play();
    }
  }, [player, status.playing, persistProgress]);

  const seekBy = useCallback(
    (delta: number) => {
      const target = Math.max(0, (status.currentTime ?? 0) + delta);
      player.seekTo(target);
    },
    [player, status.currentTime],
  );

  const seekTo = useCallback(
    (position: number) => {
      player.seekTo(Math.max(0, position));
    },
    [player],
  );

  const setRate = useCallback(
    (value: number) => {
      setRateState(value);
      player.setPlaybackRate(value, "medium");
    },
    [player],
  );

  const stop = useCallback(() => {
    persistProgress(true);
    player.pause();
    setTrack(null);
    trackRef.current = null;
  }, [player, persistProgress]);

  /** Restores the most recent chapter (paused) so the mini-player survives a cold start. */
  const hydrate = useCallback(async () => {
    if (trackRef.current) return;
    try {
      const items = await api.continueListening();
      const first = items[0];
      if (!first?.chapter) return;
      const chapters = await api.chapters(first.novel.id);
      const index = chapters.findIndex((c) => c.id === first.chapter?.id);
      if (index < 0) return;
      loadChapter(first.novel, chapters, index, first.position_seconds, false);
    } catch {
      /* offline / not logged in */
    }
  }, [loadChapter]);

  const actions = useMemo<PlayerActions>(
    () => ({
      track,
      chapter: track ? track.chapters[track.index] ?? null : null,
      novel: track?.novel ?? null,
      rate,
      sleep,
      sleepRemaining,
      isOffline,
      playChapter,
      togglePlay,
      next,
      previous,
      seekBy,
      seekTo,
      setRate,
      setSleep: setSleepState,
      stop,
      hydrate,
    }),
    [
      track,
      rate,
      sleep,
      sleepRemaining,
      isOffline,
      playChapter,
      togglePlay,
      next,
      previous,
      seekBy,
      seekTo,
      setRate,
      stop,
      hydrate,
    ],
  );

  const statusValue = useMemo<PlayerStatus>(
    () => ({
      playing: Boolean(status.playing),
      buffering: Boolean(status.isBuffering) && !status.playing,
      position: status.currentTime ?? 0,
      duration:
        status.duration && status.duration > 0
          ? status.duration
          : track?.chapters[track.index]?.duration_seconds ?? 0,
    }),
    [status.playing, status.isBuffering, status.currentTime, status.duration, track],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <StatusContext.Provider value={statusValue}>{children}</StatusContext.Provider>
    </ActionsContext.Provider>
  );
}

export const usePlayer = () => useContext(ActionsContext);
export const usePlayerStatus = () => useContext(StatusContext);
