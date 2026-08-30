import * as FileSystem from "expo-file-system/legacy";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";

import { resolveMediaUrl } from "@/src/api/client";
import type { Chapter, Novel } from "@/src/api/types";
import { track } from "@/src/analytics";
import { storage } from "@/src/utils/storage";

export type DownloadState = "queued" | "downloading" | "complete" | "failed";
/** Manual downloads are user-owned and never auto-deleted; smart ones are a rolling cache. */
export type DownloadOrigin = "manual" | "smart";
/** 0 = off, otherwise how many upcoming chapters to keep cached. */
export type AutoDownloadSetting = 0 | 1 | 2;

export type DownloadRecord = {
  chapter_id: string;
  novel_id: string;
  novel_title: string;
  novel_cover?: string | null;
  chapter_number: number;
  chapter_title: string;
  duration_seconds: number;
  state: DownloadState;
  origin: DownloadOrigin;
  local_uri: string | null;
  file_size: number;
  progress: number;
  error?: string | null;
};

const STORE_KEY = "lightlisten.downloads.v1";
const AUTO_KEY = "lightlisten.autoDownloadNext";
export const DOWNLOADS_SUPPORTED = Platform.OS !== "web";
const AUDIO_DIR = `${FileSystem.documentDirectory ?? ""}audio/`;

const seedRecord = (novel: Novel, chapter: Chapter, origin: DownloadOrigin): DownloadRecord => ({
  chapter_id: chapter.id,
  novel_id: novel.id,
  novel_title: novel.title,
  novel_cover: novel.cover_image_url ?? null,
  chapter_number: chapter.chapter_number,
  chapter_title: chapter.title,
  duration_seconds: chapter.duration_seconds,
  state: "queued",
  origin,
  local_uri: null,
  file_size: 0,
  progress: 0,
  error: null,
});

type QueueJob = { novel: Novel; chapter: Chapter; origin: DownloadOrigin };

type DownloadsContextValue = {
  records: Record<string, DownloadRecord>;
  ready: boolean;
  supported: boolean;
  totalBytes: number;
  queuedCount: number;
  autoDownloadNext: AutoDownloadSetting;
  setAutoDownloadNext: (value: AutoDownloadSetting) => void;
  getRecord: (chapterId: string) => DownloadRecord | undefined;
  getLocalUri: (chapterId: string) => string | null;
  download: (novel: Novel, chapter: Chapter) => Promise<void>;
  downloadMany: (novel: Novel, chapters: Chapter[], origin: DownloadOrigin) => Promise<void>;
  pruneSmart: (keepChapterIds: string[]) => Promise<void>;
  remove: (chapterId: string) => Promise<void>;
  removeNovel: (novelId: string) => Promise<void>;
};

const DownloadsContext = createContext<DownloadsContextValue>({
  records: {},
  ready: false,
  supported: DOWNLOADS_SUPPORTED,
  totalBytes: 0,
  queuedCount: 0,
  autoDownloadNext: 0,
  setAutoDownloadNext: () => {},
  getRecord: () => undefined,
  getLocalUri: () => null,
  download: async () => {},
  downloadMany: async () => {},
  pruneSmart: async () => {},
  remove: async () => {},
  removeNovel: async () => {},
});

