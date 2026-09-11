/**
 * Bestandsserver auf den Router-Port umstellen (Fundpunkt 242).
 *
 * ```
 * pnpm --filter @palantir/backend ports:bestand              # nur zeigen
 * pnpm --filter @palantir/backend ports:bestand -- --anwenden
 * ```
 *
 * ## Warum es diesen Lauf gibt
 *
 * Seit der Umstellung auf Hostname-Routing (Fundpunkt 192) bekommt ein Server
 * eines gerouteten Spieltyps **keinen eigenen** oeffentlichen Port mehr: Seine
 * primaere Zuweisung traegt den geteilten Router-Port
 * (`MINECRAFT_ROUTER_PORT`), und aus dem Pool wird dafuer nichts vergeben
 * (`createPortAllocator` in `server-orchestration/ports.ts`).
 *
 * Server, die **vor** der Umstellung angelegt wurden, tragen dort weiterhin
 * eine eigene Nummer aus dem Pool. Sichtbar ist das im Panel nicht - die
 * Adresse eines gerouteten Servers zeigt ohnehin keinen Port
 * (`visiblePortOf()`). Zwei Dinge stimmen trotzdem nicht:
 *
 * 1. **Der Pool haelt Nummern fest, die niemand braucht.** Sie fehlen den
 *    Spielen ohne Routing.
 * 2. **Der Datensatz sagt etwas Falsches.** Ein neu angelegter Nachbarserver
 *    traegt 25565, der Bestandsserver 25007 - dieselbe Lage, zwei Antworten.
 *
 * ## Was der Lauf nicht anfasst
 *
 * **Nur die primaere Zuweisung.** Ein zweiter Port (Minecraft Bedrock ueber UDP
 * etwa) wird weiterhin auf den Host gebunden und behaelt seine Nummer samt
 * Pool-Eintrag.
 *
 * **Den Container nicht.** Er bindet den primaeren Port eines gerouteten Spiels
 * ohnehin nie: `buildContainerSpec()` filtert ihn an `primary` heraus, nicht an
 * der Nummer. Die Zuweisung zu aendern aendert allerdings den Fingerabdruck des
 * Spec - der naechste Start baut den Container einmal neu
 * (`ensureContainerCurrent`). Genau dafuer setzt der Lauf `restartRequired`,
 * damit der Hinweis im Panel steht und niemand raetselt.
 *
 * **Ein Rest bleibt:** Ein Container, der seit der Umstellung nie neu gestartet
 * wurde, kann seine alte Bindung noch halten. Wird die freigegebene Nummer in
 * der Zwischenzeit an einen Server ohne Routing vergeben und der startet zuerst,
 * scheitert er mit „port is already allocated". Deshalb der Neustart-Hinweis -
 * und deshalb zeigt der Lauf ohne `--anwenden` zuerst nur, was er taete.
 *
 * Die Auswahl steckt in {@link planeUmstellung} und ist dort getestet: Welche
 * Server der Lauf anfasst, entscheidet sich nicht erst an der Datenbank.
 */

import { and, eq } from 'drizzle-orm';
import { env } from '../config/env.js';
import { closeDb, getDb } from './client.js';
import { gameServers, portAllocations } from './schema.js';
import { ALLE_GAME_TYPE_DEFINITIONS } from '../modules/server-orchestration/game-registry.js';
import type { ServerPortAssignment } from '../modules/server-orchestration/types.js';

/** Was der Lauf ueber einen Server wissen muss. */
export interface UmstellungsKandidat {
  readonly id: string;
  readonly name: string;
  readonly gameType: string;
  readonly assignedPorts: readonly ServerPortAssignment[];
  readonly dockerContainerId: string | null;
}

/** Ein Server, der umgestellt wird - samt allem, was dafuer gebraucht wird. */
export interface Umstellung {
  readonly id: string;
  readonly name: string;
  readonly gameType: string;
  /** Die Nummer, die aus dem Pool freigegeben wird. */
  readonly alterPort: number;
  readonly protokoll: ServerPortAssignment['protocol'];
  /** Die vollstaendige neue Liste - nur die primaere Zuweisung aendert sich. */
  readonly neueZuweisungen: readonly ServerPortAssignment[];
  /** Traegt der Server einen Container? Dann braucht er einen Neustart. */
  readonly hatContainer: boolean;
}

