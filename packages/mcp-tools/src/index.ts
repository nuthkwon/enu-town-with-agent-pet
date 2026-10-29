/**
 * @enu/mcp-tools — the five ENU Den MCP tools (get_my_context, post_work_log, post_activity,
 * upsert_todos, post_pet_nudges) on @modelcontextprotocol/server. Mounted by apps/web at /api/mcp
 * behind token verification; see buildEnuDenMcpServer.
 */
export {
  activitySummaryKo,
  buildEnuDenMcpServer,
  callerFromAuthInfo,
  contextSummaryKo,
  nudgesSummaryKo,
  todosSummaryKo,
  workLogSummaryKo,
  type CallerInfo,
  type McpDeps,
} from './server';
export { SERVER_INSTRUCTIONS, TOOL_DESCRIPTIONS, TOOL_TITLES } from './descriptions';
export {
  SlidingWindowRateLimiter,
  TOOL_RATE_LIMITS,
  rateLimitKey,
  type RateLimitDecision,
  type RateLimitRule,
  type RateLimiter,
} from './rate-limit';
export {
  LINK_REVOKED_MESSAGE,
  NOT_AUTHENTICATED_MESSAGE,
  ToolError,
  errorResult,
  okResult,
  type ToolErrorCode,
  type ToolProblem,
} from './result';
export { activeOwnerStatus, findOwnerContext, loadOwnerContext, type OwnerContext } from './owner';
export {
  lockOwnerScope,
  markLinkedAfterWorkLog,
  recordLinkWrite,
  touchClaudeLink,
  type TouchLinkResult,
} from './links';
export { MANUAL_STATUS_KO, NOW_KIND_KO, formatLocalIso } from './format';
export { activityRefHash, postActivity, type PostActivityOptions } from './services/activity';
export {
  CONTEXT_LIMITS,
  countUnreadDms,
  getMyContext,
  resolveSince,
  type GetMyContextOptions,
} from './services/context';
export { postWorkLog, workLogViewUrl, type PostWorkLogOptions } from './services/work-log';
export { isRealCalendarDate, prepareTodoItems, upsertTodos } from './services/todos';
export { firstVisibleTime, postPetNudges } from './services/nudges';
