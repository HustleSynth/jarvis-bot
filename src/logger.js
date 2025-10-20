const levels = ['trace', 'debug', 'info', 'warn', 'error'];
const noisyPatterns = [
  /partial packet/i,
  /chunk size is \d+ but only \d+ was read/i,
];
const chatMarkers = [
  /\[chat\]/i,
  /\[whisper\]/i,
  /\[server\]/i,
  /\[captcha\]/i,
  /\[auth\]/i,
  /\[command\]/i,
];
const ansiPattern = /\u001b\[[0-9;]*[A-Za-z]/;

function shouldLog(level, threshold) {
  return levels.indexOf(level) >= levels.indexOf(threshold);
}

function stringifyArg(arg) {
  if (typeof arg === 'string') return arg;
  if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
  if (arg instanceof Error) {
    return `${arg.message}${arg.stack ? `\n${arg.stack}` : ''}`;
  }
  if (arg === null || arg === undefined) return String(arg);
  try {
    return JSON.stringify(arg);
  } catch (err) {
    return String(arg);
  }
}

function argsToText(args) {
  if (!args || !args.length) return '';
  return args.map((arg) => stringifyArg(arg)).join(' ');
}

function containsNoisyPattern(args) {
  const text = argsToText(args);
  if (!text) return false;
  return noisyPatterns.some((pattern) => pattern.test(text));
}

function isChatOutput(args) {
  return args.some((arg) => typeof arg === 'string' && chatMarkers.some((marker) => marker.test(arg)));
}

function wrapConsoleMethods({ chatOnly }) {
  if (console.__jarvisConsoleState) {
    console.__jarvisConsoleState.update({ chatOnly });
    return;
  }

  const state = { chatOnly: !!chatOnly, promptRefresher: null, pendingRefresh: null };
  const originals = {
    log: console.log.bind(console),
    info: (console.info ?? console.log).bind(console),
    warn: (console.warn ?? console.log).bind(console),
    error: (console.error ?? console.log).bind(console),
    debug: (console.debug ?? console.log).bind(console),
  };

  const shouldSuppress = (method, args) => {
    if (containsNoisyPattern(args)) return true;

    if (method === 'log') {
      const allowTerminalControl =
        !args?.length ||
        args.every((arg) => typeof arg === 'string' && arg.trim() === '') ||
        args.some((arg) => typeof arg === 'string' && ansiPattern.test(arg));
      if (allowTerminalControl) {
        return false;
      }
    }

    if (!state.chatOnly) return false;
    if (method === 'log') {
      return !isChatOutput(args);
    }
    return true;
  };

  const refreshPromptIfNeeded = () => {
    if (state.pendingRefresh) return;
    const refresher = state.promptRefresher;
    if (typeof refresher !== 'function') return;
    state.pendingRefresh = setImmediate(() => {
      state.pendingRefresh = null;
      const activeRefresher = state.promptRefresher;
      if (typeof activeRefresher !== 'function') return;
      try {
        activeRefresher();
      } catch (err) {
        // ignore prompt refresh errors to avoid breaking logging
      }
    });
  };

  const wrap = (method) => (...args) => {
    if (shouldSuppress(method, args)) return;
    const writer = originals[method] ?? originals.log;
    writer(...args);
    refreshPromptIfNeeded();
  };

  console.log = wrap('log');
  console.info = wrap('info');
  console.warn = wrap('warn');
  console.error = wrap('error');
  console.debug = wrap('debug');

  console.__jarvisConsoleState = {
    update: (options = {}) => {
      state.chatOnly = !!options.chatOnly;
    },
    setPromptRefresher: (refresher) => {
      if (state.pendingRefresh) {
        clearImmediate(state.pendingRefresh);
        state.pendingRefresh = null;
      }
      state.promptRefresher = typeof refresher === 'function' ? refresher : null;
    },
    originals,
    state,
  };
}

export function createLogger(level = 'info', options = {}) {
  const { chatOnly = false, showChat = true } = options ?? {};
  wrapConsoleMethods({ chatOnly });

  const normalizedLevel = levels.includes(level) ? level : 'info';
  const threshold = chatOnly ? 'error' : normalizedLevel;

  const logger = {};
  for (const lvl of levels) {
    if (chatOnly) {
      logger[lvl] = () => {};
      continue;
    }

    logger[lvl] = (...args) => {
      if (!shouldLog(lvl, threshold)) return;
      const method = lvl === 'error' ? 'error' : lvl === 'warn' ? 'warn' : lvl === 'debug' ? 'debug' : 'log';
      const [first, ...rest] = args;
      if (first instanceof Error) {
        console[method](`[${lvl}]`, first.message, first.stack, ...rest);
      } else if (typeof first === 'string') {
        console[method](`[${lvl}] ${first}`, ...rest);
      } else {
        console[method](`[${lvl}]`, first, ...rest);
      }
    };
  }

  const createChatPrinter = (label) =>
    showChat
      ? (message) => {
          const text = typeof message === 'string' ? message.trim() : String(message ?? '').trim();
          if (text) {
            console.log(`${label} ${text}`);
          }
        }
      : () => {};

  logger.chat = showChat
    ? (username, message) => {
        if (message?.trim()) {
          console.log(`[chat] ${username}: ${message}`);
        }
      }
    : () => {};

  logger.server = createChatPrinter('[server]');
  logger.captcha = createChatPrinter('[captcha]');
  logger.auth = createChatPrinter('[auth]');
  logger.command = createChatPrinter('[command]');

  logger.child = (bindings = {}) => {
    return {
      ...logger,
      info: (msg, ...args) => logger.info(`${msg} ${JSON.stringify(bindings)}`, ...args),
      debug: (msg, ...args) => logger.debug(`${msg} ${JSON.stringify(bindings)}`, ...args),
    };
  };

  return logger;
}
