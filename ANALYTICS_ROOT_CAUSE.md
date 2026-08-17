# Analytics Root Cause — 2026-08-17

## Evidence from live Supabase project `iqbuedqugkpxqdrzhfzn`

The workspace `a274cb4b-dcde-4bba-8482-3a1c82607440` has three connected accounts in `social_accounts`: Facebook, Instagram, and LinkedIn.

`content` contains one record with status `published`: content id `7922109d-7e43-4505-82e1-2a8f4e72c153`, created on 2026-08-16.

The same content has a Facebook `calendar_items` row with status `published`, variant id `712ab5fc-b079-4efe-9a4d-b9d8e7bbaa90`.

However, the live `publishing_jobs` rows for the workspace are not `succeeded` and do not have `external_post_id`: one LinkedIn publish row is `running`, one Facebook publish row is `running`, and the Facebook schedule row is `queued`.

`audit_logs` contain actual publish-success evidence:

- Facebook variant `712ab5fc-b079-4efe-9a4d-b9d8e7bbaa90`: external post id `100268692506640_1078853964672516` at 2026-08-16 15:18:58 UTC.
- LinkedIn variant `7a7129e2-1ba7-4dcf-ad2e-be58ff562dff`: post id `urn:li:share:7494781003836801024` at 2026-08-16 15:43:58 UTC.

The live `post_insights` query returned no rows for the inspected workspace.

## Code-level cause

`analytics-sync` only selects `publishing_jobs` where `status = 'succeeded'`, requires `external_post_id IS NOT NULL`, and supports X, Facebook, and Instagram. It therefore ignores the two posts whose successful API evidence exists only in `audit_logs` while the current job rows are incorrectly left as `running`.

`AnalyticsScreen` separately counts only `publishing_jobs.status = 'succeeded'` and reads Metrics only from `post_insights`. It does not use `content.status` or `calendar_items.status` as proof of external publication, which is correct for avoiding false metrics but currently exposes the job-state inconsistency as an empty dashboard.

The immediate remediation must reconcile only jobs with verifiable `publish_succeeded` audit evidence and known post ids, then run platform APIs to fetch real metrics. It must not invent Metrics or mark a post published solely from `content`/`calendar_items` status.

## LinkedIn API contract reference

LinkedIn's official Member Post Statistics documentation states that `memberCreatorPostAnalytics` supports single-post lookup through `q=entity`, accepts a `share` or `ugcPost` URN, and returns lifetime metrics when no date range is provided. The documented metric types include `IMPRESSION`, `MEMBERS_REACHED`, `RESHARE`, `REACTION`, and `COMMENT`; access requires the `r_member_postAnalytics` permission. This is the correct contract to use for member-owned LinkedIn posts, rather than inventing metrics or treating Inbox messages as post analytics.

References:

[1]: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/members/post-statistics?view=li-lms-2026-07 LinkedIn Member Post Statistics
[2]: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/reactions-api?view=li-lms-2026-07 LinkedIn Reactions API
[3]: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/comments-api?view=li-lms-2026-07 LinkedIn Comments API

## إعادة المزامنة بعد الإصلاح — 2026-08-17

تم نشر `0022` وإصدارات `social-publish` و`analytics-sync` و`scheduler-tick` المعدلة، ثم فُتحت شاشة Analytics في الإنتاج. تعرض الشاشة حاليًا `عدد المحتوى المسجل في الفترة: 1` لكنها ما زالت تعرض `لا توجد Insights بعد` بعد الضغط على مزامنة، لذا يلزم فحص استجابة `analytics-sync` ونتائج `post_insights` بدل اعتبار الإصلاح مكتملًا من رسالة الواجهة وحدها.

لم تُستخدم أرقام تجريبية أو ثابتة.
