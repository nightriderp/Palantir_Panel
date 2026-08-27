'use client';

import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
  type AuditAction,
  type AuditLogPageDto,
  type AuditTargetType,
} from '@palantir/contracts';
import { useMemo, useState } from 'react';
import {
  Button,
  PageHeader,
  Panel,
  SelectField,
  formatDateTime,
  formatNumber,
} from '@/components/shared';
import { useSession } from '@/app/(dashboard)/SessionProvider';
import { fetchAuditLog } from '@/lib/api/admin';
import { useApiResource } from '@/lib/api/useApiResource';
import {
  AdminAccessNotice,
  AdminError,
  AdminLoading,
  AdminTable,
  DateField,
  Td,
  Th,
} from '../common';
import { auditActionLabel, auditTargetTypeLabel } from '../labels';

/**
 * Audit-Log (Lastenheft §3.7, Pflichtenheft §6) – **rein lesend**.
 *
 * Es gibt hier bewusst keine Bearbeiten- oder Löschen-Aktion, auch keine
 * ausgegraute: Das Log ist append-only, und schon der Contract kennt für einen
 * Eintrag nur `canView` (Pflichtenheft §6). Filter schränken die Sicht ein,
 * verändern aber nichts.
 */

const PAGE_SIZE = 50;

/** Beginn eines Tages als ISO-Zeitstempel (Filter „ab"). */
function startOfDayIso(date: string): string {
  return `${date}T00:00:00.000Z`;
}

/** Ende eines Tages als ISO-Zeitstempel (Filter „bis", einschließlich). */
function endOfDayIso(date: string): string {
  return `${date}T23:59:59.999Z`;
}

/** Metadaten kompakt als eine Zeile – rohe Angabe, ohne Interpretation. */
function summarizeMetadata(metadata: Record<string, unknown>): string {
  const keys = Object.keys(metadata);
  if (keys.length === 0) return '—';
  return keys.map((key) => `${key}: ${formatMetaValue(metadata[key])}`).join(' · ');
}

function formatMetaValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

export function AuditLogView() {
  const { user } = useSession();
  const canView = user?.permissions.canViewAuditLog ?? false;

  const [action, setAction] = useState<AuditAction | ''>('');
  const [targetType, setTargetType] = useState<AuditTargetType | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);

  const query = useMemo(
    () => ({
      ...(action ? { action } : {}),
      ...(targetType ? { targetType } : {}),
      ...(from ? { from: startOfDayIso(from) } : {}),
      ...(to ? { to: endOfDayIso(to) } : {}),
      limit: PAGE_SIZE,
      offset,
    }),
    [action, targetType, from, to, offset],
  );

  const resource = useApiResource<AuditLogPageDto>(
    (signal) => fetchAuditLog(query, signal),
    canView ? [query] : null,
  );

  /** Filter ändern setzt die Blätter-Position zurück. */
  function withFirstPage(update: () => void) {
    update();
    setOffset(0);
  }

  function resetFilters() {
    setAction('');
    setTargetType('');
    setFrom('');
    setTo('');
    setOffset(0);
  }

  if (!canView) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Audit-Log" className="-mx-5 -mt-5 px-5" />
        <AdminAccessNotice area="das Audit-Log" />
      </div>
    );
  }

  const page = resource.data;
  const entries = page?.entries ?? [];
  const total = page?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Audit-Log"
        subtitle="Alle sicherheitsrelevanten Aktionen – unveränderlich und nur einsehbar"
        className="-mx-5 -mt-5 px-5"
      />

      <Panel className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SelectField
            label="Aktion"
            value={action}
            onChange={(value) => withFirstPage(() => setAction(value as AuditAction | ''))}
            placeholder="Alle Aktionen"
            options={AUDIT_ACTIONS.map((value) => ({ value, label: auditActionLabel(value) }))}
          />
          <SelectField
            label="Betroffenes Objekt"
            value={targetType}
            onChange={(value) => withFirstPage(() => setTargetType(value as AuditTargetType | ''))}
            placeholder="Alle Objekte"
            options={AUDIT_TARGET_TYPES.map((value) => ({
              value,
              label: auditTargetTypeLabel(value),
            }))}
          />
          <DateField
            label="Ab"
            value={from}
            max={to || undefined}
            onChange={(value) => withFirstPage(() => setFrom(value))}
          />
          <DateField
            label="Bis"
            value={to}
            onChange={(value) => withFirstPage(() => setTo(value))}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink-faint">
            {formatNumber(total)} {total === 1 ? 'Eintrag' : 'Einträge'}
          </span>
          <Button variant="ghost" onClick={resetFilters}>
            Filter zurücksetzen
          </Button>
        </div>
      </Panel>

      {resource.loading ? (
        <AdminLoading label="Audit-Log wird geladen …" />
      ) : resource.error ? (
        <AdminError message={resource.error} onRetry={resource.reload} />
      ) : entries.length === 0 ? (
        <Panel className="text-center text-base text-ink-faint">
          Keine Einträge für die gewählten Filter.
        </Panel>
      ) : (
        <>
          <AdminTable>
            <thead>
              <tr>
                <Th className="whitespace-nowrap">Zeitpunkt</Th>
                <Th>Aktion</Th>
                <Th>Handelnder</Th>
                <Th>Objekt</Th>
                <Th>Herkunft</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <Td className="whitespace-nowrap font-mono text-sm text-ink-faint">
                    {formatDateTime(entry.timestamp)}
                  </Td>
                  <Td className="text-ink">{auditActionLabel(entry.action)}</Td>
                  <Td>{entry.actorDisplayName ?? 'System'}</Td>
                  <Td>
                    {entry.targetType ? (
                      <span>
                        {auditTargetTypeLabel(entry.targetType)}
                        {entry.targetId ? (
                          <span className="ml-1 font-mono text-2xs text-ink-faint">
                            {entry.targetId.slice(0, 8)}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td className="whitespace-nowrap font-mono text-sm text-ink-faint">
                    {entry.ipHint ?? '—'}
                  </Td>
                  <Td
                    className="max-w-[280px] truncate text-sm text-ink-faint"
                    title={summarizeMetadata(entry.metadata)}
                  >
                    {summarizeMetadata(entry.metadata)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </AdminTable>

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
    </div>
  );
}
