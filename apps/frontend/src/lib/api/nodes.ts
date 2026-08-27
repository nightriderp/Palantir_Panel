import { type HostNodeDto } from '@palantir/contracts';
import { type ApiResult, apiRequest } from './client';

/**
 * REST-Endpunkte rund um Nodes (Lastenheft §3.7).
 *
 * **Warum `/admin/nodes` in einer Nutzeransicht?** Der Pfad ist die einzige
 * Route, die das Backend für die Node-Liste tatsächlich anbietet (B8,
 * `modules/admin/routes.ts`). Sie ist bewusst **nicht** auf Administratoren
 * beschränkt: davor hängt `requireAnyPermission('node.view', 'node.manage')` –
 * `node.view` ist genau das Recht, an dem laut STRUKTUR.md die Sichtbarkeit von
 * F7 hängt. Eine zweite Route mit gleichem Inhalt anzulegen wäre die Sorte
 * Parallelstruktur, die CLAUDE.md §3 ausschließt.
 *
 * F3 ruft dieselbe Liste unter `/nodes/available` auf (`servers.ts`) – ein Pfad,
 * den bisher niemand bedient. Dass beide Seiten sich einigen müssen, ist unter
 * „Gefundene Punkte" in WORK_STATUS.md vermerkt; bis dahin nimmt F7 den Pfad,
 * der existiert.
 *
 * Ergebnis ist immer der Response-Envelope aus Pflichtenheft §5.1 – hier wird
 * nichts ausgepackt und nichts geworfen.
 */

const NODES = '/admin/nodes';

/**
 * Alle Nodes, die der aufrufende Nutzer sehen darf.
 *
 * Was er damit tun darf, steht je Eintrag im `permissions`-Objekt des DTO
 * (Pflichtenheft §5.2). Die Nutzeransicht wertet davon nur `canView` aus;
 * `canManage` gehört zur Node-Verwaltung in F10.
 */
export function fetchNodes(signal?: AbortSignal): Promise<ApiResult<HostNodeDto[]>> {
  return apiRequest<HostNodeDto[]>(NODES, { signal });
}
