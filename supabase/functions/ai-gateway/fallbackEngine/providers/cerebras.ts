import { catalogFor } from '../../modelRegistry.ts';
import { identityAdapter } from './types.ts';

// No request-shape quirks for this provider — plain OpenAI-compatible
// chat/completions, same as the default handling in fallbackEngine.
export const cerebrasAdapter = identityAdapter(catalogFor('cerebras'));
