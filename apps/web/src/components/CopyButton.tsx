'use client';

import { useState } from 'react';
import { ko } from '@/i18n/ko';
import { Button } from './ui';

export function CopyButton({ text, label = ko.common.copy }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? ko.common.copied : label}
    </Button>
  );
}
