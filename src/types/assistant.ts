import type { PostStatus } from '@/types/social';

/** High-level stage the AI Assistant pipeline is currently in. Maps onto the
 * requested lifecycle (Draft → AI Generated → Reviewed → Approved →
 * Scheduled → Publishing → Published → Verified): 'collecting'/'creating'
 * produce the AI Generated content, 'review' is Reviewed, clicking Approve
 * moves through 'scheduling' (Approved → Scheduled) into 'monitoring', where
 * each row tracks Publishing → Published → Verified via the same posts /
 * post_platform_targets rows the Posts, Calendar, Queue and Automation pages
 * already read from. */
export type AssistantStage =
  | 'idle'
  | 'planning'
  | 'collecting'
  | 'creating'
  | 'preparing'
  | 'review'
  | 'scheduling'
  | 'monitoring';

export type Cadence = 'daily' | 'every_other_day' | 'weekly' | 'once';
export type CampaignStart = 'now' | 'today' | 'tomorrow';

/** Output of the Planner Agent — what to make, for whom, on which
 * platforms, how many posts, and on what cadence. */
export type CampaignPlan = {
  objective: string;
  audience: string;
  platforms: string[];
  post_count: number;
  cadence: Cadence;
  start: CampaignStart;
  time_of_day: string; // "HH:MM", 24h
  notes: string;
  /** Whether the request implies pulling from the workspace's Content
   * Sources (e.g. "using Content Sources", "من مصادر المحتوى"). */
  use_content_sources: boolean;
};

/** A single content-source item that was folded into this campaign's
 * generation context, surfaced in the review screen for transparency. */
export type UsedContentSource = {
  source_id: string;
  source_name: string | null;
  title: string;
};

/** A single post prepared by the Creator Agent and staged by the
 * Publisher Agent for human review before anything is saved. */
export type DraftPost = {
  local_id: string;
  content: string;
  platforms: string[];
  scheduled_for: string; // ISO datetime
  media_urls: string[];
  generating?: boolean;
};

/** Tracks a post that has been approved, saved to the Posts module, and
 * is now being monitored through the existing publishing pipeline. Also
 * doubles as its entry in the Calendar and the Publishing Queue, since
 * those pages read the same `posts` row live — there is nothing separate
 * to "add" it to. `verified` flips once every platform target for the post
 * has confirmed an external ID (see verifyPost in assistantOrchestrator). */
export type MonitoredPost = {
  postId: string;
  title: string;
  status: PostStatus;
  error_message: string | null;
  verified: boolean;
};
