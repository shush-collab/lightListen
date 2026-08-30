import { storage } from "@/src/utils/storage";

import type {
  Chapter,
  CommunityRequest,
  ContinueItem,
  Novel,
  NovelDetail,
  ProFeature,
  Progress,
  User,
} from "./types";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
export const API_URL = `${BACKEND_URL}/api`;

const REFRESH_KEY = "lightlisten.auth.refresh_token";

let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};
export const registerUnauthorizedHandler = (handler: (() => void) | null) => {
  onUnauthorized = handler;
};
export const saveRefreshToken = (token: string) => storage.secureSet(REFRESH_KEY, token);
export const readRefreshToken = () => storage.secureGet(REFRESH_KEY, "");
export const clearRefreshToken = () => storage.secureRemove(REFRESH_KEY);

/** Turns a stored media path (`/api/media/...`) or absolute URL into a fetchable URL. */
export const resolveMediaUrl = (url?: string | null): string | null => {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${BACKEND_URL}${url}`;
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  auth?: boolean;
  headers?: Record<string, string>;
};

const parseError = async (res: Response): Promise<string> => {
  try {
    const data = await res.json();
    if (typeof data?.detail === "string") return data.detail;
    if (Array.isArray(data?.detail) && data.detail[0]?.msg) return data.detail[0].msg;
    return JSON.stringify(data);
  } catch {
    return res.statusText || "Request failed";
  }
};

async function tryRefresh(): Promise<boolean> {
  const refresh = await readRefreshToken();
  if (!refresh) return false;
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) return false;
    const pair = await res.json();
    accessToken = pair.access_token;
    await saveRefreshToken(pair.refresh_token);
    return true;
  } catch {
    return false;
  }
}

export async function request<T>(path: string, options: RequestOptions = {}, retry = true): Promise<T> {
  const { method = "GET", body, auth = true, headers = {} } = options;
  const finalHeaders: Record<string, string> = { ...headers };
  if (body !== undefined) finalHeaders["Content-Type"] = "application/json";
  if (auth && accessToken) finalHeaders.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401 && retry && auth && path !== "/auth/refresh") {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, options, false);
    await clearRefreshToken();
    accessToken = null;
    onUnauthorized?.();
  }

  if (!res.ok) throw new ApiError(res.status, await parseError(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  // auth
  signup: (email: string, password: string, display_name: string) =>
    request<{ access_token: string; refresh_token: string; user: User }>("/auth/signup", {
      method: "POST",
      body: { email, password, display_name },
      auth: false,
    }),
  login: (email: string, password: string) =>
    request<{ access_token: string; refresh_token: string; user: User }>("/auth/login", {
      method: "POST",
      body: { email, password },
      auth: false,
    }),
  refresh: (refresh_token: string) =>
    request<{ access_token: string; refresh_token: string; user: User }>("/auth/refresh", {
      method: "POST",
      body: { refresh_token },
      auth: false,
    }),
  me: () => request<User>("/auth/me"),
  updateMe: (payload: { display_name?: string; avatar_url?: string }) =>
    request<User>("/auth/me", { method: "PUT", body: payload }),

  // catalog
  novels: (params: { q?: string; genre?: string; sort?: string; limit?: number } = {}) => {
    const search = new URLSearchParams();
    if (params.q) search.set("q", params.q);
    if (params.genre) search.set("genre", params.genre);
    if (params.sort) search.set("sort", params.sort);
    if (params.limit) search.set("limit", String(params.limit));
    const qs = search.toString();
    return request<Novel[]>(`/novels${qs ? `?${qs}` : ""}`);
  },
  novel: (id: string) => request<NovelDetail>(`/novels/${id}`),
  chapters: (id: string) => request<Chapter[]>(`/novels/${id}/chapters`),
  genres: () => request<string[]>("/genres"),
  markPlay: (id: string) => request<{ ok: boolean }>(`/novels/${id}/play`, { method: "POST" }),

  // library
  continueListening: () => request<ContinueItem[]>("/me/continue"),
  saveProgress: (novel_id: string, chapter_id: string, position_seconds: number) =>
    request<{ ok: boolean }>("/me/progress", {
      method: "PUT",
      body: { novel_id, chapter_id, position_seconds },
    }),
  progress: (novelId: string) => request<Progress | null>(`/me/progress/${novelId}`),
  saved: () => request<Novel[]>("/me/saved"),
  save: (id: string) => request<{ saved: boolean }>(`/novels/${id}/save`, { method: "POST" }),
  unsave: (id: string) => request<{ saved: boolean }>(`/novels/${id}/save`, { method: "DELETE" }),

  // community
  requests: (q?: string) =>
    request<CommunityRequest[]>(`/requests${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  createRequest: (title: string, alt_title?: string) =>
    request<CommunityRequest>("/requests", { method: "POST", body: { title, alt_title } }),
  vote: (id: string) => request<CommunityRequest>(`/requests/${id}/vote`, { method: "POST" }),
  myRequests: () => request<CommunityRequest[]>("/me/requests"),

  pro: () => request<{ status: string; features: ProFeature[] }>("/pro/features", { auth: false }),
};
