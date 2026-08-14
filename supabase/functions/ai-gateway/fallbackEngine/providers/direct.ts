import { catalogFor } from '../../modelRegistry.ts';
import { identityAdapter } from './types.ts';

// "Direct APIs" is a bring-your-own-endpoint slot: whoever configures this
// provider in AI Providers supplies both the api key and a base_url (e.g.
// https://api.openai.com/v1, an Anthropic/Gemini OpenAI-compat shim, or a
// self-hosted vLLM/Ollama endpoint) — see providerRouter.ts, which always
// prefers keyRow.base_url over the catalog default for every provider.
// No request-shape quirks beyond that.
export const directAdapter = identityAdapter(catalogFor('direct'));
