import { Movements, goals as Goals } from 'mineflayer-pathfinder';

function randomBetween(min, max) {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

function findNearestPlayer(bot) {
  const players = Object.values(bot.players || {})
    .filter((player) => player?.entity && player.username !== bot.username);

  if (players.length === 0) return null;

  const { entity: botEntity } = bot;
  if (!botEntity?.position) return null;

  return players.reduce((nearest, candidate) => {
    if (!candidate.entity?.position) return nearest;
    if (!nearest) return candidate;

    const distanceToCandidate = candidate.entity.position.distanceTo(botEntity.position);
    const distanceToNearest = nearest.entity.position.distanceTo(botEntity.position);
    return distanceToCandidate < distanceToNearest ? candidate : nearest;
  }, null);
}

function chooseAmbientLine(bot, aiController) {
  const vanillaLines = [
    'Anyone up for an adventure?',
    'What are we working on today?',
    'I could really go for some mining.',
    'Let me know if you need materials!',
  ];

  if (aiController?.enabled) {
    return aiController
      .chat('Suggest a natural short sentence to say in chat to sound like a friendly player.', `Current position: ${bot.entity.position}`)
      .catch(() => vanillaLines[randomBetween(0, vanillaLines.length - 1)]);
  }

  return Promise.resolve(vanillaLines[randomBetween(0, vanillaLines.length - 1)]);
}

export function enableAutonomousBrain(bot, logger, behaviorConfig, aiController) {
  const settings = behaviorConfig?.autonomous;
  if (!settings?.enabled) {
    return {
      pause: () => {},
      notifyManualActivity: () => {},
    };
  }

  const movements = new Movements(bot);
  let pausedUntil = Date.now() + (settings.idlePauseMs || 0);
  let followTarget = null;

  function pause(durationMs) {
    const until = Date.now() + Math.max(0, durationMs);
    if (until > pausedUntil) pausedUntil = until;
  }

  function notifyManualActivity(durationMs = 20000) {
    pause(durationMs);
    if (bot.pathfinder?.goal) {
      logger.debug('Manual activity detected. Suspending autonomous goal.');
    }
  }

  function engageFollow(targetPlayer) {
    if (!targetPlayer?.entity) return;
    if (bot.pathfinder?.goal instanceof Goals.GoalFollow && followTarget === targetPlayer) return;

    followTarget = targetPlayer;
    bot.pathfinder?.setMovements(movements);
    const followGoal = new Goals.GoalFollow(targetPlayer.entity, settings.followDistance || 3);
    bot.pathfinder?.setGoal(followGoal, true);
    logger.info(`Following ${targetPlayer.username}`);
  }

  function wander() {
    const { position } = bot.entity || {};
    if (!position) return;
    const radius = settings.wanderRadius || 16;
    const offsetX = Math.floor(Math.random() * radius * 2 - radius);
    const offsetZ = Math.floor(Math.random() * radius * 2 - radius);
    const targetX = position.x + offsetX;
    const targetZ = position.z + offsetZ;
    const targetY = position.y;
    bot.pathfinder?.setMovements(movements);
    const wanderGoal = new Goals.GoalNear(targetX, targetY, targetZ, settings.followDistance || 3);
    bot.pathfinder?.setGoal(wanderGoal);
    followTarget = null;
    logger.debug(`Wandering towards ${targetX.toFixed(1)}, ${targetY.toFixed(1)}, ${targetZ.toFixed(1)}`);
  }

  const behaviorTimer = setInterval(() => {
    if (!bot.entity?.position) return;
    if (Date.now() < pausedUntil) return;
    if (!bot.pathfinder) return;

    const activeGoal = bot.pathfinder.goal;
    if (activeGoal && !(activeGoal instanceof Goals.GoalFollow)) return;

    const nearestPlayer = findNearestPlayer(bot);
    if (nearestPlayer) {
      engageFollow(nearestPlayer);
    } else {
      wander();
    }
  }, Math.max(1000, settings.scanIntervalMs || 8000));

  const chatTimer = setInterval(() => {
    if (Date.now() < pausedUntil) return;
    chooseAmbientLine(bot, aiController)
      .then((line) => {
        if (!line) return;
        bot.chat(line);
      })
      .catch((error) => {
        logger.debug(`Failed to send ambient chat: ${error.message}`);
      });
  }, Math.max(settings.ambientChatIntervalMs || 45000, 10000));

  bot.on('playerLeft', (player) => {
    if (followTarget && followTarget.username === player.username) {
      followTarget = null;
      if (bot.pathfinder?.goal instanceof Goals.GoalFollow) {
        bot.pathfinder.setGoal(null);
      }
    }
  });

  bot.once('end', () => {
    clearInterval(behaviorTimer);
    clearInterval(chatTimer);
  });

  return { pause, notifyManualActivity };
}
