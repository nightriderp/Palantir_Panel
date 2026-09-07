import { type HostNodeDto } from '@palantir/contracts';
import { type ApiResult, apiRequest } from './client';

/**
 * REST-Endpunkte rund um Nodes (Lastenheft §3.7).
 *
 * **Warum `/admin/nodes` in einer Nutzeransicht?** Der Pfad ist bewusst **nicht**
 * auf Administratoren beschränkt: davor hängt
 * `requireAnyPermission('node.view', 'node.manage')` – `node.view` ist genau das
 * Recht, an dem laut STRUKTUR.md die Sichtbarkeit von F7 hängt.
 *
 * Das Backend bedient inzwischen **beide** Pfade: `/admin/nodes` und die
 * Nutzersicht `/nodes/available`, die F3 aufruft (`servers.ts`). Beide liefern
 * dieselbe Liste aus derselben Quelle mit demselben Guard
 * (`modules/admin/routes.ts`) – die frühere Notiz „ein Pfad, den bisher niemand
 * bedient" ist überholt (Audit W3-2, frontend-lib-17). Dass sich F3 und F7 auf
 * einen der beiden einigen sollten, bleibt offen; F7 nimmt bis dahin den hier
 * eingetragenen.
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
