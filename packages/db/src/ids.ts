import { v4 as uuidv4, v7 as uuidv7 } from 'uuid';

/** Time-ordered UUIDv7 ids for app tables (and Better Auth via advanced.database.generateId). */
export function newId(): string {
  return uuidv7();
}

/**
 * Random UUIDv4 ids for rows whose id colleagues receive while the row's times are owner-only: the first
 * 48 bits of a UUIDv7 are its creation time in ms, so a v7 work-log id would give away when the owner's
 * Claude first wrote that day (`canViewLogTimestamps`). Used for `work_logs`.
 */
export function newOpaqueId(): string {
  return uuidv4();
}
