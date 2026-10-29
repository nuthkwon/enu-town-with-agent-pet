import { TEAMS, type DeskDto, type PersonDto } from '@enu/shared';
import { TypedEmitter } from './emitter';

export const FALLBACK_TEAM_COLOR = '#c9b8e8';

export function teamColor(teamId: string | null | undefined): string {
  return TEAMS.find((t) => t.id === teamId)?.color ?? FALLBACK_TEAM_COLOR;
}

export function teamColorNumber(teamId: string | null | undefined): number {
  return Number.parseInt(teamColor(teamId).slice(1), 16);
}

export interface DirectorySnapshot {
  version: number;
  people: readonly PersonDto[];
  desks: readonly DeskDto[];
}

/**
 * People and desk owners (REST: /api/v1/people, /api/v1/desks), shared by React panels and the
 * Phaser world (name-tag team colours, desk name plates, clicks on offline people's desks).
 */
export class TownDirectory extends TypedEmitter<{ change: void }> {
  private snapshot: DirectorySnapshot = { version: 0, people: [], desks: [] };
  private readonly byId = new Map<string, PersonDto>();
  private readonly deskById = new Map<string, DeskDto>();

  getSnapshot = (): DirectorySnapshot => this.snapshot;

  setPeople(people: readonly PersonDto[]): void {
    this.byId.clear();
    for (const p of people) this.byId.set(p.userId, p);
    this.snapshot = { ...this.snapshot, version: this.snapshot.version + 1, people: [...people] };
    this.emit('change');
  }

  setDesks(desks: readonly DeskDto[]): void {
    this.deskById.clear();
    for (const d of desks) this.deskById.set(d.deskId, d);
    this.snapshot = { ...this.snapshot, version: this.snapshot.version + 1, desks: [...desks] };
    this.emit('change');
  }

  person(userId: string): PersonDto | undefined {
    return this.byId.get(userId);
  }

  desk(deskId: string): DeskDto | undefined {
    return this.deskById.get(deskId);
  }

  get people(): readonly PersonDto[] {
    return this.snapshot.people;
  }

  get desks(): readonly DeskDto[] {
    return this.snapshot.desks;
  }
}
