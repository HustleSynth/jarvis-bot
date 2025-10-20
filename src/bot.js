import mineflayer from 'mineflayer';
import readline from 'node:readline';

// ✅ Correct import for CommonJS module
import mineflayerPathfinder from 'mineflayer-pathfinder';
const { pathfinder } = mineflayerPathfinder;

import { plugin as collectBlockPlugin } from 'mineflayer-collectblock';
import { registerCommands } from './commands.js';
import { enableAutonomousBrain } from './autonomy.js';

const COMMAND_TERMINAL_KEY = Symbol.for('jarvis.commandTerminal');

function createPromptScheduler(rl, outputStream, logger) {
  const stream = outputStream && typeof outputStream.once === 'function' ? outputStream : process.stdout;
  let closed = false;
  let pendingTimeout = null;
  let waitingForDrain = false;
  let drainTarget = null;
  let drainListener = null;
  let lastRefresh = Date.now();

  function runPrompt() {
    if (closed) return;
    try {
      rl.resume?.();
      rl.prompt(true);
      lastRefresh = Date.now();
    } catch (err) {
      logger?.command?.(`Prompt refresh failed: ${err?.message ?? err}`);
    }
  }

  function detachDrainListener() {
    if (!waitingForDrain) return;
    waitingForDrain = false;
    const target = drainTarget;
    drainTarget = null;
    if (!target || !drainListener) {
      drainListener = null;
      return;
    }
    if (typeof target.off === 'function') {
      target.off('drain', drainListener);
    } else if (typeof target.removeListener === 'function') {
      target.removeListener('drain', drainListener);
    }
    drainListener = null;
  }

  function schedule() {
    if (closed) return;
    if (pendingTimeout || waitingForDrain) return;

    const target = stream && typeof stream.once === 'function' ? stream : process.stdout;

    if (target?.writableNeedDrain) {
      waitingForDrain = true;
      drainTarget = target;
      drainListener = () => {
        detachDrainListener();
        if (closed) return;
        pendingTimeout = setTimeout(() => {
          pendingTimeout = null;
          runPrompt();
        }, 0);
      };
      target.once('drain', drainListener);
      return;
    }

    pendingTimeout = setTimeout(() => {
      pendingTimeout = null;
      runPrompt();
    }, 0);
  }

  function cancel() {
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      pendingTimeout = null;
    }
    detachDrainListener();
  }

  function flush() {
    cancel();
    runPrompt();
  }

  const keepAliveIntervalMs = 15000;
  const keepAliveTimer = setInterval(() => {
    if (closed) {
      clearInterval(keepAliveTimer);
      return;
    }
    if (Date.now() - lastRefresh >= keepAliveIntervalMs) {
      schedule();
    }
  }, Math.max(keepAliveIntervalMs / 3, 2000));

  function stop() {
    closed = true;
    cancel();
    clearInterval(keepAliveTimer);
  }

  return {
    schedule,
    cancel,
    flush,
    stop,
  };
}

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

function stripMinecraftFormatting(message) {
  if (typeof message !== 'string') {
    if (message === null || message === undefined) return '';
    return String(message).trim();
  }
  return message.replace(/§[0-9a-fklmnor]/gi, '').trim();
}

function collapseChatComponent(component) {
  if (component === null || component === undefined) return '';
  if (typeof component === 'string') return component;
  if (Buffer.isBuffer(component)) {
    return component.toString('utf8');
  }
  if (Array.isArray(component)) {
    return component.map((part) => collapseChatComponent(part)).join('');
  }
  if (typeof component === 'object') {
    const text = component.text ? String(component.text) : '';
    const extra = Array.isArray(component.extra)
      ? component.extra.map((part) => collapseChatComponent(part)).join('')
      : '';
    if (text || extra) {
      return text + extra;
    }
    try {
      return JSON.stringify(component);
    } catch (err) {
      return String(component);
    }
  }
  return String(component);
}

function formatDisconnectReason(reason) {
  const raw = collapseChatComponent(reason);
  const cleaned = stripMinecraftFormatting(raw);
  return cleaned || 'Unknown';
}

/**
 * Send registration and login commands after CAPTCHA is solved.
 * Many servers require the player to register and/or log in using
 * predetermined commands. If `behaviorConfig.auth.autoRegister` or
 * `autoLogin` is enabled and the corresponding commands are provided,
 * this helper will queue them once the CAPTCHA has been solved. It
 * respects the `authState` flags to avoid sending duplicates. Commands
 * are sent with a random human‑like delay using `queueHumanLikeChat`.
 */
