import type { ContentQualityResult } from '@/types/assistant';

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
// UI before the user confirms scheduling. Runs through the same Arabic
// Content Quality Control pipeline as the AI Assistant (see
// runQualityControlLoop in assistantOrchestrator) before the user ever sees
// a "Ready to schedule" state — quality fields mirror DraftPost so both
// authoring surfaces share one mental model.
export type GeneratedPostDraft = {
  /** سجل المحتوى الدائم في جدول posts، ينشأ فور اكتمال التوليد. */
  post_id?: string;
  content: string;
  platforms: string[];
  scheduled_for: string;
  /** Outcome of the last Quality Control pass against `content`. Null while
   * QC hasn't finished running yet. */
  quality: ContentQualityResult | null;
  /** True only when the Deterministic Guard passed, QC parsed
   * successfully, and every sub-score cleared its minimum. Only
   * `approved` drafts are eligible for automatic scheduling. */
  approved: boolean;
  /** True once QC ran out of regeneration attempts and the content is
   * still below the quality bar — surfaced as "Needs Manual Review",
   * never scheduled automatically. */
  needsReview: boolean;
  /** True when QC itself failed to run/parse (network error, malformed
   * JSON, etc.) rather than running and rejecting the content. */
  quality_error: boolean;
  /** True while this draft's QC loop is (re)running. */
  checking: boolean;
};
