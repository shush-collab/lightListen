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
import { storage } from "@/src/utils/storage";

export type DownloadState = "queued" | "downloading" | "complete" | "failed";

export type DownloadRecord = {
  chapter_id: string;
  novel_id: string;
  novel_title: string;
  novel_cover?: string | null;
  chapter_number: number;
  chapter_title: string;
  duration_seconds: number;
  state: DownloadState;
  local_uri: string | null;
  file_size: number;
  progress: number;
  error?: string | null;
};

const STORE_KEY = "lightlisten.downloads.v1";
export const DOWNLOADS_SUPPORTED = Platform.OS !== "web";
const AUDIO_DIR = `${FileSystem.documentDirectory ?? ""}audio/`;

type DownloadsContextValue = {
  records: Record<string, DownloadRecord>;
  ready: boolean;
  supported: boolean;
  totalBytes: number;
  getRecord: (chapterId: string) => DownloadRecord | undefined;
  getLocalUri: (chapterId: string) => string | null;
  download: (novel: Novel, chapter: Chapter) => Promise<void>;
  remove: (chapterId: string) => Promise<void>;
  removeNovel: (novelId: string) => Promise<void>;
};

const DownloadsContext = createContext<DownloadsContextValue>({
  records: {},
  ready: false,
  supported: DOWNLOADS_SUPPORTED,
  totalBytes: 0,
  getRecord: () => undefined,
  getLocalUri: () => null,
  download: async () => {},
  remove: async () => {},
  removeNovel: async () => {},
});

export function DownloadsProvider({ children }: { children: React.ReactNode }) {
  const [records, setRecords] = useState<Record<string, DownloadRecord>>({});
  const [ready, setReady] = useState(false);
  const recordsRef = useRef<Record<string, DownloadRecord>>({});
  const activeRef = useRef<Set<string>>(new Set());

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
            if (info.exists) verified[id] = rec;
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

  const download = useCallback(
    async (novel: Novel, chapter: Chapter) => {
      if (!DOWNLOADS_SUPPORTED) {
        throw new Error("Downloads are available in the mobile app, not the web preview.");
      }
      if (activeRef.current.has(chapter.id)) return;
      const remote = resolveMediaUrl(chapter.audio_file_url);
      if (!remote) throw new Error("This chapter has no audio file yet.");

      activeRef.current.add(chapter.id);
      const seed: DownloadRecord = {
        chapter_id: chapter.id,
        novel_id: novel.id,
        novel_title: novel.title,
        novel_cover: novel.cover_image_url ?? null,
        chapter_number: chapter.chapter_number,
        chapter_title: chapter.title,
        duration_seconds: chapter.duration_seconds,
        state: "downloading",
        local_uri: null,
        file_size: 0,
        progress: 0,
        error: null,
      };
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

  const totalBytes = useMemo(
    () => Object.values(records).reduce((sum, r) => sum + (r.state === "complete" ? r.file_size : 0), 0),
    [records],
  );

  const value = useMemo<DownloadsContextValue>(
    () => ({
      records,
      ready,
      supported: DOWNLOADS_SUPPORTED,
      totalBytes,
      getRecord: (chapterId: string) => records[chapterId],
      getLocalUri: (chapterId: string) => {
        const rec = records[chapterId];
        return rec?.state === "complete" ? rec.local_uri : null;
      },
      download,
      remove,
      removeNovel,
    }),
    [records, ready, totalBytes, download, remove, removeNovel],
  );

  return <DownloadsContext.Provider value={value}>{children}</DownloadsContext.Provider>;
}

export const useDownloads = () => useContext(DownloadsContext);