function sendAuthCommandsIfNeeded(bot, authState, behaviorConfig, logger) {
  if (!behaviorConfig?.auth) return;
  const { auth } = behaviorConfig;
  const captchaRequired = auth.requireCaptcha === true;
  if (captchaRequired && !authState.captchaSolved) return;

  if (auth.autoRegister && auth.registerCommand && !authState.registerSent) {
    authState.registerSent = true;
    authState.registerSentAt = Date.now();
    const delay = randomDelay(1500, 3000);
    setTimeout(() => {
      queueHumanLikeChat(bot, auth.registerCommand, behaviorConfig);
      logger?.auth?.('Sent automatic register command.');
    }, delay);
  }

  if (auth.autoLogin && auth.loginCommand && !authState.loginSent) {
    authState.loginSent = true;
    authState.loginSentAt = Date.now();
    const delay = randomDelay(2500, 4000);
    setTimeout(() => {
      queueHumanLikeChat(bot, auth.loginCommand, behaviorConfig);
      logger?.auth?.('Sent automatic login command.');
    }, delay);
  }
}

function maybeHandleAuthPrompts(bot, message, authState, behaviorConfig, logger) {
  if (!behaviorConfig?.auth?.enabled) return;
  const { auth } = behaviorConfig;
  const lower = message.toLowerCase();

  const registerPrompt =
    auth.autoRegister &&
    auth.registerCommand &&
    (lower.includes('/register') ||
      (lower.includes('register') && (lower.includes('please') || lower.includes('use') || lower.includes('type'))));

  const loginPrompt =
    auth.autoLogin &&
    auth.loginCommand &&
    (lower.includes('/login') ||
      lower.includes('please login') ||
      lower.includes('login with') ||
      lower.includes('login to') ||
      lower.includes('login using'));

  if (!registerPrompt && !loginPrompt) return;

  if (auth.requireCaptcha !== true) {
    authState.captchaSolved = true;
  }

  const now = Date.now();
  if (registerPrompt && authState.registerSent && now - (authState.registerSentAt ?? 0) > 8000) {
    authState.registerSent = false;
  }
  if (loginPrompt && authState.loginSent && now - (authState.loginSentAt ?? 0) > 8000) {
    authState.loginSent = false;
  }

  if (registerPrompt || loginPrompt) {
    logger?.auth?.(
      registerPrompt && loginPrompt
        ? 'Server requested both register and login. Ensuring commands are queued.'
        : registerPrompt
          ? 'Server requested registration. Ensuring register command is queued.'
          : 'Server requested login. Ensuring login command is queued.'
    );
  }

  sendAuthCommandsIfNeeded(bot, authState, behaviorConfig, logger);
}

/**
 * Set up a simple command terminal on stdin. Any line you type into the Node.js
 * process will be sent to the server as a chat message. This provides manual
 * control over the bot for debugging or issuing one-off commands. To send
 * commands (e.g. "/home" or "say hello"), simply type them and hit enter.
 */
