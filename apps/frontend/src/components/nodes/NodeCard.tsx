import { type HostNodeDto } from '@palantir/contracts';
import { Icon, Panel, TONE_DOT_CLASSES, cn, formatDate, formatNumber } from '@/components/shared';
import { NodeStatusPill } from './NodeStatusPill';
import { type NodeMetric, nodeMetrics, nodeStatusMeta } from './nodeStatus';

export interface NodeCardProps {
  node: HostNodeDto;
  className?: string;
}

/**
 * Ein Balken je Ressource (Rechenleistung, Arbeitsspeicher, Speicherplatz).
 *
 * Zeigt „belegt / gesamt" darüber und den freien Rest darunter – die für den
 * Nutzer entscheidende Zahl steht damit im Klartext, der Balken bebildert sie
 * nur. Die Breite kommt als Inline-Wert (0–100 %), weil ein dynamischer Anteil
 * sich nicht als Utility-Klasse ausdrücken lässt; Farbe und Radius bleiben
 * Tokens.
 */
function MeterBar({ metric }: { metric: NodeMetric }) {
  const width = metric.percent ?? 0;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs text-ink-soft">
        <span>{metric.label}</span>
        <span className="font-mono text-ink-muted">
          {metric.usedLabel} / {metric.totalLabel}
        </span>
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-sm bg-fill-strong"
        role="progressbar"
        aria-label={metric.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={metric.percent ?? undefined}
      >
        <div
          className={cn('h-full rounded-sm', TONE_DOT_CLASSES[metric.tone])}
          style={{ width: `${width}%` }}
        />
      </div>
      <div className="mt-1 text-2xs text-ink-faint">
        {metric.percent === null ? 'Keine Angabe' : `${metric.freeLabel} frei`}
      </div>
    </div>
  );
}

/**
 * Node-Karte der Nutzeransicht (Lastenheft §3.7, Mockup „Nodes").
 *
 * Rein darstellend. Zeigt bewusst **keine** sicherheitsrelevanten Interna: die
 * WireGuard-Adresse aus dem DTO bleibt außen vor (Vorgabe F7). Verwalten,
 * Pausieren und Löschen gehören zur Node-Verwaltung (F10) und tauchen hier
 * nicht auf, unabhängig von den Rechten des Betrachters.
 */
export function NodeCard({ node, className }: NodeCardProps) {
  const meta = nodeStatusMeta(node.status);
  const metrics = nodeMetrics(node);

  return (
    <Panel variant="raised" className={cn('flex flex-col gap-4', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className={cn(
              'mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full',
              TONE_DOT_CLASSES[meta.tone],
              meta.pulse && 'animate-pulse-dot',
            )}
          />
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold">{node.name}</div>
            <div className="text-xs text-ink-faint">
              {formatNumber(node.serverCount)} Server · eingerichtet {formatDate(node.createdAt)}
            </div>
          </div>
        </div>
        <NodeStatusPill status={node.status} />
      </div>

      {node.status === 'online' ? null : (
        <p className="text-sm text-ink-muted">{meta.description}</p>
      )}

      {node.statusMessage ? (
        <div className="flex items-start gap-2 rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink-muted">
          <Icon name="warning" size={14} className="mt-0.5 shrink-0 text-warning" />
          <span>{node.statusMessage}</span>
        </div>
      ) : null}

      <div className="flex flex-col gap-3.5">
        {metrics.map((metric) => (
          <MeterBar key={metric.key} metric={metric} />
        ))}
      </div>
    </Panel>
  );
}