export function DownloadsProvider({ children }: { children: React.ReactNode }) {
  const [records, setRecords] = useState<Record<string, DownloadRecord>>({});
  const [ready, setReady] = useState(false);
  const [autoDownloadNext, setAutoDownloadNextState] = useState<AutoDownloadSetting>(0);
  const recordsRef = useRef<Record<string, DownloadRecord>>({});
  const activeRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<QueueJob[]>([]);
  const processingRef = useRef(false);

  const persist = useCallback((next: Record<string, DownloadRecord>) => {
    recordsRef.current = next;
    // Only completed downloads survive a restart; in-flight ones are retried by the user.
    const durable = Object.fromEntries(
      Object.entries(next).filter(([, r]) => r.state === "complete"),
    );
    void storage.setItem(STORE_KEY, JSON.stringify(durable));
  }, []);

  const patch = useCallback(
    (chapterId: string, updates: Partial<DownloadRecord>) => {
      setRecords((prev) => {
        const existing = prev[chapterId];
        if (!existing) return prev;
        const next = { ...prev, [chapterId]: { ...existing, ...updates } };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = await storage.getItem(STORE_KEY, "");
      let parsed: Record<string, DownloadRecord> = {};
      if (raw) {
        try {
          parsed = JSON.parse(raw) as Record<string, DownloadRecord>;
        } catch {
          parsed = {};
        }
      }
      if (DOWNLOADS_SUPPORTED) {
        // Drop entries whose file vanished (cache clear, manual delete).
        const verified: Record<string, DownloadRecord> = {};
        for (const [id, rec] of Object.entries(parsed)) {
          if (!rec?.local_uri) continue;
          try {
            const info = await FileSystem.getInfoAsync(rec.local_uri);
            if (info.exists) verified[id] = { ...rec, origin: rec.origin ?? "manual" };
          } catch {
            /* skip */
          }
        }
        parsed = verified;
      } else {
        parsed = {};
      }
      if (!cancelled) {
        recordsRef.current = parsed;
        setRecords(parsed);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runDownload = useCallback(
    async (novel: Novel, chapter: Chapter, origin: DownloadOrigin) => {
      if (!DOWNLOADS_SUPPORTED) {
        throw new Error("Downloads are available in the mobile app, not the web preview.");
      }
      if (activeRef.current.has(chapter.id)) return;
      const remote = resolveMediaUrl(chapter.audio_file_url);
      if (!remote) throw new Error("This chapter has no audio file yet.");

      activeRef.current.add(chapter.id);
      track("download_started", {
        novel_id: novel.id,
        chapter_id: chapter.id,
        properties: { origin },
      });
      const seed: DownloadRecord = { ...seedRecord(novel, chapter, origin), state: "downloading" };
      setRecords((prev) => {
        const next = { ...prev, [chapter.id]: seed };
        persist(next);
        return next;
      });

      const target = `${AUDIO_DIR}${chapter.id}.mp3`;
      try {
        const dir = await FileSystem.getInfoAsync(AUDIO_DIR);
        if (!dir.exists) await FileSystem.makeDirectoryAsync(AUDIO_DIR, { intermediates: true });

        let lastTick = 0;
        const task = FileSystem.createDownloadResumable(
          remote,
          target,
          {},
          (p) => {
            const total = p.totalBytesExpectedToWrite;
            const ratio = total > 0 ? p.totalBytesWritten / total : 0;
            const now = Date.now();
            if (now - lastTick < 400) return;
            lastTick = now;
            patch(chapter.id, {
              progress: Math.max(0, Math.min(1, ratio)),
              file_size: p.totalBytesWritten,
            });
          },
        );
        const result = await task.downloadAsync();
        if (!result?.uri) throw new Error("Download did not complete");
        const info = await FileSystem.getInfoAsync(result.uri);
        patch(chapter.id, {
          state: "complete",
          local_uri: result.uri,
          progress: 1,
          file_size: info.exists && "size" in info ? (info.size as number) : 0,
          error: null,
        });
        track("download_completed", {
          novel_id: novel.id,
          chapter_id: chapter.id,
          properties: { origin },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Download failed";
        const outOfSpace = /space|storage|ENOSPC|quota/i.test(message);
        patch(chapter.id, {
          state: "failed",
          error: outOfSpace ? "Not enough storage space on this device." : message,
        });
        try {
          await FileSystem.deleteAsync(target, { idempotent: true });
        } catch {
          /* ignore */
        }
        throw new Error(outOfSpace ? "Not enough storage space on this device." : message);
      } finally {
        activeRef.current.delete(chapter.id);
      }
    },
    [patch, persist],
  );

  /** Sequential worker — one file at a time so ten 100 MB chapters never race. */
  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const job = queueRef.current.shift();
        if (!job) break;
        if (recordsRef.current[job.chapter.id]?.state === "complete") continue;
        try {
          await runDownload(job.novel, job.chapter, job.origin);
        } catch {
          // the record is already marked "failed"; keep draining the queue
        }
      }
    } finally {
      processingRef.current = false;
    }
  }, [runDownload]);

  const downloadMany = useCallback(
    async (novel: Novel, chapters: Chapter[], origin: DownloadOrigin) => {
      if (!DOWNLOADS_SUPPORTED) {
        throw new Error("Downloads are available in the mobile app, not the web preview.");
      }
      const pending = chapters.filter((chapter) => {
        const rec = recordsRef.current[chapter.id];
        if (!rec) return true;
        // Skip what is already offline or in flight; failed chapters may be retried.
        return rec.state === "failed";
      });
      if (pending.length === 0) return;

      setRecords((prev) => {
        const next = { ...prev };
        pending.forEach((chapter) => {
          next[chapter.id] = seedRecord(novel, chapter, origin);
        });
        persist(next);
        return next;
      });
      queueRef.current.push(...pending.map((chapter) => ({ novel, chapter, origin })));
      void processQueue();
    },
    [persist, processQueue],
  );

  const download = useCallback(
    (novel: Novel, chapter: Chapter) => downloadMany(novel, [chapter], "manual"),
    [downloadMany],
  );

  const remove = useCallback(
    async (chapterId: string) => {
      const rec = recordsRef.current[chapterId];
      if (rec?.local_uri && DOWNLOADS_SUPPORTED) {
        try {
          await FileSystem.deleteAsync(rec.local_uri, { idempotent: true });
        } catch {
          /* ignore */
        }
      }
      setRecords((prev) => {
        const next = { ...prev };
        delete next[chapterId];
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const removeNovel = useCallback(
    async (novelId: string) => {
      const ids = Object.values(recordsRef.current)
        .filter((r) => r.novel_id === novelId)
        .map((r) => r.chapter_id);
      for (const id of ids) await remove(id);
    },
    [remove],
  );

  /** Drops smart-cached chapters outside the keep window. Manual downloads are untouched. */
  const pruneSmart = useCallback(
    async (keepChapterIds: string[]) => {
      const keep = new Set(keepChapterIds);
      const stale = Object.values(recordsRef.current).filter(
        (rec) => rec.origin === "smart" && !keep.has(rec.chapter_id),
      );
      for (const rec of stale) {
        if (rec.state === "downloading" || rec.state === "queued") continue;
        await remove(rec.chapter_id);
      }
    },
    [remove],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await storage.getItem<number>(AUTO_KEY, 0);
      if (!cancelled && (saved === 1 || saved === 2)) setAutoDownloadNextState(saved);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setAutoDownloadNext = useCallback((value: AutoDownloadSetting) => {
    setAutoDownloadNextState(value);
    void storage.setItem(AUTO_KEY, value);
  }, []);

  const totalBytes = useMemo(
    () => Object.values(records).reduce((sum, r) => sum + (r.state === "complete" ? r.file_size : 0), 0),
    [records],
  );

  const queuedCount = useMemo(
    () =>
      Object.values(records).filter((r) => r.state === "queued" || r.state === "downloading").length,
    [records],
  );

  const value = useMemo<DownloadsContextValue>(
    () => ({
      records,
      ready,
      supported: DOWNLOADS_SUPPORTED,
      totalBytes,
      queuedCount,
      autoDownloadNext,
      setAutoDownloadNext,
      getRecord: (chapterId: string) => records[chapterId],
      getLocalUri: (chapterId: string) => {
        const rec = records[chapterId];
        return rec?.state === "complete" ? rec.local_uri : null;
      },
      download,
      downloadMany,
      pruneSmart,
      remove,
      removeNovel,
    }),
    [
      records,
      ready,
      totalBytes,
      queuedCount,
      autoDownloadNext,
      setAutoDownloadNext,
      download,
      downloadMany,
      pruneSmart,
      remove,
      removeNovel,
    ],
  );

  return <DownloadsContext.Provider value={value}>{children}</DownloadsContext.Provider>;
}

export const useDownloads = () => useContext(DownloadsContext);
