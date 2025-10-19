import { createCognitiveBrain } from './brain.js';

export function enableAutonomousBrain(bot, logger, behaviorConfig, aiController) {
  const settings = behaviorConfig?.autonomous;
  if (!settings?.enabled) {
    return {
      pause: () => {},
      notifyManualActivity: () => {},
    };
  }

  const brain = createCognitiveBrain(bot, logger, aiController, behaviorConfig);
  return {
    pause: brain.pause,
    notifyManualActivity: brain.notifyManualActivity,
  };
}
