import { WORK_REQUEST_KINDS } from '@enu/shared';

export type WorkRequestKind = (typeof WORK_REQUEST_KINDS)[number];

/**
 * Work request templates offered for a colleague: generic kinds (teams: null) always, plus the
 * kinds meant for the colleague's team (e.g. '검토 요청 (SQA)' only for 품질보증팀).
 * Team-specific kinds come first so the role-aware request is the first choice.
 */
export function workRequestsFor(team: string | null | undefined): WorkRequestKind[] {
  const specific: WorkRequestKind[] = [];
  const generic: WorkRequestKind[] = [];
  for (const kind of WORK_REQUEST_KINDS) {
    if (kind.teams === null) generic.push(kind);
    else if (team && (kind.teams as readonly string[]).includes(team)) specific.push(kind);
  }
  return [...specific, ...generic];
}

/** DM draft text for a request kind (the template only; the user fills it in and sends it). */
export function workRequestDraft(kindId: string): string {
  return WORK_REQUEST_KINDS.find((k) => k.id === kindId)?.template ?? '';
}
