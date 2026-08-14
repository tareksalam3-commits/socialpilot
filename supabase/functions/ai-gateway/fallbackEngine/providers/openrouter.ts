import { catalogFor } from '../../modelRegistry.ts';
import type { ProviderAdapter } from './types.ts';

// OpenRouter itself fronts several upstream hosts for most models.
// allow_fallbacks defaults to true, but we set it explicitly so this stays
// correct even if OpenRouter's default ever changes: if the upstream host
// currently serving this model errors out, OpenRouter silently retries the
// next host for the same model before we ever see a failure here.
export const openrouterAdapter: ProviderAdapter = {
  entry: catalogFor('openrouter'),
  shapeRequestBody: (body) => ({ ...body, provider: { allow_fallbacks: true } }),
};
