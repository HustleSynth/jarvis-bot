import { config as loadEnv } from 'dotenv';

loadEnv();

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const botConfig = {
  host: process.env.MC_HOST || 'localhost',
  port: toNumber(process.env.MC_PORT, 25565),
  username: process.env.MC_USERNAME || 'JarvisBot',
  password: process.env.MC_PASSWORD,
  auth: process.env.MC_AUTH || 'offline',
  version: process.env.MC_VERSION || '1.21.8',
  viewDistance: toNumber(process.env.MC_VIEW_DISTANCE, 8),
};

export const sessionConfig = {
  enableClientBrand: process.env.CLIENT_BRAND !== 'false',
  clientBrand: process.env.CLIENT_BRAND_VALUE || 'vanilla',
  sendClientSettings: process.env.SEND_CLIENT_SETTINGS !== 'false',
};

export const aiConfig = {
  enabled: process.env.OPENAI_API_KEY ? true : process.env.AI_ENABLED !== 'false',
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  systemPrompt:
    process.env.AI_SYSTEM_PROMPT ||
    'You are Jarvis, an advanced Minecraft assistant controlling a bot. Be concise and actionable.',
  maxHistory: toNumber(process.env.AI_HISTORY, 10),
};

export const behaviorConfig = {
  allowMining: process.env.ALLOW_MINING !== 'false',
  allowBuilding: process.env.ALLOW_BUILDING !== 'false',
  defaultGoalRange: toNumber(process.env.DEFAULT_GOAL_RANGE, 1),
  humanChatDelay: {
    min: toNumber(process.env.CHAT_MIN_DELAY_MS, 800),
    max: toNumber(process.env.CHAT_MAX_DELAY_MS, 2400),
  },
  auth: {
    enabled: process.env.AUTO_AUTH !== 'false',
    autoRegister: process.env.AUTO_REGISTER !== 'false',
    autoLogin: process.env.AUTO_LOGIN !== 'false',
    registerCommand:
      process.env.REGISTER_COMMAND || '/register JarvisCool2k26!!! JarvisCool2k26!!!',
    loginCommand: process.env.LOGIN_COMMAND || '/login JarvisCool2k26!!!',
  },
  autonomous: {
    enabled: process.env.AUTONOMOUS_MODE !== 'false',
    scanIntervalMs: toNumber(process.env.AUTONOMOUS_SCAN_INTERVAL_MS, 8000),
    followDistance: toNumber(process.env.AUTONOMOUS_FOLLOW_DISTANCE, 3),
    wanderRadius: toNumber(process.env.AUTONOMOUS_WANDER_RADIUS, 16),
    idlePauseMs: toNumber(process.env.AUTONOMOUS_IDLE_PAUSE_MS, 15000),
    ambientChatIntervalMs: toNumber(process.env.AMBIENT_CHAT_INTERVAL_MS, 45000),
  },
};

export const logConfig = {
  level: process.env.LOG_LEVEL || 'info',
};
