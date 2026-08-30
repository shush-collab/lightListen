import { api } from "@/src/api/client";

/** Only these names are accepted by the backend — keep the two lists in sync. */
export type AnalyticsEventName =
  | "novel_viewed"
  | "chapter_started"
  | "chapter_completed"
  | "anime_continue_used"
  | "catchup_used"
  | "bookmark_created"
  | "download_started"
  | "download_completed"
  | "request_submitted"
  | "request_voted";

type TrackPayload = {
  novel_id?: string;
  chapter_id?: string;
  properties?: Record<string, unknown>;
};

/** Fire-and-forget: analytics must never block playback or navigation. */
export function track(event: AnalyticsEventName, payload: TrackPayload = {}): void {
  void api.trackEvent({ event, ...payload }).catch(() => undefined);
}
