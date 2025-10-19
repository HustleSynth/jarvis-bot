import mineflayer from 'mineflayer';
import { pathfinder } from 'mineflayer-pathfinder';
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

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(collectBlockPlugin);

  const autonomy = enableAutonomousBrain(bot, logger, behaviorConfig, aiController);
  const commandRegistry = registerCommands(bot, logger, aiController, behaviorConfig, autonomy);

  bot.once('login', () => {
    sendClientBrand(bot, logger, sessionConfig);
    sendClientSettings(bot, logger, sessionConfig);
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
