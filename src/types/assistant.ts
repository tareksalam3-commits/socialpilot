import type { PostStatus } from '@/types/social';

/** High-level stage the AI Assistant pipeline is currently in. */
export type AssistantStage =
  | 'idle'
  | 'planning'
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
 * is now being monitored through the existing publishing pipeline. */
export type MonitoredPost = {
  postId: string;
  title: string;
  status: PostStatus;
  error_message: string | null;
};
