import { resolve } from 'node:path';
import { z } from 'zod';
import { configureAi, selectAi } from '../server/recommendations/config.js';
import { LocalRecommendationProvider } from '../server/recommendations/local.js';
import { RecommendationService } from '../server/recommendations/service.js';
import { LibraryStore } from '../server/storage.js';
import { recommendationPreferencesSchema } from '../shared/recommendations.js';
import { ApiError } from '../server/upstream.js';

// --recommend explicitly authorizes sending the selected real library sample.
// Without it, this checks model access only and sends no watchlist data.
const args = process.argv.slice(2).filter(arg => arg !== '--');
let configuration = configureAi(process.env);
let store: LibraryStore | undefined;
try {
  if (args.includes('--local')) {
    const local = configuration.local;
    if (!local?.settings) throw new ApiError('LOCAL_AI_CONFIG', local?.message || 'Local inference is not configured.', 503);
    const available = await new LocalRecommendationProvider(local.settings, '').models(AbortSignal.timeout(15000));
    console.log('Local model discovery: PASS', JSON.stringify({ models: available }));
    const model = args.find(arg => arg.startsWith('--model='))?.slice('--model='.length) ?? local.model;
    if (!model) throw new ApiError('LOCAL_MODEL_UNAVAILABLE', 'Choose an actual discovered model with --model=ID or LOCAL_AI_MODEL.', 400);
    configuration = { ...configuration, ...selectAi(configuration, { mode: 'local', model }), local: { ...local, model } };
  }
  if (!configuration.provider) throw new ApiError('AI_NOT_CONFIGURED', configuration.status.message, 503);
  await configuration.provider.verify(AbortSignal.timeout(15000));
  console.log(`Model access: PASS (${configuration.status.provider}, ${configuration.status.model})`);
  if (args.includes('--probe')) {
    const reply = await configuration.provider.generate({
      system: 'This is an API connectivity check. Return only {"ready":true}.',
      data: { task: 'Confirm the API can generate JSON.' }, schema: { type: 'object', properties: { ready: { type: 'boolean' } }, required: ['ready'], additionalProperties: false },
      signal: AbortSignal.timeout(configuration.status.timeoutMs ?? 45000),
    });
    z.strictObject({ ready: z.literal(true) }).parse(reply);
    console.log('Real JSON generation: PASS (no watchlist data sent)');
  }
  if (args.includes('--recommend')) {
    store = new LibraryStore(resolve(process.env.ANIPICK_DB_PATH ?? 'data/anipick.sqlite'));
    const id = args.find(arg => arg.startsWith('--library='))?.slice('--library='.length) ?? store.list()[0]?.id;
    if (!id) throw new ApiError('NO_LIBRARY', 'Import your real list in AniPick first, then rerun with --recommend.', 400);
    const service = new RecommendationService(store, configuration);
    const result = await service.recommend({ libraryId: id, preferences: recommendationPreferencesSchema.parse({}), allowCloudProcessing: true });
    console.log('Real recommendations: PASS', JSON.stringify({ model: result.model, returned: result.recommendations.length, cached: result.cached, profileCached: result.profileCached, coverage: result.coverage }));
    console.log('Read the generated profile and explanations in Pick for Me with No limit / Open to anything.');
  } else {
    console.log('Watchlist inference: NOT RUN. Use --recommend to authorize analysis of a saved library.');
  }
} catch (error) {
  console.error(error instanceof ApiError ? `${error.code}: ${error.message}` : 'AI verification failed: the response did not satisfy the expected contract. No raw provider response is printed.');
  process.exitCode = 1;
} finally { store?.close(); }
