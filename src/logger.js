const levels = ['trace', 'debug', 'info', 'warn', 'error'];

function shouldLog(level, threshold) {
  return levels.indexOf(level) >= levels.indexOf(threshold);
}

export function createLogger(level = 'info', options = {}) {
  const { chatOnly = false, showChat = true } = options ?? {};
  const normalizedLevel = levels.includes(level) ? level : 'info';
  const threshold = chatOnly ? 'warn' : normalizedLevel;

  const logger = {};
  for (const lvl of levels) {
    logger[lvl] = (...args) => {
      if (chatOnly && (lvl === 'trace' || lvl === 'debug' || lvl === 'info')) {
        return;
      }
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

  logger.chat = showChat
    ? (username, message) => {
        if (message?.trim()) {
          console.log(`[chat] ${username}: ${message}`);
        }
      }
    : () => {};

  logger.child = (bindings = {}) => {
    return {
      ...logger,
      info: (msg, ...args) => logger.info(`${msg} ${JSON.stringify(bindings)}`, ...args),
      debug: (msg, ...args) => logger.debug(`${msg} ${JSON.stringify(bindings)}`, ...args),
    };
  };

  return logger;
}
