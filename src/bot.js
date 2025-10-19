import mineflayer from 'mineflayer';
import readline from 'node:readline';

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

/**
 * Send registration and login commands after CAPTCHA is solved.
 * Many servers require the player to register and/or log in using
 * predetermined commands. If `behaviorConfig.auth.autoRegister` or
 * `autoLogin` is enabled and the corresponding commands are provided,
 * this helper will queue them once the CAPTCHA has been solved. It
 * respects the `authState` flags to avoid sending duplicates. Commands
 * are sent with a random human‑like delay using `queueHumanLikeChat`.
 */
function sendAuthCommandsIfNeeded(bot, authState, behaviorConfig) {
  if (!behaviorConfig?.auth) return;
  const { auth } = behaviorConfig;
  // After captcha is solved, send register/login commands as needed
  if (auth.autoRegister && auth.registerCommand && !authState.registerSent) {
    authState.registerSent = true;
    const delay = randomDelay(1500, 3000);
    setTimeout(() => {
      queueHumanLikeChat(bot, auth.registerCommand, behaviorConfig);
    }, delay);
  }
  if (auth.autoLogin && auth.loginCommand && !authState.loginSent) {
    authState.loginSent = true;
    const delay = randomDelay(2500, 4000);
    setTimeout(() => {
      queueHumanLikeChat(bot, auth.loginCommand, behaviorConfig);
    }, delay);
  }
}

/**
 * Set up a simple command terminal on stdin. Any line you type into the Node.js
 * process will be sent to the server as a chat message. This provides manual
 * control over the bot for debugging or issuing one-off commands. To send
 * commands (e.g. "/home" or "say hello"), simply type them and hit enter.
 */
