import { postRepository } from '@/repositories/postRepository';
import type { Post, PostStatus } from '@/types/social';

/**
 * مراحل سير العمل التي لا يعبّر عنها حقل posts.status وحده. تبقى الحالة
 * القابلة للنشر في status الحالي، بينما تحفظ هذه المرحلة السياق الذي يحتاجه
 * المستخدم لمتابعة المحتوى من التوليد حتى النشر.
 */
export type ContentWorkflowStage = 'generated' | 'editing' | 'in_review' | 'approved';

export type PersistGeneratedContentInput = {
  workspaceId: string;
  content: string;
  platforms?: string[];
  title?: string;
  mediaUrls?: string[];
  /** وقت مقترح أو مؤكد للجدولة، من دون تغيير حالة المسودة تلقائيًا. */
  scheduledFor?: string | null;
  source: string;
  sourceLabel?: string;
  stage?: ContentWorkflowStage;
  quality?: unknown;
  needsReview?: boolean;
  platformVariants?: Record<string, string> | null;
  metadata?: Record<string, unknown>;
};

export type UpdateGeneratedContentInput = Partial<
  Pick<
    PersistGeneratedContentInput,
    'content' | 'platforms' | 'title' | 'mediaUrls' | 'scheduledFor' | 'source' | 'sourceLabel' | 'stage' | 'quality' | 'needsReview' | 'platformVariants' | 'metadata'
  >
> & {
  status?: PostStatus;
};

function workflowMetadata(input: PersistGeneratedContentInput | UpdateGeneratedContentInput, existing?: Record<string, unknown>) {
  const existingWorkflow = (existing?.content_workflow ?? {}) as Record<string, unknown>;
  const qualityStatus = input.stage ?? (input.needsReview ? 'in_review' : existingWorkflow.quality_status ?? 'generated');

  const incomingMetadata = input.metadata ?? {};
  const existingAssistant = (existing?.assistant ?? {}) as Record<string, unknown>;
  const incomingAssistant = (incomingMetadata.assistant ?? {}) as Record<string, unknown>;

  return {
    ...existing,
    ...incomingMetadata,
    ...(Object.keys(existingAssistant).length || Object.keys(incomingAssistant).length
      ? { assistant: { ...existingAssistant, ...incomingAssistant } }
      : {}),
    content_workflow: {
      ...existingWorkflow,
      source: input.source ?? existingWorkflow.source ?? 'ai_generation',
      source_label: input.sourceLabel ?? existingWorkflow.source_label ?? input.source ?? 'AI generation',
      stage: input.stage ?? existingWorkflow.stage ?? 'generated',
      quality_status: qualityStatus,
      quality: input.quality ?? existingWorkflow.quality ?? null,
      needs_review: input.needsReview ?? existingWorkflow.needs_review ?? false,
      platform_variants: input.platformVariants ?? existingWorkflow.platform_variants ?? null,
      generated_at: existingWorkflow.generated_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
}

/**
 * المصدر الموحد لأي ناتج توليد يراد استكماله كمحتوى للنشر. لا ينشئ هذا
 * نموذجًا جديدًا أو مسار API جديدًا؛ بل يضيف مسودة إلى جدول posts القائم.
 */
export async function persistGeneratedContent(input: PersistGeneratedContentInput): Promise<Post> {
  return postRepository.create({
    workspace_id: input.workspaceId,
    title: input.title,
    content: input.content,
    platforms: input.platforms ?? [],
    media_urls: input.mediaUrls ?? [],
    scheduled_for: input.scheduledFor ?? null,
    status: 'draft',
    metadata: workflowMetadata(input),
  });
}

/**
 * يحافظ على معرف المحتوى نفسه عند اكتمال مراجعة الجودة أو التحسين، بحيث لا
 * تتحول كل خطوة إلى منشور جديد ولا تضيع علاقة المحتوى بسياق توليده.
 */
export async function updateGeneratedContent(
  postId: string,
  input: UpdateGeneratedContentInput,
): Promise<Post> {
  const current = await postRepository.get(postId);
  if (!current) throw new Error('Generated content record was not found');

  return postRepository.update(postId, {
    title: input.title ?? current.title,
    content: input.content ?? current.content,
    platforms: input.platforms ?? current.platforms,
    media_urls: input.mediaUrls ?? current.media_urls,
    status: input.status ?? current.status,
    scheduled_for: input.scheduledFor ?? current.scheduled_for,
    metadata: workflowMetadata(input, current.metadata),
  });
}

export function getContentWorkflow(post: Post) {
  return (post.metadata?.content_workflow ?? null) as {
    source?: string;
    source_label?: string;
    stage?: ContentWorkflowStage;
    quality_status?: ContentWorkflowStage;
    quality?: unknown;
    needs_review?: boolean;
    platform_variants?: Record<string, string> | null;
    generated_at?: string;
    updated_at?: string;
  } | null;
}
