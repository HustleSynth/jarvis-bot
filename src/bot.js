import mineflayer from 'mineflayer';

// ✅ Correct import for CommonJS module
import mineflayerPathfinder from 'mineflayer-pathfinder';
const { pathfinder } = mineflayerPathfinder;

import { plugin as collectBlockPlugin } from 'mineflayer-collectblock';
import { registerCommands } from './commands.js';
import { enableAutonomousBrain } from './autonomy.js';

function randomDelay(min, max) {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

function sendClientBrand(bot, logger, sessionConfig) {
  if (!sessionConfig?.enableClientBrand) return;
  const brand = sessionConfig.clientBrand || 'vanilla';
  try {
    if (bot._client?.writeChannel) {
      bot._client.writeChannel('minecraft:brand', Buffer.from(brand, 'utf8'));
    } else if (bot._client?.write) {
      bot._client.write('custom_payload', {
        channel: 'minecraft:brand',
        data: Buffer.from(brand, 'utf8'),
      });
    }
    logger.debug(`Sent client brand handshake as "${brand}"`);
  } catch (error) {
    logger.warn(`Failed to send client brand handshake: ${error.message}`);
  }
}

function sendClientSettings(bot, logger, sessionConfig) {
  if (!sessionConfig?.sendClientSettings) return;
  try {
    bot._client?.write('client_information', {
      locale: 'en_US',
      viewDistance: bot.viewDistance ?? 10,
      chatMode: 0,
      chatColors: true,
      displayedSkinParts: 0x7f,
      mainHand: 1,
      enableTextFiltering: false,
      allowServerListings: true,
    });
    logger.debug('Sent vanilla-like client settings.');
  } catch (error) {
    logger.warn(`Failed to send client settings: ${error.message}`);
  }
}

function queueHumanLikeChat(bot, message, behaviorConfig) {
  const min = behaviorConfig?.humanChatDelay?.min ?? 800;
  const max = behaviorConfig?.humanChatDelay?.max ?? 2400;
  const delay = randomDelay(min, max);
  setTimeout(() => {
    if (!bot.chat) return;
    bot.chat(message);
  }, delay);
}

export function createBot(botConfig, aiController, behaviorConfig, sessionConfig, logger) {
  const bot = mineflayer.createBot({
    host: botConfig.host,
    port: botConfig.port,
    username: botConfig.username,
    password: botConfig.password,
    auth: botConfig.auth,
    version: botConfig.version,
    viewDistance: botConfig.viewDistance,
  });

  // ✅ Load the plugins using the fixed import
  bot.loadPlugin(pathfinder);
  bot.loadPlugin(collectBlockPlugin);

  /**
   * -----------------------------------------------------------------------
   * PATCH: Provide compatibility shims and resource‑pack handling
   *
   * Some versions of minecraft-protocol removed the `chat()` helper on the
   * underlying client. Mineflayer’s chat plugin still calls
   * `bot._client.chat()`, which will crash if it’s undefined. To avoid
   * TypeError: `bot._client.chat is not a function`, we polyfill the
   * method with a simple wrapper around the generic packet sender. The
   * `chat` packet name is valid for vanilla 1.20+, but if you’re targeting
   * older protocol versions you may need to adjust the packet name. This
   * shim preserves existing behavior without modifying the library.
   */
  if (typeof bot._client.chat !== 'function') {
    bot._client.chat = (message) => {
      // Fallback: send the chat message directly through the client
      try {
        bot._client.write('chat', { message });
      } catch (err) {
        logger.warn(`Failed to send chat via fallback: ${err.message}`);
      }
    };
  }

  /**
   * Handle server‑sent resource packs automatically. Mineflayer exposes a
   * `resourcePack` event which fires whenever the server offers a pack.
   * Calling `bot.acceptResourcePack()` tells the server you will download
   * and apply the pack; Mineflayer then downloads it and sends the
   * appropriate status codes (accepted and successfully loaded). This
   * approach avoids connection stalls and ECONNABORTED errors on servers
   * like Aternos.
   */
  bot.on('resourcePack', (url, hash) => {
    // Log the request and delegate downloading to mineflayer
    logger.info(`Server requested resource pack ${url}. Accepting and downloading...`);
    try {
      // acceptResourcePack() is synchronous in some mineflayer versions.
      // It returns void rather than a Promise, so calling .catch() will
      // throw a TypeError. Wrap the call in try/catch instead.
      bot.acceptResourcePack();
    } catch (err) {
      logger.warn(`Failed to download resource pack: ${err.message}`);
    }
  });

  const autonomy = enableAutonomousBrain(bot, logger, behaviorConfig, aiController);
  const commandRegistry = registerCommands(bot, logger, aiController, behaviorConfig, autonomy);

  // Only send vanilla-like client settings on login. Avoid sending the
  // optional client brand handshake, which can cause write errors on some
  // servers (e.g. Aternos) and is not required for vanilla play.
  // When the bot logs in, do not send any optional client brand or settings.
  // Vanilla servers provide sensible defaults, and sending custom settings
  // can trigger aborted connections on some hosts. If you need specific
  // settings, adjust them via bot.options instead of custom packets.
  bot.once('login', () => {
    logger.debug('Logged in; skipping client brand and settings handshakes.');
  });

  bot.once('spawn', () => {
    logger.info(`Spawned at ${bot.entity.position}`);
    if (aiController?.enabled) {
      aiController.appendHistory('system', 'Bot spawned in the world.');
    }

    autonomy?.pause?.(behaviorConfig?.autonomous?.idlePauseMs ?? 15000);

    if (behaviorConfig?.auth?.enabled) {
      const { auth } = behaviorConfig;
      const messagesToSend = [];
      if (auth.autoRegister && auth.registerCommand) {
        messagesToSend.push(auth.registerCommand);
      }
      if (auth.autoLogin && auth.loginCommand) {
        messagesToSend.push(auth.loginCommand);
      }
      messagesToSend.forEach((command, index) => {
        const delay = randomDelay(2500 + index * 1200, 5000 + index * 1800);
        setTimeout(() => {
          queueHumanLikeChat(bot, command, behaviorConfig);
        }, delay);
      });
    }
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    logger.info(`${username}: ${message}`);
    if (aiController?.enabled && !message.startsWith('!')) {
      aiController.appendHistory('user', `${username}: ${message}`);
    }
    if (message.toLowerCase().includes(bot.username.toLowerCase())) {
      autonomy?.pause?.(behaviorConfig?.autonomous?.idlePauseMs ?? 15000);
    }
    commandRegistry.executeCommand(username, message);
  });

  bot.on('whisper', async (username, message) => {
    if (username === bot.username) return;
    if (!aiController?.enabled) return;
    autonomy?.pause?.(behaviorConfig?.autonomous?.idlePauseMs ?? 15000);
    aiController.appendHistory('user', `whisper from ${username}: ${message}`);
    const response = await aiController.chat(message, `Bot position: ${bot.entity.position}`);
    bot.whisper(username, response);
  });

  bot.on('goal_reached', (goal) => {
    logger.info(`Reached goal ${JSON.stringify(goal)}`);
    bot.chat('I have arrived at my destination.');
  });

  bot.on('health', () => {
    if (bot.health < 10) {
      logger.warn(`Low health: ${bot.health}`);
    }
  });

  bot.on('error', (error) => {
    logger.error('Bot encountered an error', error);
  });

  bot.on('end', (reason) => {
    logger.warn(`Bot disconnected: ${reason}`);
  });

  return bot;
}