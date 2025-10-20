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

const WOOD_BLOCKS = new Set([
  'oak_log',
  'birch_log',
  'spruce_log',
  'jungle_log',
  'acacia_log',
  'dark_oak_log',
  'mangrove_log',
  'cherry_log',
  'pale_oak_log',
  'bamboo_block',
  'crimson_stem',
  'warped_stem',
]);

const WEAPON_PRIORITIES = new Map([
  ['netherite_sword', 9],
  ['diamond_sword', 8],
  ['iron_sword', 7],
  ['netherite_axe', 7],
  ['trident', 7],
  ['stone_sword', 6],
  ['diamond_axe', 6],
  ['wooden_sword', 5],
  ['iron_axe', 5],
  ['stone_axe', 4],
  ['golden_sword', 4],
  ['wooden_axe', 3],
  ['golden_axe', 3],
  ['diamond_pickaxe', 2],
  ['iron_pickaxe', 2],
  ['stone_pickaxe', 1],
  ['wooden_pickaxe', 1],
]);

const SHIELD_ITEMS = new Set(['shield']);

const TaskType = Object.freeze({
  FOLLOW_PLAYER: 'follow_player',
  EXPLORE: 'explore',
  INVESTIGATE_POI: 'investigate_poi',
  COLLECT_ITEM: 'collect_item',
  MINE_RESOURCE: 'mine_resource',
  HARVEST_WOOD: 'harvest_wood',
  EVADE_THREAT: 'evade_threat',
  OBSERVE: 'observe',
  SOCIALIZE: 'socialize',
  STROLL: 'stroll',
  COMBAT: 'combat',
  GROUP_FOLLOW: 'group_follow',
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

function vecEquals(a, b) {
  if (!a || !b) return false;
  if (typeof a.equals === 'function') {
    return a.equals(b);
  }
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function scoreWeapon(item) {
  if (!item) return 0;
  const direct = WEAPON_PRIORITIES.get(item.name);
  if (direct) return direct;
  const cleaned = item.name?.replace(/^minecraft:/, '') ?? '';
  return WEAPON_PRIORITIES.get(cleaned) ?? 0;
}

function findBestWeapon(bot) {
  const inventoryItems = typeof bot?.inventory?.items === 'function' ? bot.inventory.items() : bot?.inventory?.items ?? [];
  let best = null;
  let bestScore = 0;
  for (const item of inventoryItems) {
    const score = scoreWeapon(item);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

function findShield(bot) {
  const inventoryItems = typeof bot?.inventory?.items === 'function' ? bot.inventory.items() : bot?.inventory?.items ?? [];
  for (const item of inventoryItems) {
    const name = item.name?.replace(/^minecraft:/, '') ?? '';
    if (SHIELD_ITEMS.has(item.name) || SHIELD_ITEMS.has(name)) {
      return item;
    }
  }
  return null;
}

async function equipItem(bot, item, destination, logger) {
  if (!bot || !item) return;
  try {
    await bot.equip(item, destination);
  } catch (error) {
    logger?.debug?.(`Failed to equip ${item?.name} to ${destination}: ${error?.message ?? error}`);
  }
}

function equipForCombat(bot, logger) {
  const weapon = findBestWeapon(bot);
  if (weapon) {
    equipItem(bot, weapon, 'hand', logger);
  }
  const shield = findShield(bot);
  if (shield) {
    equipItem(bot, shield, 'off-hand', logger);
  }
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
    resourceForgetMs: settings.resourceForgetMs || 90_000,
    lowHealthThreshold: 12,
    dangerCooldownMs: 15_000,
    investigationRadius: 24,
    curiosityIntervalMs: 25_000,
    allowMining: behaviorConfig?.allowMining !== false,
    allowWoodHarvest: behaviorConfig?.allowWoodHarvest !== false,
    allowCollect: behaviorConfig?.allowCollect !== false,
    allowCombat: behaviorConfig?.allowCombat !== false,
    microGestureIntervalMs: settings.microGestureIntervalMs || 4500,
    lookAtPlayerRange: settings.lookAtPlayerRange || 10,
    observationChance: settings.observationChance ?? 0.3,
    observationDurationRange: settings.observationDurationRange || [4000, 9000],
    observationCooldownMs: settings.observationCooldownMs || 30_000,
    strollChance: settings.strollChance ?? 0.55,
    strollDurationRange: settings.strollDurationRange || [5000, 9000],
    manualMoveCooldownMs: settings.manualMoveCooldownMs || 25_000,
    combatEngageHealth: settings.combatEngageHealth ?? 14,
    combatDisengageHealth: settings.combatDisengageHealth ?? 6,
    combatCooldownMs: settings.combatCooldownMs || 9000,
    combatSwingIntervalMs: settings.combatSwingIntervalMs || 450,
    combatLookIntervalMs: settings.combatLookIntervalMs || 200,
    combatMaxChaseDistance: settings.combatMaxChaseDistance || 18,
    groupFollowRadius: settings.groupFollowRadius || 12,
    groupFollowLeash: settings.groupFollowLeash || 20,
    groupMinSize: settings.groupMinSize || 2,
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
      resourceTargets: [],
    },
    managedTimeouts: new Set(),
    combatCooldownUntil: 0,
    lastCombatTime: 0,
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

  function rememberResourceTarget(block, kind, priority = 1) {
    if (!block?.position) return;
    const position = cloneVec(block.position);
    const blockName = block.name;
    const existingIndex = state.memory.resourceTargets.findIndex((entry) => vecEquals(entry.position, position));
    const entry = {
      position,
      blockName,
      kind,
      priority,
      notedAt: Date.now(),
    };
    if (existingIndex >= 0) {
      state.memory.resourceTargets[existingIndex] = {
        ...state.memory.resourceTargets[existingIndex],
        ...entry,
      };
    } else {
      state.memory.resourceTargets.push(entry);
    }
    state.memory.resourceTargets.sort((a, b) => b.priority - a.priority);
    if (state.memory.resourceTargets.length > 12) {
      state.memory.resourceTargets.length = 12;
    }
  }

  function removeResourceTarget(target) {
    if (!target?.position) return;
    state.memory.resourceTargets = state.memory.resourceTargets.filter((entry) => !vecEquals(entry.position, target.position));
  }

  function resolveResourceBlock(target) {
    if (!target?.position) return null;
    try {
      const block = bot.blockAt(target.position);
      if (!block) return null;
      if (target.blockName && block.name !== target.blockName) {
        return null;
      }
      return block;
    } catch (error) {
      logger.debug?.(`Failed to resolve resource block: ${error.message}`);
      return null;
    }
  }

  function selectResourceTarget() {
    if (!state.memory.resourceTargets.length) return null;
    const botPosition = bot.entity?.position;
    const scored = state.memory.resourceTargets
      .map((entry) => {
        const dist = botPosition ? Math.sqrt(distanceSquared(botPosition, entry.position)) : Infinity;
        return { entry, dist };
      })
      .sort((a, b) => {
        if (b.entry.priority !== a.entry.priority) {
          return b.entry.priority - a.entry.priority;
        }
        return a.dist - b.dist;
      });
    return scored[0]?.entry ?? null;
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
    state.memory.resourceTargets = state.memory.resourceTargets.filter((entry) => {
      if (!entry) return false;
      if (now - entry.notedAt > brainConfig.resourceForgetMs) return false;
      if (!entry.position) return false;
      try {
        const block = bot.blockAt(entry.position);
        if (!block) return now - entry.notedAt < 5000;
        return block.name === entry.blockName;
      } catch (error) {
        logger.debug?.(`Failed to validate resource target: ${error.message}`);
        return now - entry.notedAt < brainConfig.resourceForgetMs * 0.5;
      }
    });
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
        for (const vec of foundPositions) {
          try {
            const block = bot.blockAt(vec);
            if (block) {
              rememberResourceTarget(block, 'ore', 3);
            }
          } catch (error) {
            logger.debug?.(`Failed to inspect ore block: ${error.message}`);
          }
        }
      } catch (error) {
        logger.debug(`Failed scanning for resources: ${error.message}`);
      }
    }

    if (brainConfig.allowWoodHarvest) {
      try {
        const woodPositions = bot.findBlocks({
          matching: (block) => block && WOOD_BLOCKS.has(block.name),
          maxDistance: 28,
          count: 5,
        });
        for (const vec of woodPositions) {
          try {
            const block = bot.blockAt(vec);
            if (block) {
              rememberResourceTarget(block, 'wood', 2);
            }
          } catch (error) {
            logger.debug?.(`Failed to inspect wood block: ${error.message}`);
          }
        }
      } catch (error) {
        logger.debug(`Failed scanning for wood: ${error.message}`);
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

  function computePlayerGroups() {
    const players = Array.from(state.memory.players.values());
    if (players.length < brainConfig.groupMinSize) return [];
    const radius = Math.max(2, brainConfig.groupFollowRadius || 12);
    const radiusSquared = radius * radius;
    const groups = new Map();
    for (const info of players) {
      const members = players.filter((other) => distanceSquared(info.position, other.position) <= radiusSquared);
      if (members.length < brainConfig.groupMinSize) continue;
      const key = members
        .map((member) => member.username)
        .sort()
        .join('|');
      if (groups.has(key)) continue;
      const center = members.reduce(
        (acc, member) => {
          acc.x += member.position.x;
          acc.y += member.position.y;
          acc.z += member.position.z;
          return acc;
        },
        { x: 0, y: 0, z: 0 },
      );
      const size = members.length;
      const centerVec = new Vec3(
        Math.round(center.x / size),
        Math.round(center.y / size),
        Math.round(center.z / size),
      );
      groups.set(key, { members, size, center: centerVec, notedAt: Date.now() });
    }
    return Array.from(groups.values());
  }

  function strongestGroupInfo() {
    const groups = computePlayerGroups();
    if (groups.length === 0) return null;
    const botPosition = bot.entity?.position;
    return groups
      .map((group) => ({
        ...group,
        distance: botPosition ? Math.sqrt(distanceSquared(botPosition, group.center)) : Infinity,
      }))
      .sort((a, b) => {
        if (b.size !== a.size) return b.size - a.size;
        return a.distance - b.distance;
      })[0];
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

  function shouldEngageThreat(threatInfo, threatDistance) {
    if (!brainConfig.allowCombat) return false;
    if (Date.now() < state.combatCooldownUntil) return false;
    if (!threatInfo?.entityId) return false;
    if (bot.health < brainConfig.combatEngageHealth) return false;
    const entity = bot.entities?.[threatInfo.entityId];
    if (!entity || !entity.position) return false;
    const display = (entity.displayName || entity.name || '').toLowerCase();
    if (display.includes('creeper')) return false;
    if (threatDistance && threatDistance > brainConfig.combatMaxChaseDistance) return false;
    const weapon = findBestWeapon(bot);
    return Boolean(weapon);
  }

  function combatTask(threatInfo) {
    if (!threatInfo?.entityId) return null;
    const entityId = threatInfo.entityId;
    const entity = bot.entities?.[entityId];
    if (!entity) return null;
    const timers = new Set();
    let activeGoal = null;

    const scheduleTimer = (fn, delay) => registerTimeout(fn, delay, timers);

    const clearTimers = () => {
      for (const timer of timers) {
        clearManagedTimeout(timer, timers);
      }
      timers.clear();
    };

    const swing = () => {
      if (state.currentTask?.type !== TaskType.COMBAT) return;
      const target = bot.entities?.[entityId];
      if (!target || !target.position || !bot.entity?.position) return;
      const distance = Math.sqrt(distanceSquared(bot.entity.position, target.position));
      const lookPos = target.position.offset(0, target.height ?? 1.6, 0);
      bot.lookAt(lookPos, true).catch(() => {});
      if (distance <= 3.5) {
        try {
          bot.attack(target);
        } catch (error) {
          logger.debug(`Attack failed: ${error.message}`);
        }
        if (Math.random() < 0.35 && typeof bot.setControlState === 'function') {
          bot.setControlState('jump', true);
          scheduleTimer(() => bot.setControlState('jump', false), 200 + Math.random() * 240);
        }
      }
    };

    const attackLoop = () => {
      if (state.currentTask?.type !== TaskType.COMBAT) return;
      swing();
      scheduleTimer(attackLoop, brainConfig.combatSwingIntervalMs);
    };

    const strafe = () => {
      if (state.currentTask?.type !== TaskType.COMBAT) return;
      if (typeof bot.setControlState === 'function') {
        const dir = Math.random() < 0.5 ? 'left' : 'right';
        bot.setControlState(dir, true);
        scheduleTimer(() => bot.setControlState(dir, false), 240 + Math.random() * 240);
      }
      scheduleTimer(strafe, 1200 + Math.random() * 1400);
    };

    const refreshGoal = () => {
      if (state.currentTask?.type !== TaskType.COMBAT) return;
      const target = bot.entities?.[entityId];
      if (!target || !target.position) return;
      const goal = new Goals.GoalFollow(target, 1);
      activeGoal = goal;
      bot.pathfinder?.setMovements(movements);
      bot.pathfinder?.setGoal(goal, true);
      scheduleTimer(refreshGoal, 4500 + Math.random() * 2000);
    };

    const maintainFocus = () => {
      if (state.currentTask?.type !== TaskType.COMBAT) return;
      const target = bot.entities?.[entityId];
      if (target?.position) {
        bot.lookAt(target.position.offset(0, target.height ?? 1.6, 0), true).catch(() => {});
      }
      scheduleTimer(maintainFocus, brainConfig.combatLookIntervalMs);
    };

    return {
      type: TaskType.COMBAT,
      target: threatInfo,
      startedAt: Date.now(),
      cleanup: () => {
        clearTimers();
        if (bot.pathfinder?.goal === activeGoal) {
          bot.pathfinder.setGoal(null);
        }
        activeGoal = null;
        bot.deactivateItem?.();
        clearControls();
        state.combatCooldownUntil = Date.now() + brainConfig.combatCooldownMs;
        state.lastCombatTime = Date.now();
        state.memory.hostiles.delete(entityId);
      },
      continuePredicate: () => {
        const target = bot.entities?.[entityId];
        if (!target || target.health <= 0) return false;
        if (!bot.entity?.position || !target.position) return false;
        const distance = Math.sqrt(distanceSquared(bot.entity.position, target.position));
        if (distance > brainConfig.combatMaxChaseDistance) return false;
        if (bot.health <= brainConfig.combatDisengageHealth) return false;
        return true;
      },
      engage: () => {
        state.lastCombatTime = Date.now();
        equipForCombat(bot, logger);
        refreshGoal();
        maintainFocus();
        attackLoop();
        strafe();
        logger.warn(`Engaging ${threatInfo?.name || entityId} in combat.`);
      },
    };
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

  function groupFollowTask(groupInfo) {
    if (!groupInfo || !Array.isArray(groupInfo.members) || groupInfo.members.length < brainConfig.groupMinSize) {
      return null;
    }

    const timers = new Set();
    let activeGoal = null;

    const cleanupTimers = () => {
      for (const timer of timers) {
        clearManagedTimeout(timer, timers);
      }
      timers.clear();
    };

    const updateGoal = () => {
      if (state.currentTask?.type !== TaskType.GROUP_FOLLOW) return;
      const currentGroup = strongestGroupInfo();
      const referenceGroup = currentGroup && currentGroup.members.length >= brainConfig.groupMinSize ? currentGroup : groupInfo;
      const anchor = referenceGroup.members.find((member) => bot.players?.[member.username]?.entity);
      if (anchor) {
        const entity = bot.players[anchor.username].entity;
        const goal = new Goals.GoalFollow(entity, brainConfig.followDistance + 1);
        activeGoal = goal;
        bot.pathfinder?.setMovements(movements);
        bot.pathfinder?.setGoal(goal, true);
      } else if (referenceGroup.center) {
        const goal = new Goals.GoalNear(
          referenceGroup.center.x,
          referenceGroup.center.y,
          referenceGroup.center.z,
          brainConfig.followDistance + 2,
        );
        activeGoal = goal;
        bot.pathfinder?.setMovements(movements);
        bot.pathfinder?.setGoal(goal);
      }
      registerTimeout(updateGoal, 4000 + Math.random() * 2000, timers);
    };

    return {
      type: TaskType.GROUP_FOLLOW,
      target: groupInfo,
      startedAt: Date.now(),
      cleanup: () => {
        cleanupTimers();
        if (bot.pathfinder?.goal === activeGoal) {
          bot.pathfinder.setGoal(null);
        }
        clearControls();
      },
      continuePredicate: () => {
        const currentGroup = strongestGroupInfo();
        if (!currentGroup || currentGroup.members.length < brainConfig.groupMinSize) return false;
        const botPos = bot.entity?.position;
        if (!botPos) return false;
        const dist = Math.sqrt(distanceSquared(botPos, currentGroup.center));
        return dist <= Math.max(brainConfig.groupFollowLeash, brainConfig.followMaxDistance + 6);
      },
      engage: () => {
        cleanupTimers();
        updateGoal();
        logger.info(`Shadowing nearby player group of ${groupInfo.members.length} players.`);
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
    const blockName = resource.block?.name || resource.blockName || 'resource';
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
            logger.info(`Collected ${blockName}`);
            removeResourceTarget(resource);
          })
          .catch((error) => {
            logger.warn(`Failed to collect ${blockName}: ${error.message}`);
            removeResourceTarget(resource);
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
        state.asyncTask = null;
        removeResourceTarget(resource);
      },
    };
  }

  function harvestWoodTask(resource) {
    if (!resource?.block) return null;
    const blockName = resource.block?.name || resource.blockName || 'wood';
    return {
      type: TaskType.HARVEST_WOOD,
      target: resource,
      startedAt: Date.now(),
      engage: () => {
        if (!bot.collectBlock) {
          logger.warn('CollectBlock plugin missing; cannot harvest wood.');
          return;
        }
        const collectPromise = bot.collectBlock.collect(resource.block);
        state.asyncTask = {
          promise: collectPromise,
          cancel: () => {
            try {
              bot.collectBlock.cancelTask();
            } catch (error) {
              logger.debug(`Failed to cancel wood harvest: ${error.message}`);
            }
          },
        };
        collectPromise
          .then(() => {
            logger.info(`Gathered ${blockName}`);
            removeResourceTarget(resource);
          })
          .catch((error) => {
            logger.warn(`Failed to gather ${blockName}: ${error.message}`);
            removeResourceTarget(resource);
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
        state.asyncTask = null;
        removeResourceTarget(resource);
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
      const entity = nearestThreat.entityId ? bot.entities?.[nearestThreat.entityId] : null;
      const threatPos = entity?.position || nearestThreat.position;
      const threatDistance = botPos && threatPos ? Math.sqrt(distanceSquared(botPos, threatPos)) : Infinity;
      if (shouldEngageThreat(nearestThreat, threatDistance)) {
        const combat = combatTask(nearestThreat);
        if (combat) {
          return combat;
        }
      }
      if (
        (Number.isFinite(threatDistance) && threatDistance < 8) ||
        now - state.lastDamageTime < brainConfig.dangerCooldownMs ||
        bot.health < brainConfig.lowHealthThreshold
      ) {
        return evadeThreatTask(nearestThreat);
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

    if ((brainConfig.allowMining || brainConfig.allowWoodHarvest) && state.memory.resourceTargets.length > 0) {
      const candidate = selectResourceTarget();
      if (candidate) {
        const block = resolveResourceBlock(candidate);
        if (!block) {
          removeResourceTarget(candidate);
        } else if (candidate.kind === 'ore' && brainConfig.allowMining) {
          return mineResourceTask({ ...candidate, block });
        } else if (candidate.kind === 'wood' && brainConfig.allowWoodHarvest) {
          return harvestWoodTask({ ...candidate, block });
        }
      }
    }

    if (state.memory.pois.length > 0) {
      const poi = state.memory.pois[0];
      return investigatePoiTask(poi);
    }

    const group = strongestGroupInfo();
    if (group) {
      const botPos = bot.entity?.position;
      const dist = botPos ? Math.sqrt(distanceSquared(botPos, group.center)) : Infinity;
      if (
        Number.isFinite(dist) &&
        dist > brainConfig.followDistance &&
        dist < Math.max(brainConfig.groupFollowLeash, brainConfig.followMaxDistance + 6)
      ) {
        const groupTask = groupFollowTask(group);
        if (groupTask) {
          return groupTask;
        }
      }
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
    if (current?.type === TaskType.EVADE_THREAT || current?.type === TaskType.COMBAT) return;

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

  bot.on('health', () => {
    if (bot.health < brainConfig.combatDisengageHealth) {
      state.lastDamageTime = Date.now();
    }
  });

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
    if (oldBlock?.position) {
      const match = state.memory.resourceTargets.find((entry) => vecEquals(entry.position, oldBlock.position));
      if (match && (!newBlock || newBlock.name !== match.blockName)) {
        removeResourceTarget(match);
      }
    }
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
