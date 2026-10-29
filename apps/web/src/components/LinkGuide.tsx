'use client';

import { ko } from '@/i18n/ko';
import { CopyButton } from './CopyButton';
import { ui } from './ui';
import s from './link-guide.module.css';

/** How to connect your own Claude to ENU Den (same content as docs/employee-onboarding.ko.md). */
export function LinkGuide({ mcpUrl, compact = false }: { mcpUrl: string; compact?: boolean }) {
  const g = ko.linkGuide;
  return (
    <div className={s.guide}>
      <ol className={s.steps}>
        {g.steps.map((step, i) => (
          <li key={i} className={s.step}>
            <span className={s.num} aria-hidden="true">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      <div className={s.block}>
        <div className={s.blockLabel}>{g.urlLabel}</div>
        <div className={ui.copyBox}>
          <code>{mcpUrl}</code>
          <CopyButton text={mcpUrl} />
        </div>
        <p className={ui.help}>{g.urlHelp}</p>
      </div>

      {!compact && (
        <>
          <div className={s.block}>
            <div className={s.blockLabel}>{g.codeTitle}</div>
            <div className={ui.copyBox}>
              <code>{g.codeCommand(mcpUrl)}</code>
              <CopyButton text={g.codeCommand(mcpUrl)} />
            </div>
          </div>
          <div className={s.faq}>
            <strong>Q. {g.faqQ}</strong>
            <span>{g.faqA}</span>
          </div>
        </>
      )}
    </div>
  );
}