function setupCommandTerminal(bot, logger) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on('line', (line) => {
    const cmd = line.trim();
    if (!cmd) return;
    try {
      bot.chat(cmd);
      logger.debug(`Manual command sent: ${cmd}`);
    } catch (err) {
      logger.warn(`Failed to send manual command: ${err.message}`);
    }
  });
  rl.on('close', () => {
    logger.info('Command terminal closed.');
  });
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

  // Suppress noisy partial packet warnings from underlying libraries. Some
  // versions of minecraft-protocol/protodef emit warnings via
  // console.warn when they encounter unknown or truncated packets (e.g.,
  // "Chunk size is 330 but only 222 was read ; partial packet"). These
  // warnings are harmless and clutter the console. Override console.warn
  // to ignore messages containing "partial packet" or "Chunk size is".
  const originalConsoleWarn = console.warn;
  console.warn = (...args) => {
    try {
      const first = args[0];
      if (typeof first === 'string' && (first.includes('partial packet') || first.includes('Chunk size is'))) {
        // Ignore these noisy protocol warnings
        return;
      }
    } catch (e) {
      // ignore errors in filtering
    }
    originalConsoleWarn.apply(console, args);
  };

  // ✅ Load the plugins using the fixed import
  bot.loadPlugin(pathfinder);
  bot.loadPlugin(collectBlockPlugin);

  // Keep track of whether the bot has responded to CAPTCHAs and auth prompts.
  const authState = {
    captchaSolved: false,
    registerSent: false,
    loginSent: false
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
    if (aiController?.enabled) {
      aiController.appendHistory('system', 'Bot spawned in the world.');
    }

    autonomy?.pause?.(behaviorConfig?.autonomous?.idlePauseMs ?? 15000);

    if (behaviorConfig?.auth?.enabled) {
      const { auth } = behaviorConfig;
      // If the server does not require solving a captcha before auth, send
      // registration/login commands immediately upon spawn. Otherwise, wait
      // until the captcha is solved; sendAuthCommandsIfNeeded() will handle it.
      if (!behaviorConfig?.auth?.requireCaptcha) {
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
    }
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    // Log chat messages at debug level to avoid spamming the console
    logger.debug(`${username}: ${message}`);
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
    // Normalize the message to lower case for keyword checks but keep original for regex
    const lower = message.toLowerCase();
    // If the message contains the word "captcha", attempt to extract a verification code.
    // There are two common patterns:
    //   1. The message includes a `/captcha <code>` command (handled below).
    //   2. The message simply displays a code after the word "captcha" or "captcha code"
    //      (e.g. "CAPTCHA: QF2A7" or "Captcha code: abc123").
    if (lower.includes('captcha')) {
      // Pattern 1: a command like "/captcha abcd123" or "need_captcha type: /captcha 1234"
      const codeCmdMatch = message.match(/\/captcha\s+([0-9a-zA-Z]+)/i);
      if (codeCmdMatch) {
        const code = codeCmdMatch[1];
        logger.debug(`Detected CAPTCHA code '${code}' in message: ${message}`);
        const delay = randomDelay(700, 1400);
        setTimeout(() => {
          try {
            bot.chat(`/captcha ${code}`);
            logger.debug(`Sent /captcha ${code} to solve CAPTCHA`);
            authState.captchaSolved = true;
            // After solving captcha, attempt to send auth commands
            sendAuthCommandsIfNeeded(bot, authState, behaviorConfig);
          } catch (err) {
            logger.warn(`Failed to send CAPTCHA response: ${err.message}`);
          }
        }, delay);
        return;
      }
      // Pattern 2: a standalone code after the word "captcha" (with optional "code" label)
      const codeStandaloneMatch = message.match(/captcha(?:\s*code)?\s*[:]?\s*([0-9A-Za-z]{3,10})/i);
      if (codeStandaloneMatch) {
        const code = codeStandaloneMatch[1];
        logger.debug(`Detected standalone CAPTCHA code '${code}' in message: ${message}`);
        const delay = randomDelay(700, 1400);
        setTimeout(() => {
          try {
            // If the original message includes "/captcha", send the command form; otherwise send the raw code.
            if (/\/captcha/i.test(message)) {
              bot.chat(`/captcha ${code}`);
              logger.debug(`Sent /captcha ${code} to solve CAPTCHA`);
            } else {
              bot.chat(code);
              logger.debug(`Sent raw code '${code}' to solve CAPTCHA`);
            }
            authState.captchaSolved = true;
            sendAuthCommandsIfNeeded(bot, authState, behaviorConfig);
          } catch (err) {
            logger.warn(`Failed to send CAPTCHA response: ${err.message}`);
          }
        }, delay);
        return;
      }

      // Pattern 3: a generic verification code preceded by "code" or "verification code"
      // Some plugins might display "code: 1234" or "verification code 123ABC" without
      // mentioning the word "captcha". We match alphanumeric sequences of 3–10 characters
      // following these keywords. We still prefix our response with `/captcha` since
      // servers generally expect the command.
      const codeGenericMatch = message.match(/(?:verification\s*)?code\s*[:]?\s*([0-9A-Za-z]{3,10})/i);
      if (codeGenericMatch) {
        const code = codeGenericMatch[1];
        logger.debug(`Detected generic code '${code}' in message: ${message}`);
        const delay = randomDelay(700, 1400);
        setTimeout(() => {
          try {
            if (/\/captcha/i.test(message)) {
              bot.chat(`/captcha ${code}`);
              logger.debug(`Sent /captcha ${code} to solve generic code CAPTCHA`);
            } else {
              bot.chat(code);
              logger.debug(`Sent raw code '${code}' to solve generic code CAPTCHA`);
            }
            authState.captchaSolved = true;
            sendAuthCommandsIfNeeded(bot, authState, behaviorConfig);
          } catch (err) {
            logger.warn(`Failed to send CAPTCHA response: ${err.message}`);
          }
        }, delay);
        return;
      }
    }
    // Look for simple arithmetic expressions (e.g. "3 + 5") in any message. Some plugins
    // require solving a math problem instead of entering a code. We capture two numbers
    // and a basic operator, compute the result, and send it via `/captcha <result>`.
    const mathMatch = message.match(/(\d+)\s*([+\-*/])\s*(\d+)/);
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
          // Avoid division by zero; compute integer division like Minecraft chat expects
          if (b === 0) return;
          result = Math.floor(a / b);
          break;
        default:
          return;
      }
      logger.debug(`Detected math CAPTCHA '${mathMatch[0]}' with answer ${result}`);
      const delay = randomDelay(700, 1400);
      setTimeout(() => {
        try {
          // Send command form if the message contains "/captcha"; otherwise send just the answer
          if (/\/captcha/i.test(message)) {
            bot.chat(`/captcha ${result}`);
            logger.debug(`Sent /captcha ${result} to solve math CAPTCHA`);
          } else {
            bot.chat(String(result));
            logger.debug(`Sent raw answer '${result}' to solve math CAPTCHA`);
          }
          authState.captchaSolved = true;
          sendAuthCommandsIfNeeded(bot, authState, behaviorConfig);
        } catch (err) {
          logger.warn(`Failed to send math CAPTCHA response: ${err.message}`);
        }
      }, delay);
    }
  });

  // After handling captchas, watch for register and login prompts. Some servers will instruct
  // the player to use `/register` or `/login` after solving a captcha. We detect these
  // prompts and send the appropriate command from the behavior configuration. We avoid
  // sending duplicates by tracking authState flags and only proceed once the captcha
  // challenge is satisfied (if required).
  bot.on('messagestr', (message) => {
    const lowerMsg = message.toLowerCase();
    // If a captcha is required and hasn’t been solved yet, don’t respond to auth prompts.
    if (behaviorConfig?.auth?.requireCaptcha && !authState.captchaSolved) return;
    // Registration prompt detection
    if (!authState.registerSent && lowerMsg.includes('/register')) {
      const registerCmd = behaviorConfig?.auth?.registerCommand;
      if (registerCmd) {
        authState.registerSent = true;
        const delay = randomDelay(1200, 2500);
        setTimeout(() => {
          logger.debug(`Detected register prompt ('${message}'); sending register command.`);
          queueHumanLikeChat(bot, registerCmd, behaviorConfig);
        }, delay);
      }
    }
    // Login prompt detection
    if (!authState.loginSent && lowerMsg.includes('/login')) {
      const loginCmd = behaviorConfig?.auth?.loginCommand;
      if (loginCmd) {
        authState.loginSent = true;
        const delay = randomDelay(1200, 2500);
        setTimeout(() => {
          logger.debug(`Detected login prompt ('${message}'); sending login command.`);
          queueHumanLikeChat(bot, loginCmd, behaviorConfig);
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
  });

  bot.on('end', (reason) => {
    logger.warn(`Bot disconnected: ${reason}`);
  });

  // Expose a command terminal on stdin for manual control. This should be set up
  // after creating the bot so the user can type commands into the console and
  // have them sent directly to the game. It runs immediately and does not wait
  // for spawn, so commands entered before join will be queued by Mineflayer.
  setupCommandTerminal(bot, logger);

  return bot;
}