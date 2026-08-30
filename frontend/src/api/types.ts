export type User = {
  id: string;
  email: string;
  display_name: string;
  avatar_url?: string | null;
  role: string;
  created_at?: string;
};

export type Novel = {
  id: string;
  title: string;
  alt_title?: string | null;
  author: string;
  description: string;
  genres: string[];
  cover_image_url?: string | null;
  status: string;
  play_count: number;
  chapter_count: number;
  total_duration_seconds: number;
  anime_mappings: AnimeMapping[];
  narration_mode: string;
  cast_count: number;
  created_at?: string;
  updated_at?: string;
};

export type AnimeMapping = {
  label: string;
  through_episode?: number | null;
  continue_chapter_id: string | null;
  note?: string | null;
};

export type Illustration = {
  id: string;
  timestamp_seconds: number;
  image_url: string;
  caption?: string | null;
};

export type Chapter = {
  id: string;
  novel_id: string;
  volume_id: string;
  chapter_number: number;
  title: string;
  audio_file_url: string;
  duration_seconds: number;
  file_size_bytes: number;
  illustrations?: Illustration[];
};

export type Volume = {
  id: string;
  novel_id: string;
  volume_number: number;
  cover_image_url?: string | null;
  chapters: Chapter[];
};

export type Progress = {
  novel_id: string;
  chapter_id: string;
  position_seconds: number;
  updated_at?: string;
};

export type NovelDetail = {
  novel: Novel;
  volumes: Volume[];
  saved: boolean;
  progress?: Progress | null;
};

export type ContinueItem = {
  novel: Novel;
  chapter: Chapter | null;
  position_seconds: number;
  updated_at?: string;
};

export type RequestStatus = "requested" | "selected" | "processing" | "published" | "rejected";

export type CommunityRequest = {
  id: string;
  title: string;
  alt_title?: string | null;
  cover_image_url?: string | null;
  genres: string[];
  vote_count: number;
  status: RequestStatus;
  linked_novel_id?: string | null;
  submitted_by?: string | null;
  has_voted: boolean;
  is_mine: boolean;
  created_at?: string;
  updated_at?: string;
};

export type ProFeature = { title: string; description: string };

export type Bookmark = {
  id: string;
  novel_id: string;
  chapter_id: string;
  position_seconds: number;
  chapter_number?: number | null;
  chapter_title?: string | null;
  created_at?: string;
};

export type CatchUp = {
  available: boolean;
  last_listened_at?: string | null;
  days_since?: number | null;
  through_chapter?: number | null;
  text: string;
};
