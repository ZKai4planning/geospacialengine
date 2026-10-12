import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { createContainer } from './container.js';
import { addressRoutes } from './routes/address.js';
import { applicationRoutes } from './routes/applications.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { listWorkTypes } from './services/workTypes.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp(container = createContainer()) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: { directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(), 'upgrade-insecure-requests': null } },
  }));
  app.use(cors(config.corsOrigins.length ? { origin: config.corsOrigins } : { origin: false }));
  app.use(express.json({ limit: '50kb' }));

  const limiter = (limit) => rateLimit({ windowMs: 60_000, limit, standardHeaders: true, legacyHeaders: false });
  app.use('/api', limiter(300));
  app.use('/api/address', limiter(90)); // type-ahead is the chattiest endpoint

  app.get('/health', (req, res) => res.json({
    status: 'ok', mode: config.mode,
    providers: { address: container.providers.address.name, aerial: container.providers.aerial.name, streetView: container.providers.streetView.name },
  }));
  app.get('/api/work-types', (req, res) => res.json({ types: listWorkTypes() }));
  app.use('/api/address', addressRoutes(container));
  app.use('/api/applications', applicationRoutes(container));
  app.use(express.static(publicDir));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
