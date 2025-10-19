# Jarvis Bot

An advanced Minecraft automation bot powered by [mineflayer](https://github.com/PrismarineJS/mineflayer) with OpenAI integration. The bot behaves like a player in Minecraft 1.21.8, supports intelligent chat assistance, and exposes several quality-of-life commands for navigation and mining.

## Features

- Connects to Minecraft Java Edition servers (tested with 1.21.x, configured for 1.21.8) while imitating vanilla handshake metadata.
- Uses `mineflayer-pathfinder` for advanced navigation, autonomous following of nearby players, and natural wandering.
- Layers in human-like body language, casual strolls, and observation breaks so the bot reads as an actual player rather than a script.
- Optional OpenAI integration for in-game assistance via `!ai` chat command, whispers, and ambient small talk.
- Bootstraps /register and /login commands with human-like timing to satisfy typical cracked-server authentication.
- Built-in commands for movement, mining, and situational awareness.
- Simple configuration through environment variables.

## Getting Started

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Create an environment file**

   Copy `.env.example` to `.env` and fill in your server credentials:

  ```env
  MC_HOST=localhost
  MC_PORT=25565
  MC_USERNAME=JarvisBot
  MC_PASSWORD=
  MC_AUTH=offline
  MC_VERSION=1.21.8
  MC_VIEW_DISTANCE=8

  # Optional tweaks for client handshake realism
  CLIENT_BRAND=vanilla
  SEND_CLIENT_SETTINGS=true

  # Automatic cracked-server authentication
  AUTO_AUTH=true
  AUTO_REGISTER=true
  AUTO_LOGIN=true
  REGISTER_COMMAND="/register JarvisCool2k26!!! JarvisCool2k26!!!"
  LOGIN_COMMAND="/login JarvisCool2k26!!!"

  OPENAI_API_KEY=sk-your-key
  OPENAI_MODEL=gpt-4o-mini
  AI_SYSTEM_PROMPT=You are Jarvis, an advanced Minecraft assistant controlling a bot.
  AI_HISTORY=10
  AI_ENABLED=true

  ALLOW_MINING=true
  ALLOW_BUILDING=true
  DEFAULT_GOAL_RANGE=1
  CHAT_MIN_DELAY_MS=800
  CHAT_MAX_DELAY_MS=2400

  AUTONOMOUS_MODE=true
  AUTONOMOUS_SCAN_INTERVAL_MS=8000
  AUTONOMOUS_FOLLOW_DISTANCE=3
  AUTONOMOUS_WANDER_RADIUS=16
  AUTONOMOUS_IDLE_PAUSE_MS=15000
  AMBIENT_CHAT_INTERVAL_MS=45000

  LOG_LEVEL=info
  ```

   > **Note:** Set `MC_AUTH=microsoft` and provide a password if you want to authenticate with a Microsoft account. Leave `OPENAI_API_KEY` blank or set `AI_ENABLED=false` to disable AI features.

3. **Run the bot**

   ```bash
   npm start
   ```

   The bot will connect to the configured server and begin listening for chat commands.

## Commands

Commands are triggered through the in-game chat and prefixed with `!`:

| Command | Description |
| --- | --- |
| `!help` | List all available commands. |
| `!goto <x> <y> <z>` / `!goto home` | Pathfind to specific coordinates or the spawn point. |
| `!mine <block>` | Mine the nearest block of the given type (if mining is allowed). |
| `!look` | Look directly at the nearest player. |
| `!ai <question>` | Ask the OpenAI assistant for guidance (requires API key). |

Additionally, whispering any message to the bot will yield an AI-assisted reply when OpenAI integration is enabled.

The bot also behaves autonomously:

- Upon spawn it executes the configured `/register` and `/login` commands with subtle random delays.
- A "cognitive brain" tracks surrounding players, mobs, dropped items, and points of interest to decide what to do next.
- It prioritizes safety (evading hostiles or retreating when damaged), opportunistically picks up nearby drops, and mines exposed ores when allowed.
- While friendly players are nearby it follows them at human-like spacing; otherwise it explores new ground to keep moving.
- It sprinkles in casual head turns, jumps, strafes, and short strolls between tasks so onlookers see believable player motion instead of rigid pathfinding.
- Ambient social chatter is timed to feel natural and can optionally be AI generated for extra variety.

## Advanced Usage

- Adjust `AI_SYSTEM_PROMPT` to customize the bot's personality or behavior.
- Modify `DEFAULT_GOAL_RANGE` if the bot should stand further away from goal coordinates.
- Disable mining or building commands by setting `ALLOW_MINING` or `ALLOW_BUILDING` to `false`.
- Tune `AUTONOMOUS_*` variables to change scan cadence, follow distance, maximum chase range, or wandering radius.
- Set `ALLOW_COLLECT=false` if you don't want the bot to chase dropped items automatically.
- Override `REGISTER_COMMAND` / `LOGIN_COMMAND` if your server uses different authentication phrases.

## Troubleshooting

- Ensure the server version matches the configured `MC_VERSION`.
- Confirm the account credentials are valid, especially for Microsoft authentication.
- If AI responses fail, double-check the `OPENAI_API_KEY` and network connectivity.
- Increase logging verbosity by setting `LOG_LEVEL` to `debug`.

## License

MIT
