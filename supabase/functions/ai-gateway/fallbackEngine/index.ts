// Fallback Engine — given an already-built provider chain and a chat
// request, this is what actually calls providers in order (openrouter,
// groq, cerebras, nvidia, mistral, zai, huggingface, direct — see
// ./providers/), trying multiple models per provider where relevant,
// probing streamed responses for real content before committing to them,
// and handing off every outcome (success or exhaustion) to the Cost
// Controller to log. Nothing upstream of this module needs to know how
// providers differ from each other.

import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { corsHeaders, jsonResponse, errorResponse, fetchWithTimeout, delay, estimateTokens, isHardFailure, isTransientFailure, isEchoOfPrompt, stripReasoningLeak } from '../http.ts';
import { fetchModels, pickFreeModels, authHeaders, type AiProvider, type ProviderKeyRow, type ModelInfo } from '../modelRegistry.ts';
import { recordUsage, updateLastSuccessful, estimateCost } from '../costController.ts';
import { adapterFor } from './providers/index.ts';
import { probeStream } from './streamProbe.ts';

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_MODEL_ATTEMPTS_PER_PROVIDER = 3;
const RETRY_DELAY_MS = 600;

export type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string };

export type FallbackRunInput = {
  workspaceId: string;
  userId: string;
  chain: AiProvider[];
  preferredProvider: AiProvider;
  providerKeys: Map<AiProvider, ProviderKeyRow>;
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
  stream: boolean;
  freeOnly: boolean;
  modelSelection: 'auto' | 'manual';
  requestedModel?: string;
  // Quality Control Model Separation — when set (QC requests only), the
  // engine guarantees the model it actually attempts is never this one,
  // swapping to the next available model/provider instead. See taskRouter.ts.
  excludeModel?: string;
  lastSuccessfulProvider?: string | null;
  lastSuccessfulModel?: string | null;
};

