import { Card, buttonClass } from '@/components/ui';
import { ko } from '@/i18n/ko';

export function ExportTab() {
  return (
    <Card title={ko.me.export.title}>
      <p>{ko.me.export.body}</p>
      <a href="/api/v1/me/export" className={buttonClass('primary')} download>
        {ko.me.export.download}
      </a>
    </Card>
  );
}
