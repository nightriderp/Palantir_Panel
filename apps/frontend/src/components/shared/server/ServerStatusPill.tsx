import { type ServerStatus } from '@palantir/contracts';
import { Badge } from '../primitives/Badge';
import { serverStatusMeta } from './serverStatus';

export interface ServerStatusPillProps {
  status: ServerStatus;
  className?: string;
}

/**
 * Statusanzeige eines Servers als Pille mit Punkt.
 *
 * Deckt alle sieben Lifecycle-Zustände aus Pflichtenheft §9 ab und wird sowohl
 * auf der `ServerCard` als auch im Detailkopf (F3) verwendet.
 */
export function ServerStatusPill({ status, className }: ServerStatusPillProps) {
  const meta = serverStatusMeta(status);
  return (
    <Badge tone={meta.tone} withDot pulse={meta.pulse} className={className}>
      <span title={meta.description}>{meta.label}</span>
    </Badge>
  );
}
