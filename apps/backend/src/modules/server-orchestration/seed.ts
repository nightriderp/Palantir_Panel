/**
 * Ersteinrichtung der Server-Orchestrierung (Pflichtenheft §12.3).
 *
 * Legt die Node an, auf der die Gameserver laufen. Ohne sie lässt sich kein
 * Server anlegen und keine Agent-Verbindung zuordnen – deshalb gehört sie in
 * die Ersteinrichtung, direkt nach `db:migrate`, zusammen mit den Seed-Rollen
 * aus B2.
 *
 * Die Tabelle `host_nodes` selbst gehört B4 (`schema/resources.ts`), weil die
 * Kapazitätsprüfung aus Pflichtenheft §10 mit ihren Ressourcenspalten rechnet.
 * B3 legt hier nur den ersten Datensatz an.
 *
 * Der Lauf ist idempotent: Ist bereits eine Node eingetragen, bleibt sie
 * unverändert. Phase 1 betreibt genau einen Homeserver (Pflichtenheft §1, §2.1);
 * weitere Nodes trägt später die Admin-Oberfläche ein (B8).
 */

import { type Database } from '../../db/client.js';
import { hostNodes } from '../../db/schema.js';

/**
 * Vorbelegung der nutzbaren Gesamt-Ressourcen (Lastenheft §5).
 *
 * „32 GB DDR4-RAM, 2,5 TB SSD gesamt (500 GB für Proxmox/Systeme reserviert,
 * 2 TB für die Gameserver-VM nutzbar)", Ryzen 7 5800X mit 8 Kernen. Bewusst die
 * für die VM **nutzbaren** Werte, nicht die des Blechs – die
 * Kapazitätsprüfung aus B4 rechnet damit.
 *
 * Es sind Startwerte für genau diese Installation, keine Messung. Eine andere
 * Node hat andere Werte; korrigiert werden sie über die Node-Verwaltung (B8).
 * Deshalb stehen sie hier und nicht in `.env.example`: sie gehören an den
 * Datensatz der Node, nicht in eine Datei, die auf beiden Maschinen liegt.
 */
export const DEFAULT_HOST_NODE_RESOURCES = {
  totalRamMb: 28 * 1_024,
  totalCpuCores: 8,
  totalDiskMb: 2_000 * 1_024,
} as const;

export interface SeedHostNodeResult {
  readonly id: string;
  readonly created: boolean;
}

export async function seedDefaultHostNode(
  db: Database,
  input: { readonly name?: string; readonly wireguardIp: string },
): Promise<SeedHostNodeResult> {
  const existing = await db.select({ id: hostNodes.id }).from(hostNodes).limit(1);
  const found = existing[0];

  if (found !== undefined) {
    return { id: found.id, created: false };
  }

  const inserted = await db
    .insert(hostNodes)
    .values({
      name: input.name ?? 'Homeserver',
      wireguardIp: input.wireguardIp,
      status: 'offline',
      ...DEFAULT_HOST_NODE_RESOURCES,
    })
    .returning({ id: hostNodes.id });

  const id = inserted[0]?.id;

  if (id === undefined) {
    throw new Error('Die Node konnte nicht angelegt werden.');
  }

  return { id, created: true };
}
