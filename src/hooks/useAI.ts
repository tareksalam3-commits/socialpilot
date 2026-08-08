import { useCallback, useState } from 'react';
import { aiGateway } from '@/services/aiGateway';
import { aiHistoryRepository } from '@/repositories/aiHistoryRepository';
import { brandVoiceRepository } from '@/repositories/brandVoiceRepository';
import type { BrandVoice, ChatMessage } from '@/types/ai';

type GenerateParams = {
  workspaceId: string;
  userId: string;
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  type?: string;
  onChunk?: (chunk: string) => void;
};

type GenerateState = {
  loading: boolean;
  error: string | null;
  result: string;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  responseTimeMs: number;
};

export function useAI() {
  const [state, setState] = useState<GenerateState>({
    loading: false,
    error: null,
    result: '',
    model: null,
    tokensIn: 0,
    tokensOut: 0,
    responseTimeMs: 0,
  });

  const generate = useCallback(async (params: GenerateParams): Promise<GenerateState> => {
    setState((s) => ({ ...s, loading: true, error: null, result: '' }));

    let brandVoice: BrandVoice | null = null;
    try {
      brandVoice = await brandVoiceRepository.get(params.workspaceId);
    } catch {
      // brand voice is optional
    }

    try {
      const result = await aiGateway.generate({
        workspaceId: params.workspaceId,
        messages: params.messages,
        model: params.model,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
        stream: true,
        freeOnly: true,
        brandVoice: brandVoice
          ? {
              business_name: brandVoice.business_name,
              description: brandVoice.description,
              audience: brandVoice.audience,
              industry: brandVoice.industry,
              writing_style: brandVoice.writing_style,
              tone: brandVoice.tone,
              keywords: brandVoice.keywords,
              negative_keywords: brandVoice.negative_keywords,
              cta_style: brandVoice.cta_style,
              emoji_style: brandVoice.emoji_style,
            }
          : null,
        onChunk: params.onChunk,
      });

      const finalState: GenerateState = {
        loading: false,
        error: null,
        result: result.content,
        model: result.model,
        tokensIn: result.tokens_in,
        tokensOut: result.tokens_out,
        responseTimeMs: result.response_time_ms,
      };
      setState(finalState);

      try {
        await aiHistoryRepository.create({
          workspace_id: params.workspaceId,
          type: params.type ?? 'chat',
          input: params.messages.map((m) => m.content).join('\n\n'),
          output: result.content,
          model: result.model,
          tokens_in: result.tokens_in,
          tokens_out: result.tokens_out,
          response_time_ms: result.response_time_ms,
          status: 'success',
        });
      } catch {
        // history recording is best-effort
      }

      return finalState;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Generation failed';
      setState({ loading: false, error: errorMsg, result: '', model: null, tokensIn: 0, tokensOut: 0, responseTimeMs: 0 });

      try {
        await aiHistoryRepository.create({
          workspace_id: params.workspaceId,
          type: params.type ?? 'chat',
          input: params.messages.map((m) => m.content).join('\n\n'),
          output: null,
          model: params.model ?? null,
          status: 'failed',
        });
      } catch {
        // best-effort
      }

      return { loading: false, error: errorMsg, result: '', model: null, tokensIn: 0, tokensOut: 0, responseTimeMs: 0 };
    }
  }, []);

  return { ...state, generate };
}
