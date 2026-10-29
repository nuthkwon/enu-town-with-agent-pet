import { PRIVACY_NOTICE_VERSION } from '@enu/shared';
import type { Metadata } from 'next';
import { Badge } from '@/components/ui';
import { ko, type PrivacySection, type PrivacyTable } from '@/i18n/ko';
import s from '../doc.module.css';

export const metadata: Metadata = { title: ko.privacy.title };

function Table({ table }: { table: PrivacyTable }) {
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        {table.caption && <caption className={s.caption}>{table.caption}</caption>}
        <thead>
          <tr>
            {table.columns.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.join('|')}>
              {row.map((cell, i) => (
                <td key={`${i}:${cell}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionBlock({ section }: { section: PrivacySection }) {
  return (
    <section className={s.section}>
      <h2>{section.heading}</h2>
      {section.paragraphs?.map((p) => (
        <p key={p}>{p}</p>
      ))}
      {section.tables?.map((t) => (
        <Table key={`${section.heading}:${t.caption ?? t.columns.join('|')}`} table={t} />
      ))}
      {section.bullets && (
        <ul>
          {section.bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** /privacy: rendered from `ko.privacy`, the single source of the notice text (docs copy it verbatim). */
export default function PrivacyPage() {
  const p = ko.privacy;
  return (
    <article className={s.doc}>
      <header className={s.head}>
        <h1>{p.title}</h1>
        <div className={s.meta}>
          <Badge tone="lavender">{p.version(PRIVACY_NOTICE_VERSION)}</Badge>
        </div>
        <p className={s.callout}>{p.notEvaluation}</p>
        <aside className={s.review} aria-label={p.reviewTitle}>
          <strong>{p.reviewTitle}</strong>
          <ul>
            {p.review.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </aside>
      </header>
      {p.sections.map((sec) => (
        <SectionBlock key={sec.heading} section={sec} />
      ))}
    </article>
  );
}
