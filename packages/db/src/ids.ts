import { v7 as uuidv7 } from 'uuid';

/** Time-ordered UUIDv7 ids for app tables (and Better Auth via advanced.database.generateId). */
export function newId(): string {
  return uuidv7();
}
