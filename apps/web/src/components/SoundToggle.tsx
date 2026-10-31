'use client';

import { ko } from '@/i18n/ko';
import { soundEngine } from '@/sound/engine';
import { useSoundState } from '@/sound/useSessionSfx';

/**
 * The speaker button (top bar of the town and the messenger). Before the first gesture the browser keeps audio
 * locked: pressing the button then wakes the sound instead of turning it off. `data-sound-state` also tells the
 * engine's gesture listener to leave presses here to this onClick (by mouse, touch or keyboard).
 */
export function SoundToggle({ className }: { className?: string }) {
  const state = useSoundState();
  const label = state === 'on' ? ko.sound.on : state === 'off' ? ko.sound.off : ko.sound.wake;
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      title={label}
      aria-pressed={state === 'on'}
      data-sound-state={state}
      onClick={() => soundEngine().pressSpeaker(state)}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor" />
        {state === 'off' ? (
          <path d="M11 6l4 4M15 6l-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        ) : (
          <>
            <path
              d="M11 5.5a3.5 3.5 0 0 1 0 5"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
              opacity={state === 'locked' ? 0.45 : 1}
            />
            <path
              d="M12.8 3.6a6 6 0 0 1 0 8.8"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
              opacity={state === 'locked' ? 0.45 : 1}
            />
          </>
        )}
      </svg>
    </button>
  );
}
