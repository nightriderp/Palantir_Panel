'use client';

import { type ServerJobBase, type ServerJobStatus } from '@palantir/contracts';
import { Badge, type Tone } from '@/components/shared';
import { formatBytes } from '../formatDetail';

/**
 * Fortschritt eines länger laufenden Vorgangs (Pflichtenheft §9).
 *
 * Genutzt für das Klonen mit Weltdaten und für den vollständigen Export. Die
 * Werte kommen über den Live-Kanal – der Balken bewegt sich also von selbst.
 */

const STATUS_META: Record<ServerJobStatus, { label: string; tone: Tone }> = {
  queued: { label: 'Wartet', tone: 'warning' },
  running: { label: 'Läuft', tone: 'warning' },
  completed: { label: 'Fertig', tone: 'success' },
  failed: { label: 'Fehlgeschlagen', tone: 'danger' },
  cancelled: { label: 'Abgebrochen', tone: 'neutral' },
};

export interface JobProgressProps {
  job: ServerJobBase;
  title: string;
  /** Kopierte und gesamte Bytes, wenn der Vorgang Daten bewegt. */
  bytes?: { copied: number | null; total: number | null };
}

export function JobProgress({ job, title, bytes }: JobProgressProps) {
  const status = STATUS_META[job.status];
  const percent = Math.min(100, Math.max(0, Math.round(job.progressPercent)));
  const active = job.status === 'queued' || job.status === 'running';

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-fill p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-semibold">{title}</span>
        <Badge tone={status.tone} withDot pulse={active}>
          {status.label}
        </Badge>
        <span className="ml-auto font-mono text-sm text-ink-muted">{percent} %</span>
      </div>

      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={title}
        className="h-1.5 overflow-hidden rounded-sm bg-fill-strong"
      >
        <div
          className={job.status === 'failed' ? 'h-full bg-danger' : 'h-full bg-brand-gradient'}
          style={{ width: `${percent}%` }}
        />
      </div>

      <p className="text-xs text-ink-faint">
        {job.status === 'failed' && job.statusMessage ? job.statusMessage : job.step}
        {bytes && bytes.total !== null
          ? ` · ${formatBytes(bytes.copied)} von ${formatBytes(bytes.total)}`
          : ''}
      </p>
    </div>
  );
}
