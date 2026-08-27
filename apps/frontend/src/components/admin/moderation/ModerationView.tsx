'use client';

import {
  MESSAGE_REPORT_STATUSES,
  type MessageModerationAction,
  type MessageReportDto,
  type MessageReportPageDto,
  type MessageReportStatus,
} from '@palantir/contracts';
import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  DangerConfirmDialog,
  PageHeader,
  Panel,
  SegmentedControl,
  formatDateTime,
  formatNumber,
  useToast,
} from '@/components/shared';
import { useSession } from '@/app/(dashboard)/SessionProvider';
import { fetchMessageReports, resolveMessageReport } from '@/lib/api/admin';
import { errorText } from '@/lib/api/client';
import { useApiResource } from '@/lib/api/useApiResource';
import { AdminAccessNotice, AdminError, AdminLoading } from '../common';
import {
  conversationTypeLabel,
  moderationActionLabel,
  reportStatusLabel,
  reportStatusTone,
} from '../labels';

/**
 * Moderation gemeldeter Nachrichten (Pflichtenheft §15).
 *
 * Zeigt **ausschließlich** gemeldete Nachrichten. Es gibt hier bewusst keinen
 * Pfad zu Konversationen, Verläufen oder einer Suche über Nachrichten – Admins
 * können darüber nicht allgemein in private Chats sehen. Die Entscheidungen sind
 * „verwerfen" oder „Nachricht löschen"; eine Kontosperre ist keine
 * Chat-Moderation (siehe Nutzerverwaltung).
 */

const PAGE_SIZE = 50;

type ResolveDialog =
  | { report: MessageReportDto; action: MessageModerationAction }
  | null;

export function ModerationView() {
  const { user } = useSession();
  const toast = useToast();
  const canModerate = user?.permissions.canModerateMessages ?? false;

  const [status, setStatus] = useState<MessageReportStatus>('open');
  const [offset, setOffset] = useState(0);
  const [dialog, setDialog] = useState<ResolveDialog>(null);
  const [busy, setBusy] = useState(false);

  const query = useMemo(() => ({ status, limit: PAGE_SIZE, offset }), [status, offset]);
  const resource = useApiResource<MessageReportPageDto>(
    (signal) => fetchMessageReports(query, signal),
    canModerate ? [query] : null,
  );

  async function resolve(report: MessageReportDto, action: MessageModerationAction) {
    setBusy(true);
    const result = await resolveMessageReport(report.id, { action });
    setBusy(false);
    if (result.success) {
      toast.success(
        action === 'deleteMessage' ? 'Nachricht gelöscht.' : 'Meldung verworfen.',
      );
      setDialog(null);
      resource.reload();
    } else {
      toast.error(errorText(result));
    }
  }

  if (!canModerate) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Moderation" className="-mx-5 -mt-5 px-5" />
        <AdminAccessNotice area="die Moderation gemeldeter Nachrichten" />
      </div>
    );
  }

  const page = resource.data;
  const reports = page?.reports ?? [];
  const total = page?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Moderation"
        subtitle="Ausschließlich gemeldete Nachrichten – verwerfen oder löschen"
        className="-mx-5 -mt-5 px-5"
      />

      <SegmentedControl
        label="Nach Zustand filtern"
        value={status}
        onChange={(value) => {
          setStatus(value);
          setOffset(0);
        }}
        items={MESSAGE_REPORT_STATUSES.map((key) => ({ key, label: reportStatusLabel(key) }))}
      />

      {resource.loading ? (
        <AdminLoading label="Meldungen werden geladen …" />
      ) : resource.error ? (
        <AdminError message={resource.error} onRetry={resource.reload} />
      ) : reports.length === 0 ? (
        <Panel className="text-center text-base text-ink-faint">
          {status === 'open' ? 'Keine offenen Meldungen.' : 'Keine Meldungen in diesem Zustand.'}
        </Panel>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {reports.map((report) => (
              <li key={report.id}>
                <Panel className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-base font-semibold text-ink">
                        {report.message.senderDisplayName}
                      </span>
                      <span className="text-2xs uppercase tracking-[0.06em] text-ink-faint">
                        {conversationTypeLabel(report.conversationType)} ·{' '}
                        {formatDateTime(report.message.createdAt)}
                      </span>
                    </div>
                    <Badge tone={reportStatusTone(report.status)} withDot>
                      {reportStatusLabel(report.status)}
                    </Badge>
                  </div>

                  <blockquote className="rounded-md border border-line bg-surface-deep px-3 py-2.5 text-base text-ink">
                    {report.message.deletedAt ? (
                      <span className="italic text-ink-faint">
                        Diese Nachricht wurde bereits gelöscht.
                      </span>
                    ) : (
                      <span className="whitespace-pre-wrap break-words">
                        {report.message.content}
                      </span>
                    )}
                  </blockquote>

                  <div className="flex flex-col gap-1 text-sm text-ink-muted">
                    <span>
                      Gemeldet von{' '}
                      <span className="text-ink">{report.reportedByDisplayName}</span> ·{' '}
                      {formatDateTime(report.createdAt)}
                    </span>
                    <span>
                      Grund: <span className="text-ink">{report.reason}</span>
                    </span>
                    {report.status !== 'open' ? (
                      <span className="text-ink-faint">
                        {report.actionTaken ? moderationActionLabel(report.actionTaken) : '—'}
                        {report.resolvedByDisplayName ? ` durch ${report.resolvedByDisplayName}` : ''}
                        {report.resolvedAt ? ` · ${formatDateTime(report.resolvedAt)}` : ''}
                      </span>
                    ) : null}
                  </div>

                  {report.permissions.canResolve ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        iconLeft="check"
                        onClick={() => void resolve(report, 'dismiss')}
                      >
                        Verwerfen
                      </Button>
                      {!report.message.deletedAt ? (
                        <Button
                          variant="danger"
                          iconLeft="trash"
                          onClick={() => setDialog({ report, action: 'deleteMessage' })}
                        >
                          Nachricht löschen
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </Panel>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between">
            <Button
              variant="secondary"
              iconLeft="arrowLeft"
              disabled={!hasPrev}
              onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
            >
              Zurück
            </Button>
            <span className="text-sm text-ink-faint">
              {formatNumber(offset + 1)}–{formatNumber(Math.min(offset + PAGE_SIZE, total))} von{' '}
              {formatNumber(total)}
            </span>
            <Button
              variant="secondary"
              disabled={!hasNext}
              onClick={() => setOffset((current) => current + PAGE_SIZE)}
            >
              Weiter
            </Button>
          </div>
        </>
      )}

      {dialog ? (
        <DangerConfirmDialog
          open
          onClose={() => setDialog(null)}
          title="Nachricht löschen?"
          confirmLabel="Nachricht löschen"
          busy={busy}
          onConfirm={() => void resolve(dialog.report, dialog.action)}
          message="Die gemeldete Nachricht wird aus dem Chat entfernt. Die Meldung gilt danach als bearbeitet."
        />
      ) : null}
    </div>
  );
}
