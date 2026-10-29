import { PRIVACY_NOTICE_VERSION } from '@enu/shared';
import type { Metadata } from 'next';
import { Badge } from '@/components/ui';
import { ko } from '@/i18n/ko';
import s from '../doc.module.css';

export const metadata: Metadata = { title: ko.privacy.title };

type Section = (typeof ko.privacy.sections)[number];

function SectionBlock({ section }: { section: Section }) {
  return (
    <section className={s.section}>
      <h2>{section.heading}</h2>
      {section.paragraphs?.map((p) => (
        <p key={p}>{p}</p>
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

export default function PrivacyPage() {
  const p = ko.privacy;
  const before = p.sections.slice(0, 4);
  const after = p.sections.slice(4);
  return (
    <article className={s.doc}>
      <header className={s.head}>
        <h1>{p.title}</h1>
        <div className={s.meta}>
          <Badge tone="lavender">{p.version(PRIVACY_NOTICE_VERSION)}</Badge>
        </div>
        <p className={s.callout}>{p.notEvaluation}</p>
      </header>
      {before.map((sec) => (
        <SectionBlock key={sec.heading} section={sec} />
      ))}
      <section className={s.section}>
        <h2>{p.retentionHeading}</h2>
        <table className={s.table}>
          <thead>
            <tr>
              <th>{p.retentionColumns[0]}</th>
              <th>{p.retentionColumns[1]}</th>
            </tr>
          </thead>
          <tbody>
            {p.retention.map(([what, how]) => (
              <tr key={what}>
                <td>{what}</td>
                <td>{how}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={s.note}>{p.retentionNote}</p>
      </section>
      {after.map((sec) => (
        <SectionBlock key={sec.heading} section={sec} />
      ))}
    </article>
  );
}
