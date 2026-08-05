export type ContentSourceType = 'rss' | 'url' | 'pdf' | 'word' | 'excel' | 'youtube';
export type ContentSourceStatus = 'idle' | 'fetching' | 'ready' | 'error';

export type ContentSource = {
  id: string;
  workspace_id: string;
  user_id: string;
  type: ContentSourceType;
  name: string | null;
  source_url: string | null;
  file_path: string | null;
  metadata: Record<string, unknown>;
  last_fetched_at: string | null;
  last_processed_hash: string | null;
  status: ContentSourceStatus;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export const CONTENT_SOURCE_LIMIT = 10;

// A piece of freshly-fetched, filtered, and summarized content proposed to
// the user. Nothing behind `summary` is stored server-side — this is the
// full shape the content-extraction edge function returns in-memory.
export type ProposedContentItem = {
  source_id: string;
  source_name: string | null;
  source_type: ContentSourceType;
  title: string;
  url: string | null;
  content_hash: string;
  summary: string;
  relevant: boolean;
};

export type ContentFetchError = { source_id: string; error: string };

// One post produced by the AI from selected proposed content, staged in the
// UI before the user confirms scheduling.
export type GeneratedPostDraft = {
  content: string;
  platforms: string[];
  scheduled_for: string;
};
