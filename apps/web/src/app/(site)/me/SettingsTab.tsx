'use client';

import type { MeDto, Visibility } from '@enu/shared';
import { useState } from 'react';
import { Button, Card, Field, Notice, Segmented, Toggle, inputClass } from '@/components/ui';
import { ko } from '@/i18n/ko';
import { apiFetch, describeError } from '@/lib/api';
import s from './me.module.css';

const t = ko.me.settings;

const visibilityOptions = [
  { value: 'company' as const, label: ko.visibility.company },
  { value: 'private' as const, label: ko.visibility.private },
];

export function SettingsTab({ me, onSaved }: { me: MeDto; onSaved: (me: MeDto) => void }) {
  const p = me.prefs;
  const [nudgesEnabled, setNudgesEnabled] = useState(p.nudgesEnabled);
  const [intervalMin, setIntervalMin] = useState(p.nudgeMinIntervalMin);
  const [cap, setCap] = useState(p.maxBubblesPerDay);
  const [quietStart, setQuietStart] = useState(p.quietStart);
  const [quietEnd, setQuietEnd] = useState(p.quietEnd);
  const [defaultLog, setDefaultLog] = useState<Visibility>(p.defaultLogVisibility);
  const [defaultChat, setDefaultChat] = useState<Visibility>(p.defaultChatSummaryVisibility ?? 'private');
  const [defaultPetChat, setDefaultPetChat] = useState<Visibility>(p.petChatDefaultVisibility);
  const [shareDms, setShareDms] = useState(p.shareDmsWithMyClaude);
  // 활동 공유: null = never chosen (off). Only an actual change is sent (false deletes today's report).
  const [shareActivity, setShareActivity] = useState(me.shareActivity === true);
  const [showLive, setShowLive] = useState(me.showLive);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const next = await apiFetch<MeDto>('/api/v1/me/profile', {
        method: 'PATCH',
        body: {
          nudges_enabled: nudgesEnabled,
          nudge_min_interval_min: intervalMin,
          max_bubbles_per_day: cap,
          quiet_start: quietStart,
          quiet_end: quietEnd,
          default_log_visibility: defaultLog,
          default_chat_summary_visibility: defaultChat,
          // Only a real change is sent: it grants or withdraws the pet_chat_sharing consent.
          ...(defaultPetChat !== p.petChatDefaultVisibility
            ? { pet_chat_default_visibility: defaultPetChat }
            : {}),
          share_dms_with_my_claude: shareDms,
          ...(shareActivity !== (me.shareActivity === true) ? { share_activity: shareActivity } : {}),
          ...(showLive !== me.showLive ? { show_live: showLive } : {}),
        },
      });
      onSaved(next);
      setMessage({ tone: 'success', text: ko.common.saved });
    } catch (e) {
      setMessage({ tone: 'error', text: describeError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card title={t.townTitle}>
        <Toggle
          id="share-activity"
          checked={shareActivity}
          onChange={setShareActivity}
          label={t.shareActivity}
          help={t.shareActivityHelp}
        />
        {me.shareActivity === null && <p className={s.footNote}>{t.shareActivityUnset}</p>}
        <div style={{ marginTop: 14 }}>
          <Toggle
            id="show-live"
            checked={showLive}
            onChange={setShowLive}
            label={t.showLive}
            help={t.showLiveHelp}
          />
        </div>
      </Card>

      <Card title={t.nudgesTitle}>
        <Toggle
          id="nudges-enabled"
          checked={nudgesEnabled}
          onChange={setNudgesEnabled}
          label={t.nudgesEnabled}
        />
        <div className={s.formGrid} style={{ marginTop: 16 }}>
          <Field label={t.interval} htmlFor="nudge-interval">
            <input
              id="nudge-interval"
              type="number"
              min={10}
              max={240}
              className={inputClass}
              value={intervalMin}
              onChange={(e) => setIntervalMin(Number(e.target.value))}
            />
          </Field>
          <Field label={t.dailyCap} htmlFor="nudge-cap">
            <input
              id="nudge-cap"
              type="number"
              min={0}
              max={30}
              className={inputClass}
              value={cap}
              onChange={(e) => setCap(Number(e.target.value))}
            />
          </Field>
          <Field label={t.quietStart} htmlFor="quiet-start">
            <input
              id="quiet-start"
              type="time"
              className={inputClass}
              value={quietStart}
              onChange={(e) => setQuietStart(e.target.value)}
            />
          </Field>
          <Field label={t.quietEnd} htmlFor="quiet-end">
            <input
              id="quiet-end"
              type="time"
              className={inputClass}
              value={quietEnd}
              onChange={(e) => setQuietEnd(e.target.value)}
            />
          </Field>
        </div>
        <p className={s.footNote}>{t.quietHelp}</p>
      </Card>

      <Card title={t.visibilityTitle}>
        <Field label={t.defaultLog} help={t.defaultLogHelp}>
          <Segmented<Visibility>
            label={t.defaultLog}
            value={defaultLog}
            options={visibilityOptions}
            onChange={setDefaultLog}
          />
        </Field>
        <Field label={t.defaultChat} help={t.defaultChatHelp}>
          <Segmented<Visibility>
            label={t.defaultChat}
            value={defaultChat}
            options={visibilityOptions}
            onChange={setDefaultChat}
          />
        </Field>
        <Field label={t.defaultPetChat} help={t.defaultPetChatHelp}>
          <Segmented<Visibility>
            label={t.defaultPetChat}
            value={defaultPetChat}
            options={visibilityOptions}
            onChange={setDefaultPetChat}
          />
        </Field>
      </Card>

      <Card title={t.dmTitle}>
        <Toggle id="share-dms" checked={shareDms} onChange={setShareDms} label={t.dmLabel} help={t.dmHelp} />
      </Card>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className={s.saveBar}>
        <Button onClick={save} disabled={busy}>
          {busy ? ko.common.saving : ko.common.save}
        </Button>
      </div>
    </>
  );
}
