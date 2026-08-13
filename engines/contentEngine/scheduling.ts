import { postRepository } from '@/repositories/postRepository';
import type { CampaignPlan } from '@/types/assistant';

/** The Publisher Agent's scheduling math — turns a cadence + start time into
 * one send time per post. Pure function, no AI call needed. */
export function computeScheduleTimes(plan: CampaignPlan, count: number): Date[] {
  const now = new Date();
  const [hh, mm] = plan.time_of_day.split(':').map((n) => parseInt(n, 10));
  let base = new Date(now);
  base.setHours(Number.isFinite(hh) ? hh : 9, Number.isFinite(mm) ? mm : 0, 0, 0);

  if (plan.start === 'now') {
    // "الآن" / "بعد 5 دقائق" — publish is never immediate; it's always
    // scheduled a few minutes out so the user gets a Preview + Approval
    // step before the existing Publishing Engine picks it up.
    base = new Date(now.getTime() + 5 * 60 * 1000);
  } else if (plan.start === 'tomorrow' || base <= now) {
    base.setDate(base.getDate() + 1);
  }

  const stepDays = plan.cadence === 'daily' ? 1 : plan.cadence === 'every_other_day' ? 2 : plan.cadence === 'weekly' ? 7 : 0;

  const times: Date[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    if (plan.cadence === 'once') {
      d.setMinutes(d.getMinutes() + i * 30);
    } else {
      d.setDate(d.getDate() + i * stepDays);
    }
    times.push(d);
  }
  return times;
}

/** The last lifecycle step, Verified: confirms every platform target for a
 * published post actually has a stored external (platform) post ID before
 * calling it done — reusing the same post_platform_targets rows the
 * Publishing Engine already wrote external_id/published_at into rather than
 * calling any platform API again. Returns false while any target is still
 * pending/publishing so the caller can keep polling. */
export async function verifyPost(postId: string): Promise<boolean> {
  const targets = await postRepository.getTargets(postId);
  if (targets.length === 0) return false;
  return targets.every((t) => t.status === 'published' && !!t.external_id);
}
