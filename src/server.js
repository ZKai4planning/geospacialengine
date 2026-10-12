import { config } from './config.js';
import { logger } from './utils/logger.js';
import { createApp } from './app.js';

const app = createApp();
const server = app.listen(config.port, () => logger.info(`Planning engine on http://localhost:${config.port} (${config.mode} mode)`));

const shutdown = (sig) => {
  logger.info(`${sig} received, closing`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
