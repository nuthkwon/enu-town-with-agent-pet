import type { Metadata } from 'next';
import { PetSprite } from '@/components/sprites';
import { ko } from '@/i18n/ko';
import s from '../doc.module.css';

export const metadata: Metadata = { title: ko.credits.title };

export default function CreditsPage() {
  const c = ko.credits;
  const groups: [string, readonly string[]][] = [
    [c.fontsTitle, c.fonts],
    [c.artTitle, c.art],
    [c.libsTitle, c.libs],
    [c.inspirationTitle, c.inspiration],
  ];
  return (
    <article className={s.doc}>
      <header className={s.head}>
        <div className={s.petParade} aria-hidden="true">
          {(['cat', 'bunny', 'fox', 'chick', 'hamster', 'dragon'] as const).map((sp) => (
            <PetSprite key={sp} species={sp} scale={2} animate />
          ))}
        </div>
        <h1>{c.title}</h1>
      </header>
      {groups.map(([title, items]) => (
        <section key={title} className={s.section}>
          <h2>{title}</h2>
          <ul>
            {items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </section>
      ))}
    </article>
  );
}
