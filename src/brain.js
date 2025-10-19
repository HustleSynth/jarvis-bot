import * as Vec3Module from 'vec3';
// Import the CommonJS module as a default export
import mineflayerPathfinder from 'mineflayer-pathfinder';
// Destructure the named exports from the default export
const { Movements, goals: Goals } = mineflayerPathfinder;

const Vec3 = Vec3Module.Vec3 || Vec3Module.default || Vec3Module;

const HOSTILE_MOBS = new Set([
  'Creeper',
  'Skeleton',
  'Spider',
  'Zombie',
  'Drowned',
  'Husk',
  'Enderman',
  'Witch',
  'Wither Skeleton',
  'Piglin Brute',
  'Pillager',
  'Vindicator',
  'Evoker',
  'Ravager',
  'Guardian',
  'Elder Guardian',
  'Vex',
  'Phantom',
  'Stray',
  'Zoglin',
  'Zombified Piglin',
  'Breeze',
  'Bogged',
  'Blaze',
  'Ghast',
]);

const RESOURCE_BLOCKS = new Set([
  'coal_ore',
  'iron_ore',
  'gold_ore',
  'diamond_ore',
  'emerald_ore',
  'redstone_ore',
  'lapis_ore',
  'copper_ore',
  'ancient_debris',
  'deepslate_coal_ore',
  'deepslate_iron_ore',
  'deepslate_gold_ore',
  'deepslate_diamond_ore',
  'deepslate_emerald_ore',
  'deepslate_redstone_ore',
  'deepslate_lapis_ore',
  'deepslate_copper_ore',
]);

const TaskType = Object.freeze({
  FOLLOW_PLAYER: 'follow_player',
  EXPLORE: 'explore',
  INVESTIGATE_POI: 'investigate_poi',
  COLLECT_ITEM: 'collect_item',
  MINE_RESOURCE: 'mine_resource',
  EVADE_THREAT: 'evade_threat',
  OBSERVE: 'observe',
  SOCIALIZE: 'socialize',
  STROLL: 'stroll',
});

function cloneVec(vec) {
  if (!vec) return null;
  if (vec.clone) return vec.clone();
  return new Vec3(vec.x, vec.y, vec.z);
}

