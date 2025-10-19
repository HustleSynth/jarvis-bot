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

const logger = createLogger(logConfig.level, logConfig);

const MAX_RECONNECT_DELAY_MS = 60_000;
const BASE_RECONNECT_DELAY_MS = 2_000;

async function main() {
  const aiController = new AiController(aiConfig, logger);

  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let currentBot = null;

  const scheduleReconnect = (reasonText, meta = {}) => {
    const { type = 'disconnect' } = meta ?? {};
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    reconnectAttempts += 1;
    const backoffFactor = Math.min(reconnectAttempts - 1, 6);
    const delay = Math.min(
      MAX_RECONNECT_DELAY_MS,
      BASE_RECONNECT_DELAY_MS * 2 ** backoffFactor,
    );
    const reasonSuffix = reasonText ? ` (${reasonText})` : '';
    logger.server?.(
      `Connection ${type}${reasonSuffix}. Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${reconnectAttempts}).`,
    );

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      startBot();
    }, delay);
  };

  const startBot = () => {
    if (currentBot) {
      try {
        currentBot.removeAllListeners();
      } catch (err) {
        // ignore cleanup errors
      }
    }

    try {
      currentBot = createBot(botConfig, aiController, behaviorConfig, sessionConfig, logger, {
        onSpawn: () => {
          reconnectAttempts = 0;
          logger.server?.('Connection stable: bot spawned successfully.');
        },
        onDisconnect: (reasonText, meta) => {
          scheduleReconnect(reasonText, meta);
        },
      });
    } catch (error) {
      logger.error('Failed to create bot instance', error);
      scheduleReconnect(error?.message ?? 'creation failure', { type: 'startup-error' });
    }
  };

  startBot();
}

main().catch((error) => {
  logger.error('Failed to start bot', error);
  process.exitCode = 1;
});
