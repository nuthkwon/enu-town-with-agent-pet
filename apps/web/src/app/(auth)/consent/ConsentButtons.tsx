'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui';
import { ko } from '@/i18n/ko';

export function ConsentButtons() {
  const { pending, data } = useFormStatus();
  const choice = data?.get('decision');
  return (
    <>
      <Button type="submit" name="decision" value="deny" variant="ghost" size="lg" disabled={pending}>
        {pending && choice === 'deny' ? ko.consent.working : ko.consent.deny}
      </Button>
      <Button type="submit" name="decision" value="allow" variant="primary" size="lg" disabled={pending}>
        {pending && choice === 'allow' ? ko.consent.working : ko.consent.allow}
      </Button>
    </>
  );
}

export function SwitchAccountButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" size="sm" disabled={pending}>
      {ko.consent.otherAccount}
    </Button>
  );
}