export async function runChatFallback(
  supabase: ReturnType<typeof createClient>,
  input: FallbackRunInput,
): Promise<Response> {
  const { chain, preferredProvider, providerKeys, messages, temperature, maxTokens, stream, freeOnly } = input;

  if (chain.length === 0) {
    return errorResponse('No API key configured for any AI provider. Add one in AI Settings.', 400);
  }

  const startTime = Date.now();
  let lastError: string | null = null;

  for (const providerId of chain) {
    const adapter = adapterFor(providerId);
    const entry = adapter.entry;
    const keyRow = providerKeys.get(providerId)!;
    const isPreferred = providerId === preferredProvider;
    const requestedModel = isPreferred ? input.requestedModel : undefined;

    let modelsToTry: string[] = [];
    let freeModelsForCost: ModelInfo[] | null = null;

    if (input.modelSelection === 'auto' && providerId === 'openrouter' && freeOnly && (!requestedModel || requestedModel === 'openrouter/auto')) {
      try {
        const allModels = await fetchModels(entry, keyRow);
        const freeModels = pickFreeModels(allModels);
        freeModelsForCost = allModels;
        const lastGood = input.lastSuccessfulProvider === 'openrouter' ? input.lastSuccessfulModel : null;
        if (lastGood && freeModels.some((m) => m.id === lastGood)) {
          modelsToTry = [lastGood, ...freeModels.map((m) => m.id).filter((id) => id !== lastGood)];
        } else {
          modelsToTry = freeModels.map((m) => m.id);
        }
      } catch {
        // fall back to the provider default below
      }
      if (modelsToTry.length === 0) modelsToTry = [entry.default_model];
    } else if (requestedModel) {
      modelsToTry = [requestedModel];
    } else if (input.lastSuccessfulProvider === providerId && input.lastSuccessfulModel) {
      modelsToTry = [input.lastSuccessfulModel, entry.default_model];
    } else {
      modelsToTry = [entry.default_model];
    }

    // Quality Control Model Separation — never let the excluded (authoring)
    // model be one of the ones actually attempted on this provider. If that
    // empties the list for this provider (e.g. its only usable model IS the
    // authoring model), the outer loop simply moves on to the next
    // configured provider instead of silently falling back to it.
    if (input.excludeModel) {
      modelsToTry = modelsToTry.filter((m) => m !== input.excludeModel);
      if (modelsToTry.length === 0 && entry.default_model !== input.excludeModel) {
        modelsToTry = [entry.default_model];
      }
    }

    const attempts = modelsToTry.slice(0, MAX_MODEL_ATTEMPTS_PER_PROVIDER);

    for (const currentModel of attempts) {
      try {
        const requestBody = adapter.shapeRequestBody({ model: currentModel, messages, temperature, max_tokens: maxTokens, stream });
        const res = await fetchWithTimeout(
          `${keyRow.base_url || entry.base_url}/chat/completions`,
          {
            method: 'POST',
            headers: authHeaders(entry, keyRow.api_key_encrypted!),
            body: JSON.stringify(requestBody),
          },
          REQUEST_TIMEOUT_MS,
        );

        if (!res.ok) {
          const errText = await res.text();
          lastError = `${entry.label} ${res.status}: ${errText}`;
          if (isTransientFailure(res.status)) {
            await delay(RETRY_DELAY_MS);
            continue; // try the next model on this same provider
          }
          if (isHardFailure(res.status)) break; // dead key/quota — jump to the next provider
          continue;
        }

        const responseTime = Date.now() - startTime;

        if (stream) {
          const reader = res.body!.getReader();
          const probe = await probeStream(reader);

          if (!probe.ok) {
            // Looked fine at the HTTP level but produced nothing usable —
            // abandon this attempt and fall through to the next model /
            // provider exactly like a hard HTTP failure would. The client
            // never received a byte of this attempt.
            try {
              await reader.cancel();
            } catch {
              // already closed — fine
            }
            lastError = `${entry.label} ${currentModel}: ${probe.error}`;
            await delay(RETRY_DELAY_MS);
            continue;
          }

          if (isEchoOfPrompt(probe.leadingText, messages)) {
            // The model handed the prompt straight back instead of writing
            // a post — this happens with models that aren't actually tuned
            // for instruction-following/chat. Same treatment as an empty
            // stream: nothing was sent to the client yet, so it's safe to
            // abandon this attempt and try the next model/provider.
            try {
              await reader.cancel();
            } catch {
              // already closed — fine
            }
            lastError = `${entry.label} ${currentModel}: model echoed the prompt instead of generating content`;
            await delay(RETRY_DELAY_MS);
            continue;
          }

          const readableStream = new ReadableStream({
            async start(controller) {
              const decoder = new TextDecoder();
              let totalContent = '';
              try {
                for (const chunk of probe.leadingChunks) {
                  totalContent += decoder.decode(chunk, { stream: true });
                  controller.enqueue(chunk);
                }
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  totalContent += decoder.decode(value, { stream: true });
                  controller.enqueue(value);
                }
              } catch (e) {
                controller.error(e);
                return;
              }
              controller.close();
              const tokensOut = estimateTokens(totalContent);
              const tokensIn = estimateTokens(JSON.stringify(messages));
              await updateLastSuccessful(supabase, providerId, currentModel);
              await recordUsage(supabase, input.workspaceId, input.userId, {
                model: currentModel,
                provider: providerId,
                tokens_in: tokensIn,
                tokens_out: tokensOut,
                cost: estimateCost(currentModel, tokensIn, tokensOut, freeModelsForCost),
                status: 'success',
                response_time_ms: responseTime,
                prompt_type: 'chat',
              });
            },
          });
          return new Response(readableStream, {
            headers: {
              ...corsHeaders,
              'Content-Type': 'text/event-stream',
              'X-Model': currentModel,
              'X-Provider': providerId,
              'X-Response-Time': String(responseTime),
            },
          });
        }

        const json = await res.json();
        // Reasoning models leak their <think>...</think> internal monologue
        // straight into message.content (no separate field to filter out) —
        // strip it here so a raw "thinking" dump never becomes the post body.
        const content = stripReasoningLeak(json.choices?.[0]?.message?.content ?? '');

        if (!content.trim()) {
          // 200 OK but nothing usable in it — same story as the streaming
          // path: don't hand this back as a "success", try the next model.
          lastError = `${entry.label} ${currentModel}: empty response content`;
          await delay(RETRY_DELAY_MS);
          continue;
        }

        if (isEchoOfPrompt(content, messages)) {
          // The model just handed the prompt back instead of writing a
          // post — not a real generation, don't hand it to the client as
          // one. Try the next model/provider instead.
          lastError = `${entry.label} ${currentModel}: model echoed the prompt instead of generating content`;
          await delay(RETRY_DELAY_MS);
          continue;
        }
        const tokensIn = json.usage?.prompt_tokens ?? estimateTokens(JSON.stringify(messages));
        const tokensOut = json.usage?.completion_tokens ?? estimateTokens(content);
        await updateLastSuccessful(supabase, providerId, currentModel);
        await recordUsage(supabase, input.workspaceId, input.userId, {
          model: currentModel,
          provider: providerId,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          cost: estimateCost(currentModel, tokensIn, tokensOut, freeModelsForCost),
          status: 'success',
          response_time_ms: responseTime,
          prompt_type: 'chat',
        });
        return jsonResponse({
          content,
          model: currentModel,
          provider: providerId,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          response_time_ms: responseTime,
        });
      } catch (e) {
        lastError = e instanceof Error ? e.message : 'Unknown error';
        continue; // network error / timeout — try the next model or provider
      }
    }
    // this provider's models are all exhausted — fall through to the next configured provider
  }

  const responseTime = Date.now() - startTime;
  if (input.userId) {
    await recordUsage(supabase, input.workspaceId, input.userId, {
      model: input.requestedModel || 'unknown',
      provider: preferredProvider,
      tokens_in: 0,
      tokens_out: 0,
      cost: 0,
      status: 'failed',
      response_time_ms: responseTime,
      prompt_type: 'chat',
    });
  }
  // Every provider/model in the fallback chain was exhausted — this is the
  // one case where there's genuinely nothing left to silently switch to.
  // The raw per-attempt error (provider name, HTTP status, upstream error
  // body) is only for debugging, so it's logged server-side, never sent to
  // the client: end users of this multi-tenant app should never see which
  // AI provider or model backs a request, including in a failure message.
  console.error(`ai-gateway: every provider failed for workspace ${input.workspaceId}: ${lastError}`);
  return errorResponse('تعذّر توليد الرد حاليًا. جرّب تاني بعد لحظات.', 502);
}
