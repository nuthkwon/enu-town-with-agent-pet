import type { ButtonHTMLAttributes, ReactNode } from 'react';
import s from './ui.module.css';

/** Small, dependency-free UI primitives shared by every page (server- and client-safe). */

export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  block = false,
): string {
  return cx(s.button, s[variant], size === 'sm' && s.sm, size === 'lg' && s.lg, block && s.block);
}

export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
}) {
  return <button type={type} className={cx(buttonClass(variant, size, block), className)} {...rest} />;
}

export function Card({
  title,
  subtitle,
  actions,
  tight = false,
  className,
  children,
  id,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  tight?: boolean;
  className?: string;
  children?: ReactNode;
  id?: string;
}) {
  return (
    <section className={cx(s.card, tight && s.cardTight, className)} id={id}>
      {(title || actions) && (
        <div className={s.cardHeader}>
          <div>
            {title && <h2 className={s.cardTitle}>{title}</h2>}
            {subtitle && <p className={s.cardSub}>{subtitle}</p>}
          </div>
          {actions && <div className={s.row}>{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export type Tone = 'lavender' | 'pink' | 'mint' | 'amber' | 'sky' | 'gray' | 'danger';

export function Badge({
  tone = 'lavender',
  dot = false,
  children,
  title,
}: {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={cx(s.badge, s[`tone-${tone}`], dot && s.dot)} title={title}>
      {children}
    </span>
  );
}

export function Field({
  label,
  htmlFor,
  help,
  error,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  help?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={s.field}>
      <label className={s.label} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {help && <p className={s.help}>{help}</p>}
      {error && <p className={s.error}>{error}</p>}
    </div>
  );
}

export const inputClass = s.input;
export const selectClass = s.select;
export const textareaClass = s.textarea;

export function Toggle({
  checked,
  onChange,
  label,
  help,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  help?: ReactNode;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <label className={s.toggle} htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={s.track} aria-hidden="true" />
      <span className={s.toggleText}>
        <span>{label}</span>
        {help && <span className={s.help}>{help}</span>}
      </span>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className={s.segmented} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={s.segment}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export type NoticeTone = 'info' | 'warn' | 'error' | 'success';

const NOTICE_ICON: Record<NoticeTone, string> = { info: 'i', warn: '!', error: '!', success: '✓' };

export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={cx(s.notice, s[`notice-${tone}`])} role={tone === 'error' ? 'alert' : 'status'}>
      <span className={s.noticeIcon} aria-hidden="true">
        {NOTICE_ICON[tone]}
      </span>
      <div>
        {title && <strong>{title}</strong>}
        {children}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className={s.empty}>{children}</div>;
}

export const ui = s;