function setupCommandTerminal(bot, logger) {
  const existing = globalThis[COMMAND_TERMINAL_KEY];
  if (existing) {
    const isClosed = existing.isClosed?.() ?? false;
    if (!isClosed) {
      existing.setBot(bot);
      existing.refreshPrompt?.();
      return existing;
    }
    delete globalThis[COMMAND_TERMINAL_KEY];
  }

  const state = { bot };
  try {
    if (process.stdin?.setEncoding) {
      process.stdin.setEncoding('utf8');
    }
    process.stdin?.resume?.();
  } catch (err) {
    // ignore failures when checking TTY status
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  rl.resume?.();
  const promptText = '> ';
  rl.setPrompt(promptText);
  let closed = false;
  const consoleState = console.__jarvisConsoleState;
  const outputStream = rl.output ?? process.stdout;
  const promptScheduler = createPromptScheduler(rl, outputStream, logger);

  const schedulePromptRefresh = () => {
    if (closed) return;
    promptScheduler.schedule();
  };

  const cancelScheduledRefresh = () => {
    promptScheduler.cancel();
  };

  const stdinErrorHandler = (err) => {
    logger.command?.(`STDIN error: ${err?.message ?? err}`);
    schedulePromptRefresh();
  };

  if (typeof process.stdin.on === 'function') {
    process.stdin.on('error', stdinErrorHandler);
  }

  const controller = {
    setBot(nextBot) {
      state.bot = nextBot;
      schedulePromptRefresh();
    },
    clearBot() {
      state.bot = null;
    },
    refreshPrompt: () => {
      if (closed) return;
      promptScheduler.flush();
    },
    isClosed: () => closed,
    rl,
  };

  schedulePromptRefresh();

  const consolePromptUpdater = () => {
    if (!closed) {
      schedulePromptRefresh();
    }
  };

  consoleState?.setPromptRefresher?.(consolePromptUpdater);

  rl.on('line', (line) => {
    const cmd = line.trim();
    if (!cmd) {
      schedulePromptRefresh();
      return;
    }
    const activeBot = state.bot;
    if (!activeBot) {
      logger.command?.('No connected bot to receive manual command.');
      schedulePromptRefresh();
      return;
    }
    try {
      activeBot.chat(cmd);
      logger.command?.(`Sent manual command: ${cmd}`);
    } catch (err) {
      logger.command?.(`Failed to send manual command: ${err.message}`);
    }
    schedulePromptRefresh();
  });

  rl.on('close', () => {
    closed = true;
    cancelScheduledRefresh();
    controller.clearBot();
    logger.command?.('Command terminal closed.');
    delete globalThis[COMMAND_TERMINAL_KEY];
    consoleState?.setPromptRefresher?.(null);
    promptScheduler.stop();
    if (typeof process.stdin.off === 'function') {
      process.stdin.off('error', stdinErrorHandler);
    } else if (typeof process.stdin.removeListener === 'function') {
      process.stdin.removeListener('error', stdinErrorHandler);
    }
  });

  rl.on('SIGINT', () => {
    logger.command?.('Press Ctrl+C again to exit.');
    schedulePromptRefresh();
  });

  rl.on('error', (err) => {
    logger.command?.(`Readline error: ${err?.message ?? err}`);
    schedulePromptRefresh();
  });

  globalThis[COMMAND_TERMINAL_KEY] = controller;
  return controller;
}

export function createBot(
  botConfig,
  aiController,
  behaviorConfig,
  sessionConfig,
  logger,
  lifecycleHandlers = {}
) {
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

  // Keep track of whether the bot has responded to CAPTCHAs and auth prompts.
  const authState = {
    captchaSolved: false,
    registerSent: false,
    loginSent: false,
    registerSentAt: 0,
    loginSentAt: 0,
  };

  const lifecycle = lifecycleHandlers ?? {};
  const terminalController = setupCommandTerminal(bot, logger);
  terminalController?.setBot?.(bot);
  let terminationNotified = false;

  const notifyDisconnect = (reasonText, meta = {}) => {
    if (terminationNotified) return;
    terminationNotified = true;
    lifecycle.onDisconnect?.(reasonText, meta);
  };

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
   * Handle server‑sent resource packs automatically. Some server versions
   * expect the client to acknowledge the resource pack with two
   * `resource_pack_receive` packets: first `result = 3` (accepted) and
   * then `result = 0` (successfully loaded)【82116844194669†L444-L482】. Without
   * sending both, the server may close the connection. We listen to both
   * legacy (`resource_pack_send`) and modern (`add_resource_pack`) packets
   * directly on the underlying client and write the appropriate responses.
   */
  bot._client.on('resource_pack_send', (data) => {
    try {
      const { url, hash } = data;
      logger.info(`Server requested resource pack ${url} (hash: ${hash}). Automatically accepting.`);
      // Indicate acceptance
      bot._client.write('resource_pack_receive', { hash, result: 3 });
      // Indicate download success
      bot._client.write('resource_pack_receive', { hash, result: 0 });
    } catch (err) {
      logger.warn(`Failed to handle legacy resource pack: ${err.message}`);
    }
  });
  bot._client.on('add_resource_pack', (data) => {
    try {
      const { url, uuid } = data;
      logger.info(`Server requested resource pack ${url} (uuid: ${uuid}). Automatically accepting.`);
      // Indicate acceptance
      bot._client.write('resource_pack_receive', { uuid, result: 3 });
      // Indicate download success
      bot._client.write('resource_pack_receive', { uuid, result: 0 });
    } catch (err) {
      logger.warn(`Failed to handle modern resource pack: ${err.message}`);
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
    logger.server?.(`Spawned at ${bot.entity.position}`);
    if (aiController?.enabled) {
      aiController.appendHistory('system', 'Bot spawned in the world.');
    }

    autonomy?.pause?.(behaviorConfig?.autonomous?.idlePauseMs ?? 15000);

    const authSettings = behaviorConfig?.auth;
    if (authSettings?.enabled) {
      if (authSettings.requireCaptcha === true) {
        authState.captchaSolved = false;
      } else {
        authState.captchaSolved = true;
        const delay = randomDelay(2200, 4200);
        setTimeout(() => {
          sendAuthCommandsIfNeeded(bot, authState, behaviorConfig, logger);
        }, delay);
      }
    }

    lifecycle.onSpawn?.(bot);
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    // Route chat through the chat logger so the console stays focused on conversation
    logger.chat?.(username, message);
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

  bot.on('death', () => {
    logger.warn('Bot died. Awaiting respawn...');
    logger.server?.('Bot died. Awaiting respawn...');
    terminalController?.refreshPrompt?.();
    autonomy?.pause?.(behaviorConfig?.autonomous?.idlePauseMs ?? 15000);
  });

  bot.on('respawn', () => {
    logger.info('Respawned after death.');
    logger.server?.('Respawned after death.');
    terminalController?.setBot?.(bot);
    terminalController?.refreshPrompt?.();
  });

  /**
   * CAPTCHA detection and solving
   *
   * Some servers use simple text-based CAPTCHAs to prevent bots from joining. They typically
   * send a message in chat instructing the player to run a command such as `/captcha <code>`
   * or ask for the result of a basic arithmetic expression (e.g. “3 + 5”). To behave more
   * like a human and gain full access to the server, we listen for all chat messages via
   * the `messagestr` event, scan for known CAPTCHA patterns, and automatically respond
   * after a short delay. This approach uses regular expressions to keep things flexible
   * and should work with most AuthMe‑style CAPTCHA plugins【633009359541956†L390-L396】.
   */
  bot.on('messagestr', (message) => {
    const plainMessage = stripMinecraftFormatting(message);
    if (plainMessage) {
      const isPlayerChat = /^<[^>]+>\s/.test(plainMessage);
      if (!isPlayerChat) {
        logger.server?.(plainMessage);
      }
    }

    maybeHandleAuthPrompts(bot, plainMessage, authState, behaviorConfig, logger);

    // Normalize the message to lower case for keyword checks but keep original for regex
    const lower = plainMessage.toLowerCase();
    let handled = false;

    // Pattern 1: a command like "/captcha abcd123" or "need_captcha type: /captcha 1234"
    const codeCmdMatch = plainMessage.match(/\/captcha\s+([0-9a-zA-Z]+)/i);
    if (!handled && codeCmdMatch) {
      const code = codeCmdMatch[1];
      logger.captcha?.(`Detected CAPTCHA command: ${plainMessage}`);
      const delay = randomDelay(700, 1400);
      setTimeout(() => {
        try {
          bot.chat(`/captcha ${code}`);
          logger.captcha?.(`Solved CAPTCHA by sending /captcha ${code}.`);
          authState.captchaSolved = true;
          sendAuthCommandsIfNeeded(bot, authState, behaviorConfig, logger);
        } catch (err) {
          logger.warn(`Failed to send CAPTCHA response: ${err.message}`);
        }
      }, delay);
      handled = true;
    }

    // Pattern 2: a standalone code after the word "captcha" (with optional "code" label)
    if (!handled && lower.includes('captcha')) {
      const codeStandaloneMatch = plainMessage.match(/captcha(?:\s*code)?\s*[:]?\s*([0-9A-Za-z]{3,10})/i);
      if (codeStandaloneMatch) {
        const code = codeStandaloneMatch[1];
        logger.captcha?.(`Detected CAPTCHA code ${code} in message: ${plainMessage}`);
        const delay = randomDelay(700, 1400);
        setTimeout(() => {
          try {
            if (/\/captcha/i.test(plainMessage)) {
              bot.chat(`/captcha ${code}`);
              logger.captcha?.(`Solved CAPTCHA by sending /captcha ${code}.`);
            } else {
              bot.chat(code);
              logger.captcha?.(`Solved CAPTCHA by sending code ${code}.`);
            }
            authState.captchaSolved = true;
            sendAuthCommandsIfNeeded(bot, authState, behaviorConfig, logger);
          } catch (err) {
            logger.warn(`Failed to send CAPTCHA response: ${err.message}`);
          }
        }, delay);
        handled = true;
      }
    }

    // Pattern 3: a generic verification code preceded by "code" or "verification code"
    if (!handled) {
      const codeGenericMatch = plainMessage.match(/(?:verification\s*)?code\s*[:]?\s*([0-9A-Za-z]{3,10})/i);
      if (codeGenericMatch) {
        const code = codeGenericMatch[1];
        logger.captcha?.(`Detected verification code ${code} in message: ${plainMessage}`);
        const delay = randomDelay(700, 1400);
        setTimeout(() => {
          try {
            if (/\/captcha/i.test(plainMessage)) {
              bot.chat(`/captcha ${code}`);
              logger.captcha?.(`Solved CAPTCHA by sending /captcha ${code}.`);
            } else {
              bot.chat(code);
              logger.captcha?.(`Solved CAPTCHA by sending code ${code}.`);
            }
            authState.captchaSolved = true;
            sendAuthCommandsIfNeeded(bot, authState, behaviorConfig, logger);
          } catch (err) {
            logger.warn(`Failed to send CAPTCHA response: ${err.message}`);
          }
        }, delay);
        handled = true;
      }
    }

    // Pattern 4: simple arithmetic expressions like "3 + 5"
    if (!handled) {
      const mathMatch = plainMessage.match(/(\d+)\s*([+\-*/])\s*(\d+)/);
      if (mathMatch) {
        const a = parseInt(mathMatch[1], 10);
        const op = mathMatch[2];
        const b = parseInt(mathMatch[3], 10);
        let result;
        switch (op) {
          case '+':
            result = a + b;
            break;
          case '-':
            result = a - b;
            break;
          case '*':
            result = a * b;
            break;
          case '/':
            if (b === 0) return;
            result = Math.floor(a / b);
            break;
          default:
            return;
        }
        logger.captcha?.(`Detected math CAPTCHA "${mathMatch[0]}" with answer ${result}.`);
        const delay = randomDelay(700, 1400);
        setTimeout(() => {
          try {
            if (/\/captcha/i.test(plainMessage)) {
              bot.chat(`/captcha ${result}`);
              logger.captcha?.(`Solved CAPTCHA by sending /captcha ${result}.`);
            } else {
              bot.chat(String(result));
              logger.captcha?.(`Solved CAPTCHA by sending answer ${result}.`);
            }
            authState.captchaSolved = true;
            sendAuthCommandsIfNeeded(bot, authState, behaviorConfig, logger);
          } catch (err) {
            logger.warn(`Failed to send math CAPTCHA response: ${err.message}`);
          }
        }, delay);
      }
    }
  });

  // Suppress noisy PartialReadError spam from unsupported packets.
  // Some modern server versions send packets that older versions of
  // minecraft-protocol/minecraft-data don’t fully understand (e.g.,
  // world particles or block predicates). The Protodef deserializer
  // throws PartialReadError when it can’t parse these packets. These
  // errors can flood the console and don’t necessarily indicate a
  // fatal problem. We ignore them to keep logs clean. Other errors
  // still get logged normally.
  bot.on('error', (error) => {
    // PartialReadError instances either have the name property or set
    // partialReadError = true. Ignore these specific protocol errors.
    if (error?.name === 'PartialReadError' || error?.partialReadError) {
      logger.debug(`Ignoring partial read error: ${error.message}`);
      return;
    }
    logger.error('Bot encountered an error', error);
    const message = error?.message ? `Bot error: ${error.message}` : 'Bot encountered an unknown error.';
    logger.server?.(message);
    lifecycle.onError?.(error);
  });

  bot.on('kicked', (reason) => {
    const text = formatDisconnectReason(reason);
    logger.server?.(`Kicked from server${text ? `: ${text}` : ''}`);
    lifecycle.onKicked?.(text);
    notifyDisconnect(text, { type: 'kicked' });
  });

  bot.on('end', (reason) => {
    const text = formatDisconnectReason(reason);
    logger.warn(`Bot disconnected: ${text}`);
    logger.server?.(`Connection closed${text ? `: ${text}` : ''}`);
    notifyDisconnect(text, { type: 'end' });
    terminalController?.clearBot?.();
  });

  // Expose a command terminal on stdin for manual control. This should be set up
  // after creating the bot so the user can type commands into the console and
  // have them sent directly to the game. It runs immediately and does not wait
  // for spawn, so commands entered before join will be queued by Mineflayer.
  // Already configured above via setupCommandTerminal/bot binding.

  return bot;
}
