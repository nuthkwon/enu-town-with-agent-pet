export interface RetentionDays {
  dm: number;
  roomChat: number;
  workLog: number;
  nudge: number;
  audit: number;
  /** Pet conversations, by the message's day (`pet_messages.day_key`). */
  petMessage: number;
}

export const DEFAULT_RETENTION: RetentionDays = {
  dm: 90,
  roomChat: 30,
  workLog: 90,
  nudge: 14,
  audit: 365,
  petMessage: 90,
};

const DAY = 24 * 60 * 60 * 1000;

export function retentionCutoffs(now: Date, days: RetentionDays) {
  const before = (d: number) => new Date(now.getTime() - d * DAY);
  return {
    dm: before(days.dm),
    roomChat: before(days.roomChat),
    workLog: before(days.workLog),
    nudge: before(days.nudge),
    audit: before(days.audit),
    petMessage: before(days.petMessage),
  };
}
