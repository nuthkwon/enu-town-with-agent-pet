/**
 * Container healthcheck entry (`node dist/healthcheck.mjs`): exit 0 when the worker wrote its
 * heartbeat within the last 90 s, 1 otherwise. Deliberately has no env or DB dependency.
 */
import { checkHeartbeat } from './health';

const healthy = await checkHeartbeat();
process.exit(healthy ? 0 : 1);
