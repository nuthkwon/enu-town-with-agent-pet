import type { CallToolResult } from '@modelcontextprotocol/server';
import { LIMITS } from '@enu/shared';

/** A field-level problem reported back to Claude so it can rewrite (ENU Town never edits text). */
export interface ToolProblem {
  /** Item index for batch tools (upsert_todos items[i]). */
  index?: number;
  field: string;
  reason: string;
  detail?: string;
}

export type ToolErrorCode =
  | 'not_authenticated'
  | 'link_revoked'
  | 'rate_limited'
  | 'profile_missing'
  | 'validation_failed'
  | 'open_todo_limit'
  | 'internal_error';

/** A tool-level failure returned as an `isError` result (never thrown to the client). */
export class ToolError extends Error {
  readonly code: ToolErrorCode;
  readonly problems: ToolProblem[] | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(code: ToolErrorCode, message: string, opts: { problems?: ToolProblem[]; retryAfterSeconds?: number } = {}) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.problems = opts.problems;
    this.retryAfterSeconds = opts.retryAfterSeconds;
  }
}

export const NOT_AUTHENTICATED_MESSAGE = 'not authenticated';
export const LINK_REVOKED_MESSAGE = 'connector link revoked; reconnect in Claude settings';

/**
 * Error results carry only text content (no structuredContent) so strict clients never try
 * to validate them against the success outputSchema. The second line is machine-readable JSON.
 */
export function errorResult(err: ToolError): CallToolResult {
  const payload: Record<string, unknown> = { error: err.code, message: err.message };
  if (err.problems?.length) payload.problems = err.problems;
  if (err.retryAfterSeconds !== undefined) payload.retry_after_seconds = err.retryAfterSeconds;
  let json = JSON.stringify(payload);
  const max = LIMITS.toolResultMaxChars - err.message.length - 1;
  if (json.length > max && err.problems) {
    // Keep the result under the limit by listing only the first problems.
    const problems = [...err.problems];
    while (problems.length > 1 && json.length > max) {
      problems.pop();
      json = JSON.stringify({ ...payload, problems, problems_truncated: true });
    }
  }
  return { isError: true, content: [{ type: 'text', text: `${err.message}\n${json}` }] };
}

/** Size of what the model reads for a success result: the Korean summary plus the JSON copy. */
export function resultChars(summary: string, structured: unknown): number {
  return summary.length + 1 + JSON.stringify(structured).length;
}

/**
 * Success result: `structuredContent` matches the tool's outputSchema; the text content holds a
 * short Korean summary plus the same JSON (MCP back-compat for clients that only read text).
 * `shrink` is called while the result is over `LIMITS.toolResultMaxChars`; it must return false
 * when nothing more can be dropped.
 */
export function okResult<T extends object>(
  summary: (s: T, truncated: boolean) => string,
  structured: T,
  shrink?: (s: T) => boolean,
): CallToolResult {
  let truncated = false;
  let text = summary(structured, truncated);
  while (shrink && resultChars(text, structured) > LIMITS.toolResultMaxChars) {
    if (!shrink(structured)) break;
    truncated = true;
    text = summary(structured, truncated);
  }
  return {
    content: [
      { type: 'text', text },
      { type: 'text', text: JSON.stringify(structured) },
    ],
    structuredContent: structured as Record<string, unknown>,
  };
}
