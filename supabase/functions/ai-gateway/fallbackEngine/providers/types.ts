import type { ProviderCatalogEntry } from '../../modelRegistry.ts';

// A provider adapter under the Fallback Engine. Every provider speaks the
// same OpenAI-compatible /chat/completions shape (that's what makes
// fallback between them possible at all) — an adapter only needs to exist
// where a provider deviates from the default request shape. Providers with
// no quirks just export their catalog entry and the identity shaper.
export type ProviderAdapter = {
  entry: ProviderCatalogEntry;
  // Lets a provider add fields to the outgoing chat/completions body
  // (e.g. OpenRouter's `provider.allow_fallbacks`). Most providers don't
  // need this and just return `body` unchanged.
  shapeRequestBody: (body: Record<string, unknown>) => Record<string, unknown>;
};

export function identityAdapter(entry: ProviderCatalogEntry): ProviderAdapter {
  return { entry, shapeRequestBody: (body) => body };
}
