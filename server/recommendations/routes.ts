import type { Express } from 'express';
import type { RecommendationService } from './service.js';

export function registerRecommendationRoutes(app: Express, service: RecommendationService): void {
  app.get('/api/ai/status', (_req, res) => res.json(service.configuration.status));
  app.post('/api/ai/check', async (_req, res) => {
    await service.check();
    res.json({ ...service.configuration.status, message: 'Model access verified. No watchlist data was sent by this connection check.' });
  });
  app.get('/api/libraries/:id/recommendation-context', (req, res) => res.json(service.context(req.params.id)));
  app.post('/api/recommendations', async (req, res) => res.json(await service.recommend(req.body)));
}
