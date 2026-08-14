import type { AiProvider } from '../../modelRegistry.ts';
import type { ProviderAdapter } from './types.ts';
import { openrouterAdapter } from './openrouter.ts';
import { groqAdapter } from './groq.ts';
import { cerebrasAdapter } from './cerebras.ts';
import { nvidiaAdapter } from './nvidia.ts';
import { mistralAdapter } from './mistral.ts';
import { zaiAdapter } from './zai.ts';
import { huggingfaceAdapter } from './huggingface.ts';
import { directAdapter } from './direct.ts';

const ADAPTERS: Record<AiProvider, ProviderAdapter> = {
  openrouter: openrouterAdapter,
  groq: groqAdapter,
  cerebras: cerebrasAdapter,
  nvidia: nvidiaAdapter,
  mistral: mistralAdapter,
  zai: zaiAdapter,
  huggingface: huggingfaceAdapter,
  direct: directAdapter,
};

export function adapterFor(providerId: AiProvider): ProviderAdapter {
  return ADAPTERS[providerId];
}

export type { ProviderAdapter };
