import type { Express } from 'express';
import type { RecommendationService } from './service.js';
import { aiSelectionSchema } from '../../shared/recommendations.js';

export function registerRecommendationRoutes(app: Express, service: RecommendationService): void {
  app.get('/api/ai/status', (_req, res) => res.json(service.configuration.status));
  app.get('/api/ai/models', async (_req, res) => res.json(await service.localModels()));
  app.post('/api/ai/check', async (req, res) => {
    const status = await service.check(aiSelectionSchema.parse(req.body ?? {}));
    res.json({ ...status, message: 'Model access verified. No watchlist data was sent by this connection check.' });
  });
  app.get('/api/libraries/:id/recommendation-context', (req, res) => res.json(service.context(req.params.id)));
  app.post('/api/recommendations', async (req, res) => res.json(await service.recommend(req.body)));
}