function distanceSquared(a, b) {
  if (!a || !b) return Infinity;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function randomChoice(list) {
  if (!Array.isArray(list) || list.length === 0) return undefined;
  return list[Math.floor(Math.random() * list.length)];
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function addNoiseToPosition(position, radius) {
  const offset = new Vec3(
    Math.floor((Math.random() - 0.5) * radius * 2),
    0,
    Math.floor((Math.random() - 0.5) * radius * 2),
  );
  return position.plus(offset);
}

function createDefaultBrainConfig(behaviorConfig) {
  const settings = behaviorConfig?.autonomous || {};
  return {
    decisionIntervalMs: Math.max(2000, settings.scanIntervalMs || 6000),
    observationIntervalMs: 2000,
    socialIntervalMs: Math.max(12000, settings.ambientChatIntervalMs || 45000),
    idlePauseMs: settings.idlePauseMs || 15000,
    followDistance: settings.followDistance || 3,
    followMaxDistance: settings.followMaxDistance || 18,
    wanderRadius: settings.wanderRadius || 32,
    playerForgetMs: 90_000,
    poiForgetMs: 60_000,
    hostileForgetMs: 20_000,
    itemForgetMs: 12_000,
    lowHealthThreshold: 12,
    dangerCooldownMs: 15_000,
    investigationRadius: 24,
    curiosityIntervalMs: 25_000,
    allowMining: behaviorConfig?.allowMining !== false,
    allowCollect: behaviorConfig?.allowCollect !== false,
    microGestureIntervalMs: settings.microGestureIntervalMs || 4500,
    lookAtPlayerRange: settings.lookAtPlayerRange || 10,
    observationChance: settings.observationChance ?? 0.3,
    observationDurationRange: settings.observationDurationRange || [4000, 9000],
    observationCooldownMs: settings.observationCooldownMs || 30_000,
    strollChance: settings.strollChance ?? 0.55,
    strollDurationRange: settings.strollDurationRange || [5000, 9000],
    manualMoveCooldownMs: settings.manualMoveCooldownMs || 25_000,
  };
}

export function createCognitiveBrain(bot, logger, aiController, behaviorConfig) {
  const brainConfig = createDefaultBrainConfig(behaviorConfig);
  const movements = new Movements(bot);

  const state = {
    pausedUntil: Date.now(),
    lastPlanRun: 0,
    lastCuriosityTick: 0,
    lastAmbientChat: 0,
    lastDamageTime: 0,
    lastObservationBreak: 0,
    lastManualWalk: 0,
    currentTask: null,
    asyncTask: null,
    memory: {
      players: new Map(),
      hostiles: new Map(),
      items: new Map(),
      pois: [],
      interestingBlocks: [],
    },
    managedTimeouts: new Set(),
  };

  function registerTimeout(callback, delay, bucket = state.managedTimeouts) {
    const timer = setTimeout(() => {
      state.managedTimeouts.delete(timer);
      if (bucket && bucket !== state.managedTimeouts) {
        bucket.delete(timer);
      }
      callback();
    }, delay);
    state.managedTimeouts.add(timer);
    if (bucket && bucket !== state.managedTimeouts) {
      bucket.add(timer);
    }
    return timer;
  }

  function clearManagedTimeout(timer, bucket = state.managedTimeouts) {
    if (!timer) return;
    clearTimeout(timer);
    state.managedTimeouts.delete(timer);
    if (bucket && bucket !== state.managedTimeouts) {
      bucket.delete(timer);
    }
  }

  function clearControls() {
    if (typeof bot.clearControlStates === 'function') {
      bot.clearControlStates();
      return;
    }
    const controls = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'];
    controls.forEach((control) => {
      if (typeof bot.setControlState === 'function') {
        bot.setControlState(control, false);
      }
    });
  }

  function pause(durationMs) {
    const until = Date.now() + Math.max(0, durationMs);
    if (until > state.pausedUntil) {
      state.pausedUntil = until;
      logger.debug(`Brain paused for ${durationMs}ms`);
    }
    cancelCurrentTask('paused');
  }

  function notifyManualActivity(durationMs = 20_000) {
    pause(durationMs);
  }

  function cancelCurrentTask(reason) {
    if (!state.currentTask) return;
    logger.debug(`Cancelling task ${state.currentTask.type} (${reason})`);
    if (state.currentTask.cleanup) {
      try {
        state.currentTask.cleanup();
      } catch (error) {
        logger.debug(`Task cleanup failed: ${error.message}`);
      }
    }
    if (bot.pathfinder) {
      bot.pathfinder.setGoal(null);
    }
    state.currentTask = null;
    state.asyncTask = null;
  }

  function rememberPlayer(username, entity) {
    if (!entity?.position) return;
    state.memory.players.set(username, {
      username,
      position: cloneVec(entity.position),
      velocity: cloneVec(entity.velocity),
      lastSeen: Date.now(),
      entityId: entity.id,
    });
  }

  function rememberHostile(entity) {
    if (!entity?.position) return;
    state.memory.hostiles.set(entity.id, {
      entityId: entity.id,
      name: entity.displayName || entity.name,
      position: cloneVec(entity.position),
      lastSeen: Date.now(),
    });
  }

  function rememberItem(entity) {
    if (!entity?.position) return;
    state.memory.items.set(entity.id, {
      entityId: entity.id,
      position: cloneVec(entity.position),
      lastSeen: Date.now(),
      kind: entity.displayName || 'item',
    });
  }

  function forgetStaleMemory() {
    const now = Date.now();
    for (const [username, info] of state.memory.players) {
      if (now - info.lastSeen > brainConfig.playerForgetMs) {
        state.memory.players.delete(username);
      }
    }
    for (const [id, info] of state.memory.hostiles) {
      if (now - info.lastSeen > brainConfig.hostileForgetMs) {
        state.memory.hostiles.delete(id);
      }
    }
    for (const [id, info] of state.memory.items) {
      if (now - info.lastSeen > brainConfig.itemForgetMs) {
        state.memory.items.delete(id);
      }
    }
    state.memory.pois = state.memory.pois.filter((poi) => now - poi.notedAt <= brainConfig.poiForgetMs);
  }

  function scanEnvironment() {
    forgetStaleMemory();

    Object.entries(bot.players || {}).forEach(([username, player]) => {
      if (username === bot.username) return;
      if (player?.entity) rememberPlayer(username, player.entity);
    });

    Object.values(bot.entities || {}).forEach((entity) => {
      if (entity.type === 'player' && entity.username !== bot.username) {
        rememberPlayer(entity.username, entity);
      }
      if (entity.type === 'mob' && HOSTILE_MOBS.has(entity.displayName || entity.name)) {
        rememberHostile(entity);
      }
      if (entity.type === 'object' && entity.displayName === 'Item') {
        rememberItem(entity);
      }
    });

    if (brainConfig.allowMining) {
      try {
        const foundPositions = bot.findBlocks({
          matching: (block) => block && RESOURCE_BLOCKS.has(block.name),
          maxDistance: 32,
          count: 3,
        });
        state.memory.interestingBlocks = foundPositions
          .map((vec) => {
            const block = bot.blockAt(vec);
            return block ? { block, position: cloneVec(block.position), notedAt: Date.now() } : null;
          })
          .filter(Boolean);
      } catch (error) {
        logger.debug(`Failed scanning for resources: ${error.message}`);
      }
    }
  }

  function nearestPlayerInfo() {
    if (state.memory.players.size === 0) return null;
    const botPosition = bot.entity?.position;
    if (!botPosition) return null;
    let nearest = null;
    let bestDist = Infinity;
    for (const info of state.memory.players.values()) {
      const dist = distanceSquared(botPosition, info.position);
      if (dist < bestDist) {
        bestDist = dist;
        nearest = info;
      }
    }
    return nearest;
  }

  function nearestHostileInfo() {
    if (state.memory.hostiles.size === 0) return null;
    const botPosition = bot.entity?.position;
    if (!botPosition) return null;
    let nearest = null;
    let bestDist = Infinity;
    for (const info of state.memory.hostiles.values()) {
      const dist = distanceSquared(botPosition, info.position);
      if (dist < bestDist) {
        bestDist = dist;
        nearest = info;
      }
    }
    return nearest;
  }

  function nearestItemInfo() {
    if (state.memory.items.size === 0) return null;
    const botPosition = bot.entity?.position;
    if (!botPosition) return null;
    let nearest = null;
    let bestDist = Infinity;
    for (const info of state.memory.items.values()) {
      const dist = distanceSquared(botPosition, info.position);
      if (dist < bestDist) {
        bestDist = dist;
        nearest = info;
      }
    }
    return nearest;
  }

  function chooseAmbientLine() {
    const defaultLines = [
      'Just checking on things around here.',
      'Exploring the area, feels cozy!',
      'Let me know if you need a hand with anything.',
      'I might go mine something shiny soon.',
    ];

    if (!aiController?.enabled || typeof aiController.chat !== 'function') {
      return Promise.resolve(randomChoice(defaultLines));
    }

    const contextParts = [];
    const nearestPlayer = nearestPlayerInfo();
    if (nearestPlayer) {
      contextParts.push(`Nearest player ${nearestPlayer.username} at ${nearestPlayer.position}`);
    }
    if (state.currentTask) {
      contextParts.push(`Current task ${state.currentTask.type}`);
    }

    const context = contextParts.join('. ');
    const prompt = 'Say a short friendly message that sounds like a Minecraft player doing their own thing.';
    return aiController.chat(prompt, context).catch(() => randomChoice(defaultLines));
  }

  function computeSafeDestination(threatInfo) {
    const botPosition = bot.entity?.position;
    if (!botPosition) return null;
    if (!threatInfo?.position) return addNoiseToPosition(botPosition, brainConfig.wanderRadius);

    const dx = botPosition.x - threatInfo.position.x;
    const dz = botPosition.z - threatInfo.position.z;
    const norm = Math.sqrt(dx * dx + dz * dz) || 1;
    const escapeVector = new Vec3(Math.floor((dx / norm) * 8), 0, Math.floor((dz / norm) * 8));
    return botPosition.plus(escapeVector);
  }

  function followPlayerTask(targetInfo) {
    if (!targetInfo) return null;
    const { username } = targetInfo;
    const existing = state.currentTask;
    if (existing?.type === TaskType.FOLLOW_PLAYER && existing.target === username) {
      return existing;
    }

    const playerEntity = bot.players?.[username]?.entity;
    if (!playerEntity) return null;

    const goal = new Goals.GoalFollow(playerEntity, brainConfig.followDistance);

    return {
      type: TaskType.FOLLOW_PLAYER,
      target: username,
      startedAt: Date.now(),
      goal,
      cleanup: () => {
        if (bot.pathfinder?.goal === goal) {
          bot.pathfinder.setGoal(null);
        }
      },
      continuePredicate: () => {
        const info = state.memory.players.get(username);
        if (!info) return false;
        const botPos = bot.entity?.position;
        if (!botPos) return false;
        const dist = Math.sqrt(distanceSquared(botPos, info.position));
        return dist <= brainConfig.followMaxDistance;
      },
      engage: () => {
        bot.pathfinder?.setMovements(movements);
        bot.pathfinder?.setGoal(goal, true);
        logger.info(`Following ${username}`);
      },
    };
  }

  function exploreTask() {
    const botPosition = bot.entity?.position;
    if (!botPosition) return null;
    const target = addNoiseToPosition(botPosition, brainConfig.wanderRadius);
    const goal = new Goals.GoalNear(target.x, target.y, target.z, brainConfig.followDistance);

    return {
      type: TaskType.EXPLORE,
      target,
      startedAt: Date.now(),
      goal,
      cleanup: () => {
        if (bot.pathfinder?.goal === goal) {
          bot.pathfinder.setGoal(null);
        }
      },
      continuePredicate: () => {
        const activeGoal = bot.pathfinder?.goal;
        return activeGoal instanceof Goals.GoalNear;
      },
      engage: () => {
        bot.pathfinder?.setMovements(movements);
        bot.pathfinder?.setGoal(goal);
        logger.debug(`Exploring towards ${target.x}, ${target.y}, ${target.z}`);
      },
    };
  }

  function observeTask() {
    const [minDuration, maxDuration] = brainConfig.observationDurationRange || [4000, 8000];
    const durationMs = Math.max(2500, Math.floor(randomBetween(minDuration, maxDuration)));
    let startTime = Date.now();
    let cancelled = false;
    const timers = new Set();

    return {
      type: TaskType.OBSERVE,
      startedAt: Date.now(),
      cleanup: () => {
        cancelled = true;
        for (const timer of timers) {
          clearManagedTimeout(timer, timers);
        }
        timers.clear();
        clearControls();
      },
      continuePredicate: () => Date.now() - startTime < durationMs,
      engage: () => {
        startTime = Date.now();
        cancelled = false;
        state.lastObservationBreak = startTime;
        bot.pathfinder?.setGoal(null);
        clearControls();
        logger.debug('Taking a moment to look around.');

        const performLook = () => {
          if (cancelled) return;
          if (Date.now() - startTime >= durationMs) return;
          if (!bot.entity?.position) return;
          const base = bot.entity.position;
          const yaw = bot.entity.yaw + (Math.random() - 0.5) * Math.PI;
          const distance = 3 + Math.random() * 4;
          const lookTarget = base.offset(
            Math.cos(yaw) * distance,
            1.6 + (Math.random() - 0.5) * 0.4,
            Math.sin(yaw) * distance,
          );
          bot.lookAt(lookTarget, true).catch(() => {});
          if (Math.random() < 0.3) {
            bot.swingArm(Math.random() < 0.5 ? 'left' : 'right');
          }
          const delay = 600 + Math.random() * 900;
          const timer = registerTimeout(performLook, delay, timers);
        };

        performLook();
      },
    };
  }

  function strollTask() {
    if (!bot.entity?.position) return null;
    const [minDuration, maxDuration] = brainConfig.strollDurationRange || [5000, 9000];
    const durationMs = Math.max(3000, Math.floor(randomBetween(minDuration, maxDuration)));
    let startTime = Date.now();
    let cancelled = false;
    const timers = new Set();

    return {
      type: TaskType.STROLL,
      startedAt: Date.now(),
      cleanup: () => {
        cancelled = true;
        for (const timer of timers) {
          clearManagedTimeout(timer, timers);
        }
        timers.clear();
        clearControls();
      },
      continuePredicate: () => Date.now() - startTime < durationMs,
      engage: () => {
        startTime = Date.now();
        cancelled = false;
        state.lastManualWalk = startTime;
        bot.pathfinder?.setGoal(null);
        clearControls();
        if (typeof bot.setControlState === 'function') {
          bot.setControlState('forward', true);
        }
        logger.debug('Going for a casual stroll.');

        const pumpMovement = () => {
          if (cancelled) return;
          if (Date.now() - startTime >= durationMs) return;
          if (!bot.entity?.position) return;

          const yaw = bot.entity.yaw + (Math.random() - 0.5) * 0.9;
          const lookTarget = bot.entity.position.offset(
            Math.cos(yaw) * 4,
            1.6 + (Math.random() - 0.5) * 0.3,
            Math.sin(yaw) * 4,
          );
          bot.lookAt(lookTarget, true).catch(() => {});

          if (Math.random() < 0.35) {
            bot.swingArm(Math.random() < 0.6 ? 'right' : 'left');
          }

          if (Math.random() < 0.25 && typeof bot.setControlState === 'function') {
            bot.setControlState('jump', true);
            registerTimeout(() => bot.setControlState('jump', false), 180 + Math.random() * 220, timers);
          }

          if (Math.random() < 0.2 && typeof bot.setControlState === 'function') {
            const strafe = Math.random() < 0.5 ? 'left' : 'right';
            bot.setControlState(strafe, true);
            registerTimeout(() => bot.setControlState(strafe, false), 320 + Math.random() * 260, timers);
          }

          if (Math.random() < 0.1 && typeof bot.setControlState === 'function') {
            bot.setControlState('sprint', true);
            registerTimeout(() => bot.setControlState('sprint', false), 900 + Math.random() * 900, timers);
          }

          const delay = 450 + Math.random() * 750;
          registerTimeout(pumpMovement, delay, timers);
        };

        pumpMovement();
        registerTimeout(() => {
          if (typeof bot.setControlState === 'function') {
            bot.setControlState('forward', false);
          }
        }, durationMs + 100, timers);
      },
    };
  }

  function investigatePoiTask(poi) {
    if (!poi) return null;
    const goal = new Goals.GoalNear(poi.position.x, poi.position.y, poi.position.z, brainConfig.followDistance);
    return {
      type: TaskType.INVESTIGATE_POI,
      target: poi,
      startedAt: Date.now(),
      goal,
      cleanup: () => {
        if (bot.pathfinder?.goal === goal) {
          bot.pathfinder.setGoal(null);
        }
      },
      continuePredicate: () => Date.now() - poi.notedAt < brainConfig.poiForgetMs,
      engage: () => {
        bot.pathfinder?.setMovements(movements);
        bot.pathfinder?.setGoal(goal);
        logger.info(`Investigating point of interest at ${poi.position.x}, ${poi.position.y}, ${poi.position.z}`);
      },
    };
  }

  function evadeThreatTask(threatInfo) {
    const destination = computeSafeDestination(threatInfo);
    if (!destination) return null;
    const goal = new Goals.GoalNear(destination.x, destination.y, destination.z, brainConfig.followDistance);
    return {
      type: TaskType.EVADE_THREAT,
      target: threatInfo,
      startedAt: Date.now(),
      goal,
      cleanup: () => {
        if (bot.pathfinder?.goal === goal) {
          bot.pathfinder.setGoal(null);
        }
      },
      continuePredicate: () => Date.now() - state.lastDamageTime < brainConfig.dangerCooldownMs,
      engage: () => {
        bot.pathfinder?.setMovements(movements);
        bot.pathfinder?.setGoal(goal);
        logger.warn(`Evading threat ${threatInfo?.name || threatInfo?.entityId}`);
      },
    };
  }

  function collectItemTask(itemInfo) {
    if (!itemInfo) return null;
    const goal = new Goals.GoalNear(itemInfo.position.x, itemInfo.position.y, itemInfo.position.z, 1);
    return {
      type: TaskType.COLLECT_ITEM,
      target: itemInfo,
      startedAt: Date.now(),
      goal,
      cleanup: () => {
        if (bot.pathfinder?.goal === goal) {
          bot.pathfinder.setGoal(null);
        }
      },
      continuePredicate: () => {
        const entity = bot.entities?.[itemInfo.entityId];
        return Boolean(entity);
      },
      engage: () => {
        bot.pathfinder?.setMovements(movements);
        bot.pathfinder?.setGoal(goal);
        logger.info(`Moving to collect dropped ${itemInfo.kind}`);
      },
    };
  }

  function mineResourceTask(resource) {
    if (!resource?.block) return null;
    return {
      type: TaskType.MINE_RESOURCE,
      target: resource,
      startedAt: Date.now(),
      engage: () => {
        if (!bot.collectBlock) {
          logger.warn('CollectBlock plugin missing; cannot mine resource.');
          return;
        }
        const collectPromise = bot.collectBlock.collect(resource.block);
        state.asyncTask = {
          promise: collectPromise,
          cancel: () => {
            try {
              bot.collectBlock.cancelTask();
            } catch (error) {
              logger.debug(`Failed to cancel collect task: ${error.message}`);
            }
          },
        };
        collectPromise
          .then(() => {
            logger.info(`Collected ${resource.block.name}`);
          })
          .catch((error) => {
            logger.warn(`Failed to collect ${resource.block.name}: ${error.message}`);
          })
          .finally(() => {
            state.asyncTask = null;
            state.currentTask = null;
          });
      },
      continuePredicate: () => Boolean(bot.collectBlock),
      cleanup: () => {
        if (state.asyncTask?.cancel) {
          state.asyncTask.cancel();
        }
      },
    };
  }

  function socializeTask(line) {
    return {
      type: TaskType.SOCIALIZE,
      startedAt: Date.now(),
      engage: () => {
        if (line) {
          bot.chat(line);
        }
        state.currentTask = null;
      },
      continuePredicate: () => false,
    };
  }

  function setCurrentTask(task) {
    if (!task) return;
    cancelCurrentTask('switching');
    state.currentTask = task;
    task.engage?.();
  }

  function shouldPlanNewTask() {
    if (!bot.entity?.position) return false;
    if (Date.now() < state.pausedUntil) return false;
    if (state.asyncTask?.promise) return false;
    const task = state.currentTask;
    if (!task) return true;
    if (!task.continuePredicate) return true;
    const shouldContinue = Boolean(task.continuePredicate());
    if (!shouldContinue) {
      cancelCurrentTask('predicate failed');
      return true;
    }
    if (task.startedAt && Date.now() - task.startedAt > 60_000) {
      cancelCurrentTask('task timeout');
      return true;
    }
    return false;
  }

  async function evaluateSocial() {
    if (Date.now() - state.lastAmbientChat < brainConfig.socialIntervalMs) return null;
    state.lastAmbientChat = Date.now();
    try {
      const line = await chooseAmbientLine();
      if (!line) return null;
      return socializeTask(line);
    } catch (error) {
      logger.debug(`Ambient chat failed: ${error.message}`);
      return null;
    }
  }

  function shouldTakeObservationBreak(now, nearestPlayer) {
    if (!bot.entity?.position) return false;
    if (now - state.lastObservationBreak < brainConfig.observationCooldownMs) return false;
    if (!brainConfig.observationChance) return false;
    if (state.memory.hostiles.size > 0) return false;
    const chance = nearestPlayer ? brainConfig.observationChance * 0.5 : brainConfig.observationChance;
    return Math.random() < Math.max(0, Math.min(1, chance));
  }

  function shouldTakeStroll(now, nearestPlayer) {
    if (!bot.entity?.position) return false;
    if (now - state.lastManualWalk < brainConfig.manualMoveCooldownMs) return false;
    if (!brainConfig.strollChance) return false;
    let chance = brainConfig.strollChance;
    if (nearestPlayer) {
      chance = Math.min(0.9, chance + 0.15);
    }
    return Math.random() < Math.max(0, Math.min(1, chance));
  }

  function planNextTask() {
    const now = Date.now();
    state.lastPlanRun = now;

    const nearestThreat = nearestHostileInfo();
    if (nearestThreat) {
      const botPos = bot.entity?.position;
      if (botPos) {
        const threatDistance = Math.sqrt(distanceSquared(botPos, nearestThreat.position));
        if (threatDistance < 8 || now - state.lastDamageTime < brainConfig.dangerCooldownMs || bot.health < brainConfig.lowHealthThreshold) {
          return evadeThreatTask(nearestThreat);
        }
      }
    }

    if (brainConfig.allowCollect) {
      const item = nearestItemInfo();
      if (item) {
        const botPos = bot.entity?.position;
        if (botPos && Math.sqrt(distanceSquared(botPos, item.position)) < 12) {
          return collectItemTask(item);
        }
      }
    }

    if (brainConfig.allowMining) {
      const resource = state.memory.interestingBlocks[0];
      if (resource) {
        return mineResourceTask(resource);
      }
    }

    if (state.memory.pois.length > 0) {
      const poi = state.memory.pois[0];
      return investigatePoiTask(poi);
    }

    const nearestPlayer = nearestPlayerInfo();
    if (nearestPlayer) {
      const botPos = bot.entity?.position;
      const distance = Math.sqrt(distanceSquared(botPos, nearestPlayer.position));
      if (distance > brainConfig.followDistance && distance < brainConfig.followMaxDistance) {
        return followPlayerTask(nearestPlayer);
      }
    }

    if (shouldTakeObservationBreak(now, nearestPlayer)) {
      const observation = observeTask();
      if (observation) {
        return observation;
      }
    }

    if (shouldTakeStroll(now, nearestPlayer)) {
      const stroll = strollTask();
      if (stroll) {
        return stroll;
      }
    }

    if (now - state.lastCuriosityTick > brainConfig.curiosityIntervalMs && bot.entity?.position) {
      state.lastCuriosityTick = now;
      return exploreTask();
    }

    return exploreTask();
  }

  function performMicroGestures() {
    if (!bot.entity?.position) return;
    if (Date.now() < state.pausedUntil) return;
    if (state.asyncTask?.promise) return;

    const current = state.currentTask;
    if (current?.type === TaskType.EVADE_THREAT) return;

    const botPosition = bot.entity.position;
    const nearest = nearestPlayerInfo();
    if (nearest) {
      const distance = Math.sqrt(distanceSquared(botPosition, nearest.position));
      if (distance <= brainConfig.lookAtPlayerRange && Math.random() < 0.7) {
        const lookTarget = new Vec3(nearest.position.x, nearest.position.y + 1.6, nearest.position.z);
        bot.lookAt(lookTarget, true).catch(() => {});
        if (Math.random() < 0.35) {
          bot.swingArm(Math.random() < 0.5 ? 'left' : 'right');
        }
      }
    }

    if (Math.random() < 0.45) {
      const yaw = bot.entity.yaw + (Math.random() - 0.5) * 1.2;
      const distance = 3 + Math.random() * 4;
      const lookTarget = botPosition.offset(
        Math.cos(yaw) * distance,
        1.6 + (Math.random() - 0.5) * 0.3,
        Math.sin(yaw) * distance,
      );
      bot.lookAt(lookTarget, true).catch(() => {});
    }

    const hasGoal = Boolean(bot.pathfinder?.goal);
    const allowMovementGestures = !hasGoal || Math.random() < 0.1 || (current && (current.type === TaskType.OBSERVE || current.type === TaskType.STROLL));

    if (allowMovementGestures && typeof bot.setControlState === 'function') {
      if (Math.random() < 0.14) {
        const strafe = Math.random() < 0.5 ? 'left' : 'right';
        bot.setControlState(strafe, true);
        registerTimeout(() => bot.setControlState(strafe, false), 260 + Math.random() * 260);
      }

      if (Math.random() < 0.18) {
        bot.setControlState('jump', true);
        registerTimeout(() => bot.setControlState('jump', false), 180 + Math.random() * 240);
      }
    }

    if (Math.random() < 0.08) {
      bot.swingArm(Math.random() < 0.5 ? 'left' : 'right');
    }

    if (Math.random() < 0.05 && typeof bot.setControlState === 'function') {
      bot.setControlState('sneak', true);
      registerTimeout(() => bot.setControlState('sneak', false), 600 + Math.random() * 1200);
    }
  }

  async function runPlanner() {
    if (!shouldPlanNewTask()) return;
    const planned = planNextTask();
    if (!planned) return;
    if (planned.type === TaskType.SOCIALIZE) {
      planned.engage();
      return;
    }
    setCurrentTask(planned);
  }

  function handleAmbientSocial() {
    evaluateSocial().then((task) => {
      if (!task) return;
      if (Date.now() < state.pausedUntil) return;
      task.engage();
    });
  }

  function markPointOfInterest(position, description) {
    if (!position) return;
    state.memory.pois.unshift({ position: cloneVec(position), description, notedAt: Date.now() });
    state.memory.pois = state.memory.pois.slice(0, 6);
  }

  bot.on('entityHurt', (entity) => {
    if (entity.id === bot.entity?.id) {
      state.lastDamageTime = Date.now();
      logger.warn('Took damage; prioritizing safety.');
    }
  });

  bot.on('entitySpawn', (entity) => {
    if (entity.type === 'mob' && HOSTILE_MOBS.has(entity.displayName || entity.name)) {
      rememberHostile(entity);
    }
    if (entity.type === 'object' && entity.displayName === 'Item') {
      rememberItem(entity);
    }
  });

  bot.on('entityGone', (entity) => {
    if (entity.type === 'mob') {
      state.memory.hostiles.delete(entity.id);
    }
    if (entity.type === 'object') {
      state.memory.items.delete(entity.id);
    }
  });

  bot.on('blockUpdate', (oldBlock, newBlock) => {
    const interestingBlocks = ['crafting_table', 'furnace', 'chest', 'ender_chest', 'smithing_table'];
    const block = newBlock || oldBlock;
    if (!block?.name) return;
    if (interestingBlocks.includes(block.name)) {
      markPointOfInterest(block.position, block.name);
    }
  });

  bot.on('playerCollect', (collector, collected) => {
    if (collector?.username && collector.username !== bot.username && collected?.position) {
      markPointOfInterest(collected.position, 'collection');
    }
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    if (!message) return;
    if (message.toLowerCase().includes('come here') || message.toLowerCase().includes('follow')) {
      const info = state.memory.players.get(username);
      if (info) {
        state.memory.pois.unshift({ position: cloneVec(info.position), description: 'chat request', notedAt: Date.now() });
      }
    }
  });

  const observationTimer = setInterval(scanEnvironment, brainConfig.observationIntervalMs);
  const planningTimer = setInterval(runPlanner, brainConfig.decisionIntervalMs);
  const socialTimer = setInterval(handleAmbientSocial, brainConfig.socialIntervalMs);
  const gestureTimer = setInterval(performMicroGestures, brainConfig.microGestureIntervalMs);

  bot.once('end', () => {
    clearInterval(observationTimer);
    clearInterval(planningTimer);
    clearInterval(socialTimer);
    clearInterval(gestureTimer);
    for (const timer of state.managedTimeouts) {
      clearTimeout(timer);
    }
    state.managedTimeouts.clear();
  });

  return {
    pause,
    notifyManualActivity,
  };
}
