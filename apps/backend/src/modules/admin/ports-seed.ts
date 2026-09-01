/**
 * Öffentlicher Port-Bereich der Ersteinrichtung (WORK_STATUS.md, Gefundener
 * Punkt 58; Pflichtenheft §2.4).
 *
 * **Warum überhaupt.** Ohne Port-Bereich scheitert das Anlegen des ersten
 * Servers mit `PORT_POOL_EXHAUSTED` – auf einer frisch aufgesetzten Instanz
 * also jedes Anlegen, bis ein Admin den Bereich von Hand einträgt. Die Grenzen
 * stehen ohnehin schon in der zentralen `.env` (`GAME_PORT_RANGE_START` /
 * `_END`), weil frps und frpc sie brauchen; hier landen dieselben Zahlen in der
 * Datenbank, statt sie ein zweites Mal von Hand einzugeben.
 *
 * **Zwei Einträge, TCP und UDP.** Die Vergabe sucht je Protokoll (siehe
 * `ports.ts` in B3): Ein Spiel mit UDP-Port fände in einem reinen TCP-Bereich
 * keinen Platz.
 *
 * **Ohne Node-Bindung.** Der Bereich gilt für die VPS, nicht für eine bestimmte
 * Node – die Ports sind dort öffentlich, unabhängig davon, welcher Homeserver
 * dahinter hängt.
 *
 * **Idempotent.** Gibt es schon irgendeinen Bereich, bleibt alles, wie es ist:
 * Wer die Vergabe umgebaut oder eingeschränkt hat, soll nicht bei jedem
 * `db:seed` einen zusätzlichen Bereich dazubekommen.
 */

import { type PortProtocol } from '@palantir/contracts';
import { type Database } from '../../db/client.js';
import { portRanges } from '../../db/schema/admin.js';

/** Die zwei Zugriffe, die das Seeding braucht – ohne Datenbank prüfbar. */
export interface PortRangeSeedStore {
  hasAnyRange(): Promise<boolean>;
  createRange(data: {
    label: string;
    startPort: number;
    endPort: number;
    protocol: PortProtocol;
  }): Promise<void>;
}

export interface SeedPortRangesResult {
  /** Angelegte Protokolle; leer, wenn schon ein Bereich bestand. */
  readonly created: PortProtocol[];
  /** `true`, wenn bereits ein Bereich vorhanden war. */
  readonly existing: boolean;
}

export function drizzlePortRangeSeedStore(db: Database): PortRangeSeedStore {
  return {
    async hasAnyRange() {
      const vorhanden = await db.select({ id: portRanges.id }).from(portRanges).limit(1);

      return vorhanden.length > 0;
    },

    async createRange(data) {
      await db.insert(portRanges).values({ ...data, nodeId: null, enabled: true });
    },
  };
}

export async function seedDefaultPortRanges(
  store: PortRangeSeedStore,
  bereich: { readonly startPort: number; readonly endPort: number },
): Promise<SeedPortRangesResult> {
  if (bereich.endPort < bereich.startPort) {
    throw new Error(
      `Ungültiger Port-Bereich: ${String(bereich.startPort)}-${String(bereich.endPort)}.`,
    );
  }

  if (await store.hasAnyRange()) {
    return { created: [], existing: true };
  }

  const created: PortProtocol[] = [];

  for (const protocol of ['tcp', 'udp'] as const) {
    await store.createRange({
      label: `Spiele-Ports (${protocol.toUpperCase()})`,
      startPort: bereich.startPort,
      endPort: bereich.endPort,
      protocol,
    });
    created.push(protocol);
  }

  return { created, existing: false };
}
