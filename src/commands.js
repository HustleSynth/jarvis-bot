import { Movements, goals as Goals } from 'mineflayer-pathfinder';

function parseCoordinates(bot, args) {
  if (args.length === 3) {
    const [x, y, z] = args.map(Number);
    if ([x, y, z].some((value) => Number.isNaN(value))) {
      throw new Error('Coordinates must be numbers');
    }
    return { x, y, z };
  }

  if (args.length === 1 && args[0] === 'home') {
    if (!bot.spawnPoint) throw new Error('Spawn point unknown');
    return bot.spawnPoint;
  }

  throw new Error('Usage: !goto <x> <y> <z> or !goto home');
}

export function registerCommands(bot, logger, aiController, behavior, autonomy) {
  const commands = new Map();

  commands.set('help', {
    description: 'List available commands',
    usage: '!help',
    handler: () => {
      return Array.from(commands.entries())
        .map(([name, meta]) => `${name} - ${meta.description}`)
        .join('\n');
    },
  });

  commands.set('goto', {
    description: 'Pathfind to coordinates or home',
    usage: '!goto <x> <y> <z>|home',
    handler: async (args) => {
      const target = parseCoordinates(bot, args);
      bot.pathfinder.setMovements(new Movements(bot));
      const range = Math.max(1, behavior.defaultGoalRange || 1);
      bot.pathfinder.setGoal(new Goals.GoalNear(target.x, target.y, target.z, range));
      return `Navigating to ${target.x}, ${target.y}, ${target.z} (within ${range} blocks)`;
    },
  });

  if (behavior.allowMining) {
    commands.set('mine', {
      description: 'Mine the nearest block of a given type',
      usage: '!mine <block name>',
      handler: async (args) => {
        const targetName = args.join(' ');
        if (!targetName) throw new Error('Usage: !mine <block name>');
        const block = bot.findBlock({
          matching: (block) => block?.name === targetName,
          maxDistance: 64,
        });
        if (!block) throw new Error(`Could not find block ${targetName} nearby`);

        await bot.collectBlock.collect(block);
        return `Finished mining ${targetName}`;
      },
    });
  }

  commands.set('look', {
    description: 'Look at the nearest player',
    usage: '!look',
    handler: async () => {
      const player = bot.nearestEntity((entity) => entity.type === 'player');
      if (!player || !player.position) throw new Error('No players nearby');
      await bot.lookAt(player.position.offset(0, player.height, 0));
      return `Looking at ${player.username || 'player'}`;
    },
  });

  if (aiController?.enabled) {
    commands.set('ai', {
      description: 'Ask the integrated AI for help',
      usage: '!ai <question>',
      handler: async (args) => {
        const prompt = args.join(' ');
        if (!prompt) throw new Error('Usage: !ai <question>');
        const context = `Bot position: ${bot.entity.position}`;
        const response = await aiController.chat(prompt, context);
        return response;
      },
    });
  }

  function executeCommand(username, message) {
    if (!message.startsWith('!')) return;
    const [commandName, ...args] = message.slice(1).split(/\s+/);
    const command = commands.get(commandName);
    if (!command) {
      bot.chat(`Unknown command ${commandName}. Try !help`);
      return;
    }

    autonomy?.notifyManualActivity?.();

    Promise.resolve(command.handler(args))
      .then((response) => {
        if (response) bot.chat(response);
      })
      .catch((error) => {
        logger.warn(`Command failed: ${error.message || error}`);
        if (error?.stack) {
          logger.debug(error.stack);
        }
        bot.chat(error.message || 'Command failed');
      });
  }

  return { executeCommand, commands };
}
