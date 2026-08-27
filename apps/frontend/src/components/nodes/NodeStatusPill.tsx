import { type HostNodeStatus } from '@palantir/contracts';
import { Badge } from '@/components/shared';
import { nodeStatusMeta } from './nodeStatus';

export interface NodeStatusPillProps {
  status: HostNodeStatus;
  className?: string;
}

/**
 * Zustandsanzeige einer Node als Pille mit Punkt.
 *
 * Nutzt dieselbe `Badge` wie `ServerStatusPill` aus F2, damit Server- und
 * Node-Zustände im Panel gleich aussehen. Text und Farbe kommen aus
 * {@link nodeStatusMeta} – die eine Stelle, an der ein `HostNodeStatus`
 * übersetzt wird.
 */
export function NodeStatusPill({ status, className }: NodeStatusPillProps) {
  const meta = nodeStatusMeta(status);
  return (
    <Badge tone={meta.tone} withDot pulse={meta.pulse} className={className}>
      <span title={meta.description}>{meta.label}</span>
    </Badge>
  );
}