/**
 * Welche Server umgestellt werden - und wie.
 *
 * Bewusst als reine Funktion neben dem Lauf: Die Auswahl ist der Teil, der
 * gegen eine echte Datenbank still das Falsche tun koennte.
 */
export function planeUmstellung(
  server: readonly UmstellungsKandidat[],
  geroutet: ReadonlySet<string>,
  routerPort: number,
): Umstellung[] {
  const plan: Umstellung[] = [];

  for (const eintrag of server) {
    if (!geroutet.has(eintrag.gameType)) {
      continue;
    }

    const primaer = eintrag.assignedPorts.find((zuweisung) => zuweisung.primary);

    // Kein primaerer Port oder schon auf dem Router-Port: nichts zu tun. Der
    // Lauf ist damit wiederholbar.
    if (primaer === undefined || primaer.publicPort === routerPort) {
      continue;
    }

    plan.push({
      id: eintrag.id,
      name: eintrag.name,
      gameType: eintrag.gameType,
      alterPort: primaer.publicPort,
      protokoll: primaer.protocol,
      neueZuweisungen: eintrag.assignedPorts.map((zuweisung) =>
        zuweisung.primary ? { ...zuweisung, publicPort: routerPort } : zuweisung,
      ),
      hatContainer: eintrag.dockerContainerId !== null,
    });
  }

  return plan;
}

/** Spieltypen, deren primaerer Port ueber den Router laeuft. */
export function gerouteteSpieltypen(): ReadonlySet<string> {
  return new Set(
    ALLE_GAME_TYPE_DEFINITIONS.filter((definition) => definition.supportsVirtualHostRouting).map(
      (definition) => definition.id,
    ),
  );
}

async function lauf(): Promise<void> {
  const anwenden = process.argv.includes('--anwenden');
  const geroutet = gerouteteSpieltypen();
  const routerPort = env.MINECRAFT_ROUTER_PORT;
  const db = getDb();

  const server = await db
    .select({
      id: gameServers.id,
      name: gameServers.name,
      gameType: gameServers.gameType,
      assignedPorts: gameServers.assignedPorts,
      dockerContainerId: gameServers.dockerContainerId,
    })
    .from(gameServers);

  const plan = planeUmstellung(server, geroutet, routerPort);

  console.log(`Router-Port: ${routerPort}`);
  console.log(`Geroutete Spieltypen: ${[...geroutet].join(', ')}`);
  console.log(`Server insgesamt: ${server.length}, davon umzustellen: ${plan.length}`);

  if (plan.length === 0) {
    console.log('Nichts zu tun.');

    return;
  }

  console.log('');

  for (const umstellung of plan) {
    console.log(
      `  ${umstellung.name.padEnd(22)} ${String(umstellung.alterPort).padStart(5)} -> ${routerPort}` +
        `  (${umstellung.gameType}${umstellung.hatContainer ? ', Container vorhanden' : ''})`,
    );

    if (!anwenden) {
      continue;
    }

    // Nur die eine Zeile des primaeren Ports - ein zweiter Port desselben
    // Servers bleibt vergeben.
    const freigegeben = await db
      .delete(portAllocations)
      .where(
        and(
          eq(portAllocations.serverId, umstellung.id),
          eq(portAllocations.port, umstellung.alterPort),
          eq(portAllocations.protocol, umstellung.protokoll),
        ),
      )
      .returning({ port: portAllocations.port });

    await db
      .update(gameServers)
      .set({
        assignedPorts: [...umstellung.neueZuweisungen],
        ...(umstellung.hatContainer ? { restartRequired: true } : {}),
      })
      .where(eq(gameServers.id, umstellung.id));

    console.log(
      `      Pool: ${freigegeben.length === 0 ? 'kein Eintrag gefunden' : `${String(freigegeben.length)} Nummer freigegeben`}`,
    );
  }

  console.log('');

  if (anwenden) {
    console.log('Umgestellt. Die betroffenen Server einmal neu starten, damit der');
    console.log('Container ohne die alte Port-Bindung neu gebaut wird.');
  } else {
    console.log('Nur gezeigt - nichts geaendert. Mit `-- --anwenden` ausfuehren.');
  }
}

/**
 * Nur ausfuehren, wenn die Datei als Kommando gestartet wurde - nicht, wenn der
 * Test sie importiert.
 */
if (process.argv[1]?.includes('ports-bestandsserver')) {
  try {
    await lauf();
  } finally {
    await closeDb();
  }
}
