import { postRepository } from '@/repositories/postRepository';
import type { Post, PostStatus } from '@/types/social';
import { buildQualityProof, isQualityProofValidForContent } from '@/utils/contentIntegrity';

export type ContentWorkflowStage = 'generated' | 'editing' | 'in_review' | 'approved';

export type PersistGeneratedContentInput = {
  workspaceId: string;
  content: string;
  platforms?: string[];
  title?: string;
  mediaUrls?: string[];
  scheduledFor?: string | null;
  source: string;
  sourceLabel?: string;
  stage?: ContentWorkflowStage;
  quality?: unknown;
  needsReview?: boolean;
  platformVariants?: Record<string, string> | null;
  metadata?: Record<string, unknown>;
  qualityProof?: Record<string, unknown> | null;
  contentHash?: string | null;
};

export type UpdateGeneratedContentInput = Partial<Pick<PersistGeneratedContentInput, 'content' | 'platforms' | 'title' | 'mediaUrls' | 'scheduledFor' | 'source' | 'sourceLabel' | 'stage' | 'quality' | 'needsReview' | 'platformVariants' | 'metadata' | 'qualityProof' | 'contentHash'>> & { status?: PostStatus };

function workflowMetadata(input: PersistGeneratedContentInput | UpdateGeneratedContentInput, existing?: Record<string, unknown>) {
  const existingWorkflow = (existing?.content_workflow ?? {}) as Record<string, unknown>;
  const qualityStatus = input.stage ?? (input.needsReview ? 'in_review' : existingWorkflow.quality_status ?? 'generated');
  const incomingMetadata = input.metadata ?? {};
  const existingAssistant = (existing?.assistant ?? {}) as Record<string, unknown>;
  const incomingAssistant = (incomingMetadata.assistant ?? {}) as Record<string, unknown>;
  return {
    ...existing,
    ...incomingMetadata,
    ...(Object.keys(existingAssistant).length || Object.keys(incomingAssistant).length ? { assistant: { ...existingAssistant, ...incomingAssistant } } : {}),
    content_workflow: {
      ...existingWorkflow,
      source: input.source ?? existingWorkflow.source ?? 'ai_generation',
      source_label: input.sourceLabel ?? existingWorkflow.source_label ?? input.source ?? 'AI generation',
      stage: input.stage ?? existingWorkflow.stage ?? 'generated',
      quality_status: qualityStatus,
      quality: input.quality ?? existingWorkflow.quality ?? null,
      needs_review: input.needsReview ?? existingWorkflow.needs_review ?? false,
      platform_variants: input.platformVariants ?? existingWorkflow.platform_variants ?? null,
      content_hash: input.contentHash ?? existingWorkflow.content_hash ?? null,
      quality_proof: input.qualityProof ?? existingWorkflow.quality_proof ?? null,
      generated_at: existingWorkflow.generated_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
}

async function integrityFor(content: string, quality: unknown, platforms: string[], suppliedProof?: Record<string, unknown> | null) {
  if (suppliedProof && await isQualityProofValidForContent(content, suppliedProof)) return suppliedProof;
  if (!quality || typeof quality !== 'object') return null;
  return buildQualityProof(content, quality as Parameters<typeof buildQualityProof>[1], platforms[0]);
}

export async function persistGeneratedContent(input: PersistGeneratedContentInput): Promise<Post> {
  const platforms = input.platforms ?? [];
  const proof = await integrityFor(input.content, input.quality, platforms, input.qualityProof);
  return postRepository.create({
    workspace_id: input.workspaceId,
    title: input.title,
    content: input.content,
    platforms,
    media_urls: input.mediaUrls ?? [],
    scheduled_for: input.scheduledFor ?? null,
    status: 'draft',
    metadata: workflowMetadata({ ...input, contentHash: proof ? String(proof.content_hash) : null, qualityProof: proof }, undefined),
    content_hash: proof ? String(proof.content_hash) : null,
    quality_proof: proof,
  });
}

export async function updateGeneratedContent(postId: string, input: UpdateGeneratedContentInput): Promise<Post> {
  const current = await postRepository.get(postId);
  if (!current) throw new Error('Generated content record was not found');
  const content = input.content ?? current.content;
  const platforms = input.platforms ?? current.platforms;
  const proof = await integrityFor(content, input.quality, platforms, input.qualityProof);
  const contentHash = proof ? String(proof.content_hash) : null;
  return postRepository.update(postId, {
    title: input.title ?? current.title,
    content,
    platforms,
    media_urls: input.mediaUrls ?? current.media_urls,
    status: input.status ?? current.status,
    scheduled_for: input.scheduledFor ?? current.scheduled_for,
    metadata: workflowMetadata({ ...input, contentHash, qualityProof: proof }, current.metadata),
    content_hash: contentHash,
    quality_proof: proof,
  });
}

export function getContentWorkflow(post: Post) {
  return (post.metadata?.content_workflow ?? null) as {
    source?: string; source_label?: string; stage?: ContentWorkflowStage; quality_status?: ContentWorkflowStage;
    quality?: unknown; needs_review?: boolean; platform_variants?: Record<string, string> | null;
    content_hash?: string | null; quality_proof?: Record<string, unknown> | null; generated_at?: string; updated_at?: string;
  } | null;
}
