import { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';
import { mintUserAccessToken } from './impersonate.ts';
import { sendInboxReply } from './inboxSend.ts';

type Conversation = {
  id: string;
  workspace_id: string;
  account_id: string | null;
  platform: string;
  type: 'comment' | 'dm';
  sender_name: string | null;
  snippet: string | null;
  needs_review: boolean;
};

type AutomationRule = {
  id: string;
  workspace_id: string;
  account_id: string | null;
  created_by: string | null;
  enabled: boolean;
  scope: string[];
  mode: 'auto_send' | 'draft_only';
  tone_override: string | null;
  business_hours_only: boolean;
  excluded_keywords: string[];
  max_auto_replies_per_day: number;
};

const MAX_REPLIES_LOOKBACK_HOURS = 24;

function withinBusinessHours(timezone: string | null): boolean {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      hour: 'numeric',
      hour12: false,
      weekday: 'short',
    }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
    const isWeekday = !['Sat', 'Sun'].includes(weekday);
    return isWeekday && hour >= 9 && hour < 18;
  } catch {
    return true; // unknown/invalid timezone — don't block replies over a config issue
  }
}

/** Picks the most specific enabled rule for this conversation: an
 * account-scoped rule beats a workspace-wide one. */
async function findMatchingRule(supabase: SupabaseClient, conv: Conversation): Promise<AutomationRule | null> {
  const { data } = await supabase
    .from('inbox_automation_rules')
    .select('*')
    .eq('workspace_id', conv.workspace_id)
    .eq('enabled', true)
    .or(conv.account_id ? `account_id.eq.${conv.account_id},account_id.is.null` : 'account_id.is.null');
  const rules = (data ?? []) as AutomationRule[];
  if (rules.length === 0) return null;
  const scoped = rules.filter((r) => r.account_id === conv.account_id);
  const wide = rules.filter((r) => r.account_id === null);
  const candidate = scoped[0] ?? wide[0] ?? null;
  if (!candidate) return null;
  if (!candidate.scope.includes(conv.type)) return null;
  return candidate;
}

function matchesExcludedKeyword(text: string, keywords: string[]): string | null {
  const lower = text.toLowerCase();
  return keywords.find((k) => k && lower.includes(k.toLowerCase())) ?? null;
}

async function countRecentAutoReplies(supabase: SupabaseClient, conversationId: string): Promise<number> {
  const since = new Date(Date.now() - MAX_REPLIES_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from('inbox_messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('is_ai', true)
    .gte('created_at', since);
  return count ?? 0;
}

async function generateReply(
  supabase: SupabaseClient,
  rule: AutomationRule,
  conv: Conversation,
  messageText: string,
): Promise<string | null> {
  if (!rule.created_by) return null;
  const accessToken = await mintUserAccessToken(supabase, rule.created_by);
  if (!accessToken) return null;

  let brandVoice: Record<string, unknown> | null = null;
  const { data: bv } = await supabase.from('brand_voice').select('*').eq('workspace_id', conv.workspace_id).maybeSingle();
  if (bv) {
    brandVoice = {
      business_name: bv.business_name,
      description: bv.description,
      audience: bv.audience,
      industry: bv.industry,
      writing_style: bv.writing_style,
      tone: rule.tone_override || bv.tone,
      keywords: bv.keywords,
      negative_keywords: bv.negative_keywords,
      cta_style: bv.cta_style,
      emoji_style: bv.emoji_style,
    };
  } else if (rule.tone_override) {
    brandVoice = { tone: rule.tone_override };
  }

  const prompt = `Write a helpful, on-brand reply to this ${conv.type} from ${conv.sender_name ?? 'a user'} on ${conv.platform}: "${messageText}"`;

  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/ai-gateway?action=chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      workspace_id: conv.workspace_id,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      free_only: true,
      brand_voice: brandVoice,
    }),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return (body?.content as string) || null;
}

/** Entry point called by `inbox-webhook` right after an inbound message is
 * inserted. Best-effort throughout — a failure here must never break
 * message ingestion, so every branch is wrapped and logged, never thrown. */
export async function runInboxAutomation(supabase: SupabaseClient, conversationId: string, messageText: string): Promise<void> {
  try {
    const { data: conv } = await supabase
      .from('inbox_conversations')
      .select('id, workspace_id, account_id, platform, type, sender_name, snippet, needs_review')
      .eq('id', conversationId)
      .single();
    if (!conv) return;

    const rule = await findMatchingRule(supabase, conv as Conversation);
    if (!rule) return;

    const hitKeyword = matchesExcludedKeyword(messageText, rule.excluded_keywords ?? []);
    if (hitKeyword) {
      await supabase.from('inbox_conversations').update({ needs_review: true, updated_at: new Date().toISOString() }).eq('id', conversationId);
      await notifyReviewNeeded(supabase, conv as Conversation, rule, `Contains "${hitKeyword}" — automation paused, needs human review`);
      return;
    }

    if (rule.business_hours_only) {
      const { data: workspace } = await supabase.from('workspaces').select('timezone').eq('id', conv.workspace_id).maybeSingle();
      if (!withinBusinessHours(workspace?.timezone ?? null)) return;
    }

    const recentCount = await countRecentAutoReplies(supabase, conversationId);
    if (recentCount >= rule.max_auto_replies_per_day) {
      await supabase.from('inbox_conversations').update({ needs_review: true, updated_at: new Date().toISOString() }).eq('id', conversationId);
      await notifyReviewNeeded(supabase, conv as Conversation, rule, 'Auto-reply limit reached for this conversation — needs human review');
      return;
    }

    const reply = await generateReply(supabase, rule, conv as Conversation, messageText);
    if (!reply) return;

    if (rule.mode === 'auto_send') {
      await sendInboxReply(supabase, { conversation_id: conversationId, content: reply, is_ai: true, user_id: rule.created_by });
      await supabase.from('activity').insert({
        workspace_id: conv.workspace_id,
        user_id: rule.created_by,
        type: 'inbox_auto_reply',
        description: `AI auto-replied to a ${(conv as Conversation).type} on ${(conv as Conversation).platform}`,
        metadata: { conversation_id: conversationId },
      });
    } else {
      await supabase
        .from('inbox_conversations')
        .update({ metadata: { ai_draft: reply }, updated_at: new Date().toISOString() })
        .eq('id', conversationId);
      if (rule.created_by) {
        await supabase.from('notifications').insert({
          workspace_id: conv.workspace_id,
          user_id: rule.created_by,
          type: 'ai_event',
          title: 'AI reply ready for review',
          message: `A draft reply is ready for ${(conv as Conversation).sender_name ?? 'a conversation'} on ${(conv as Conversation).platform}.`,
          metadata: { conversation_id: conversationId },
        });
      }
    }
  } catch (err) {
    console.error('inbox automation failed:', err instanceof Error ? err.message : err);
  }
}

async function notifyReviewNeeded(supabase: SupabaseClient, conv: Conversation, rule: AutomationRule, reason: string): Promise<void> {
  if (!rule.created_by) return;
  await supabase.from('notifications').insert({
    workspace_id: conv.workspace_id,
    user_id: rule.created_by,
    type: 'ai_event',
    title: 'Conversation needs review',
    message: reason,
    metadata: { conversation_id: conv.id },
  });
}
