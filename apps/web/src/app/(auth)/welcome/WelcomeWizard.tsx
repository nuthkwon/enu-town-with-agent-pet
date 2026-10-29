'use client';

import type { AvatarPreset, DeskDto, MeDto, PetSpecies, Visibility } from '@enu/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AvatarEditor, type AvatarSwatches } from '@/components/AvatarEditor';
import { LinkGuide } from '@/components/LinkGuide';
import { isTaken, pickFreeSpecies } from '@/components/petChoice';
import { PetPicker } from '@/components/PetPicker';
import { SeatMap } from '@/components/SeatMap';
import { EffectIcon } from '@/components/town/EffectIcon';
import { Button, Notice, cx } from '@/components/ui';
import { ko } from '@/i18n/ko';
import { ApiRequestError, apiFetch, describeError } from '@/lib/api';
import s from './welcome.module.css';

const w = ko.welcome;
const STEPS = w.steps;
const STEP = { notice: 0, desk: 1, avatar: 2, pet: 3, chatSummary: 4, activity: 5, link: 6 } as const;

export function WelcomeWizard({
  me,
  desks,
  swatches,
}: {
  me: MeDto;
  desks: DeskDto[];
  swatches: AvatarSwatches;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [accepted, setAccepted] = useState(me.noticeAccepted);
  const [deskId, setDeskId] = useState<string | null>(me.deskId);
  const [avatar, setAvatar] = useState<AvatarPreset>(me.avatar);
  const [taken, setTaken] = useState<readonly string[]>(me.takenPetSpecies);
  const [pet, setPet] = useState<{ species: PetSpecies; name: string }>(() => ({
    species: pickFreeSpecies(me.pet.species, me.takenPetSpecies),
    name: me.pet.name,
  }));
  const [chatVis, setChatVis] = useState<Visibility>(me.prefs.defaultChatSummaryVisibility ?? 'private');
  // 활동 공유 is an explicit choice: nothing is preselected (null = not chosen yet).
  const [shareActivity, setShareActivity] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const petOk = pet.name.trim().length > 0 && !isTaken(pet.species, taken);
  const canNext =
    step === STEP.notice
      ? accepted
      : step === STEP.pet
        ? petOk
        : step === STEP.activity
          ? shareActivity !== null
          : true;
  const last = step === STEPS.length - 1;

  async function finish() {
    if (shareActivity === null) {
      setStep(STEP.activity);
      setError(w.needActivity);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch<MeDto>('/api/v1/me/onboarding', {
        method: 'POST',
        body: {
          accept_notice_version: me.noticeVersion,
          desk_id: deskId,
          avatar,
          pet_species: pet.species,
          pet_name: pet.name.trim(),
          default_chat_summary_visibility: chatVis,
          share_activity: shareActivity,
        },
      });
      router.replace('/town');
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiRequestError && e.code === 'pet_taken') {
        // Someone picked this species meanwhile: grey it out and let the user choose again.
        const nextTaken = [...taken, pet.species];
        setTaken(nextTaken);
        setPet((p) => ({ ...p, species: pickFreeSpecies(p.species, nextTaken) }));
        setStep(STEP.pet);
        setError(ko.errors.petTaken);
        return;
      }
      if (e instanceof ApiRequestError && e.code === 'desk_taken') setStep(STEP.desk);
      setError(describeError(e));
    }
  }

  function go(delta: number) {
    setError(null);
    if (delta > 0 && !canNext) {
      setError(
        step === STEP.notice
          ? w.needNotice
          : step === STEP.activity
            ? w.needActivity
            : !pet.name.trim()
              ? w.needPetName
              : w.needPet,
      );
      return;
    }
    setStep((v) => Math.min(Math.max(v + delta, 0), STEPS.length - 1));
  }

  return (
    <div className={s.wrap}>
      <header className={s.header}>
        <h1 className={s.title}>{w.title}</h1>
        <p className={s.lead}>{w.lead(me.displayName)}</p>
        <ol className={s.stepper} aria-label="진행 단계">
          {STEPS.map((label, i) => (
            <li
              key={label}
              className={cx(s.stepItem, i === step && s.stepActive, i < step && s.stepDone)}
              aria-current={i === step ? 'step' : undefined}
            >
              <span className={s.stepDot}>{i < step ? '✓' : i + 1}</span>
              <span className={s.stepLabel}>{label}</span>
            </li>
          ))}
        </ol>
      </header>

      <section className={s.card} aria-live="polite">
        <div className={s.stepCount}>{w.stepOf(step + 1, STEPS.length)}</div>

        {step === STEP.notice && (
          <div>
            <h2>{w.notice.title}</h2>
            <ul className={s.points}>
              {w.notice.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <p>
              <Link href="/privacy" target="_blank">
                {w.notice.fullLink} ↗
              </Link>
            </p>
            <label className={s.accept}>
              <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
              <span>{w.notice.accept(me.noticeVersion)}</span>
            </label>
          </div>
        )}

        {step === STEP.desk && (
          <div>
            <h2>{w.desk.title}</h2>
            <p className={s.help}>{w.desk.help}</p>
            <SeatMap desks={desks} myUserId={me.userId} selected={deskId} onSelect={setDeskId} />
            <div className={s.deskFoot}>
              <span>{deskId ? w.desk.selected(deskId) : w.desk.noDesk}</span>
              {deskId && !me.deskId && (
                <Button variant="ghost" size="sm" onClick={() => setDeskId(null)}>
                  {w.desk.noDesk}
                </Button>
              )}
            </div>
          </div>
        )}

        {step === STEP.avatar && (
          <div>
            <h2>{w.avatar.title}</h2>
            <p className={s.help}>{w.avatar.help}</p>
            <AvatarEditor value={avatar} onChange={setAvatar} swatches={swatches} />
          </div>
        )}

        {step === STEP.pet && (
          <div>
            <h2>{w.pet.title}</h2>
            <p className={s.help}>{w.pet.help}</p>
            <PetPicker species={pet.species} name={pet.name} taken={taken} onChange={setPet} />
          </div>
        )}

        {step === STEP.chatSummary && (
          <div>
            <h2>{w.chatSummary.title}</h2>
            <p className={s.help}>{w.chatSummary.help}</p>
            <div className={s.choices} role="radiogroup" aria-label={w.chatSummary.title}>
              {(
                [
                  ['private', w.chatSummary.privateTitle, w.chatSummary.privateBody],
                  ['company', w.chatSummary.companyTitle, w.chatSummary.companyBody],
                ] as const
              ).map(([value, title, body]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={chatVis === value}
                  className={cx(s.choice, chatVis === value && s.choiceOn)}
                  onClick={() => setChatVis(value)}
                >
                  <span className={s.choiceTitle}>{title}</span>
                  <span className={s.choiceBody}>{body}</span>
                </button>
              ))}
            </div>
            <p className={s.help}>{w.chatSummary.later}</p>
          </div>
        )}

        {step === STEP.activity && (
          <div>
            <h2>{w.activity.title}</h2>
            <p className={s.help}>{w.activity.help}</p>
            <p className={s.question}>{w.activity.question}</p>
            <div className={s.choices} role="radiogroup" aria-label={w.activity.title}>
              <button
                type="button"
                role="radio"
                aria-checked={shareActivity === true}
                className={cx(s.choice, shareActivity === true && s.choiceOn)}
                onClick={() => setShareActivity(true)}
              >
                <span className={s.choiceTitle}>{w.activity.shareTitle}</span>
                <span className={s.choicePreview}>
                  <EffectIcon name="headset" />
                  {w.activity.sharePreview}
                </span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={shareActivity === false}
                className={cx(s.choice, shareActivity === false && s.choiceOn)}
                onClick={() => setShareActivity(false)}
              >
                <span className={s.choiceTitle}>{w.activity.noShareTitle}</span>
                <span className={s.choicePreview}>{w.activity.noSharePreview}</span>
              </button>
            </div>
            <p className={s.reciprocity}>{w.activity.reciprocity}</p>
            <p className={s.help}>{w.activity.later}</p>
          </div>
        )}

        {step === STEP.link && (
          <div>
            <h2>{w.link.title}</h2>
            <p className={s.help}>{w.link.help}</p>
            <LinkGuide mcpUrl={me.mcpUrl} />
          </div>
        )}

        {error && (
          <div className={s.error}>
            <Notice tone="error">{error}</Notice>
          </div>
        )}

        <div className={s.nav}>
          <Button variant="ghost" onClick={() => go(-1)} disabled={step === 0 || busy}>
            {ko.common.prev}
          </Button>
          {last ? (
            <Button onClick={finish} disabled={busy} size="lg">
              {busy ? w.finishing : w.finish}
            </Button>
          ) : (
            <Button onClick={() => go(1)} disabled={!canNext}>
              {ko.common.next}
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
