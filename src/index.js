import {
  aiConfig,
  behaviorConfig,
  botConfig,
  logConfig,
  sessionConfig,
} from './config.js';
import { createLogger } from './logger.js';
import { AiController } from './ai.js';
import { createBot } from './bot.js';

const logger = createLogger(logConfig.level);

async function main() {
  const aiController = new AiController(aiConfig, logger);
  createBot(botConfig, aiController, behaviorConfig, sessionConfig, logger);
}

main().catch((error) => {
  logger.error('Failed to start bot', error);
  process.exitCode = 1;
});
