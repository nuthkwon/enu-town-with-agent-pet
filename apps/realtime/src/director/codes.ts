import type { ActivityName, ActivitySource, PlateNoteName } from '@enu/domain';
import { ActivityCode, PlateNote, SourceCode } from '@enu/protocol';

/**
 * Domain names -> the small integer codes of the synced state. Korean labels live in the web app
 * (`ko.townUi.activity`, `ko.townUi.source`, `ko.townUi.note`); the server only sends codes.
 */

const ACTIVITY: Readonly<Record<ActivityName, ActivityCode>> = {
  none: ActivityCode.None,
  available: ActivityCode.Available,
  focus: ActivityCode.Focus,
  meeting: ActivityCode.Meeting,
  break: ActivityCode.Break,
  work: ActivityCode.Work,
  docs: ActivityCode.Docs,
  review: ActivityCode.Review,
  collab: ActivityCode.Collab,
  today: ActivityCode.Today,
};

const SOURCE: Readonly<Record<ActivitySource, SourceCode>> = {
  none: SourceCode.None,
  manual: SourceCode.Manual,
  calendar: SourceCode.Calendar,
  claude: SourceCode.Claude,
  work_log: SourceCode.WorkLog,
  town: SourceCode.Town,
};

const NOTE: Readonly<Record<PlateNoteName, PlateNote>> = {
  none: PlateNote.None,
  away: PlateNote.Away,
  absent: PlateNote.Absent,
};

export function activityCode(a: ActivityName): ActivityCode {
  return ACTIVITY[a];
}

export function sourceCode(s: ActivitySource): SourceCode {
  return SOURCE[s];
}

export function plateNoteCode(n: PlateNoteName): PlateNote {
  return NOTE[n];
}
