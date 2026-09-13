import type { AgentRconAccess, CreateBackupCommandPayload, QuiesceSpec } from '@palantir/contracts';
import type { OffenerSchreibstopp, QuiesceMarker } from '../jobs/backup/quiesce-marker.js';
import type { ConnectionLogger } from './agent-connection.js';

/**
 * Schreibstopp für die Dauer einer Sicherung (Arbeitspaket HM-10).
 *
 * Bis hierher hatte eine Sicherung zwei Zustände und keinen dritten: Entweder
 * sie packt den Datenordner im laufenden Betrieb – dann ist der Spielstand in
 * sich widersprüchlich, bei Minecraft nachweislich falsche Spielerposition und
 * halb geschriebene Chunks – oder der Container wird angehalten, und das merkt
 * jeder Spieler.
 *
 * Der dritte Weg ist der, den Serverbetreiber von Hand nehmen: dem Spiel sagen,
 * dass es kurz nicht schreiben soll (`save-off`, `save-all`), packen, und es ihm
 * danach wieder erlauben (`save-on`). Die Spieler bleiben dabei drauf.
 *
 * **Eigenes Modul und nicht im Adapter**, obwohl der Adapter es aufruft: Was
 * hier steht, hängt an nichts aus der Container-Runtime und an keinem
 * Wire-Format. Es braucht eine Konsole, einen Merkzettel und zwei Listen – und
 * ist damit ohne Payload-Prüfung und ohne Engine prüfbar. Genau das ist
 * notwendig, denn die interessanten Fälle sind die, in denen etwas schiefgeht.
 */

/** Schickt **eine** Zeile an die Konsole; `false`, wenn sie nicht ankam. */
export type Konsolenzeile = (
  containerId: string,
  serverId: string,
  zeile: string,
  rcon: AgentRconAccess | undefined,
  zweck: string,
) => Promise<boolean>;

export interface SchreibstoppUmgebung {
  readonly konsole: Konsolenzeile;
  /**
   * Merkzettel offener Schreibstopps.
   *
   * Ohne ihn wird trotzdem still gestellt und wieder aufgehoben – es fehlt nur
   * das zweite Netz für den Fall, dass der Agent mitten im Fenster stirbt.
   */
  readonly marker?: QuiesceMarker;
  readonly log: ConnectionLogger;
}

/**
 * Führt `packen` aus und stellt den Server für die Dauer still.
 *
 * Ohne `quiesce` in der Nutzlast oder ohne Container läuft genau der Aufruf wie
 * vorher – es gibt dann nichts still zu stellen.
 *
 * Gelingt das Ruhigstellen nicht, wird trotzdem gepackt: Eine Sicherung im
 * laufenden Betrieb ist der bisherige Normalfall und besser als keine.
 */
export async function mitSchreibstopp<T>(
  payload: CreateBackupCommandPayload,
  umgebung: SchreibstoppUmgebung,
  packen: () => Promise<T>,
): Promise<T> {
  const quiesce = payload.quiesce;

  if (quiesce === undefined || payload.containerId === undefined) {
    return packen();
  }

  const containerId = payload.containerId;
  const stillGestellt = await setzen(payload.serverId, containerId, quiesce, umgebung);

  try {
    return await packen();
  } finally {
    if (stillGestellt) {
      await aufheben(
        {
          serverId: payload.serverId,
          containerId,
          resumeCommands: [...quiesce.resumeCommands],
          ...(quiesce.rcon === undefined ? {} : { rcon: quiesce.rcon }),
          seit: new Date().toISOString(),
        },
        umgebung,
      );
    }
  }
}

/**
 * Schickt die Ruhigstell-Befehle und hinterlässt einen Merkzettel.
 *
 * **Der Merkzettel kommt zuerst.** Zwischen „Befehl ist raus" und „Merkzettel
 * liegt da" gäbe es sonst ein Fenster, in dem der Server nicht mehr schreibt und
 * niemand davon weiß – stirbt der Agent genau dort, bleibt der Schreibstopp für
 * immer stehen.
 */
async function setzen(
  serverId: string,
  containerId: string,
  quiesce: QuiesceSpec,
  umgebung: SchreibstoppUmgebung,
): Promise<boolean> {
  try {
    await umgebung.marker?.merken({
      serverId,
      containerId,
      resumeCommands: [...quiesce.resumeCommands],
      ...(quiesce.rcon === undefined ? {} : { rcon: quiesce.rcon }),
      seit: new Date().toISOString(),
    });
  } catch (fehler) {
    // Ohne Merkzettel wird trotzdem still gestellt: Das `finally` oben deckt
    // jeden Ausgang ab, den dieser Prozess noch erlebt. Es fehlt nur das zweite
    // Netz für seinen eigenen Tod – und das ist kein Grund, auf eine brauchbare
    // Sicherung zu verzichten.
    umgebung.log.warn('Merkzettel für den Schreibstopp ließ sich nicht ablegen.', {
      serverId,
      fehler: fehler instanceof Error ? fehler.message : String(fehler),
    });
  }

  let ersterDurch = false;

  for (const zeile of quiesce.commands) {
    const erfolg = await umgebung.konsole(
      containerId,
      serverId,
      zeile,
      quiesce.rcon,
      'Ruhigstellen',
    );

    if (!erfolg) {
      /*
       * Abbrechen statt weitermachen: Die Reihenfolge zählt. Kam `save-off`
       * nicht durch, schriebe `save-all` in einen Server, der weiterschreibt –
       * das Archiv wäre so widersprüchlich wie ohne Schreibstopp, der Aufruf
       * sähe aber aus, als hätte er gewirkt.
       */
      break;
    }

    ersterDurch = true;
  }

  if (!ersterDurch) {
    await umgebung.marker?.vergessen(serverId);
  }

  return ersterDurch;
}

/**
 * Schickt die Gegenbefehle und räumt den Merkzettel weg.
 *
 * Anders als beim Ruhigstellen wird hier **nicht** abgebrochen: Jeder
 * Gegenbefehl bekommt seinen Versuch, auch wenn der davor nicht durchkam. Ein
 * Server, der im Schreibstopp stehen bleibt, verliert beim nächsten Absturz
 * alles seit der Sicherung.
 */
async function aufheben(
  eintrag: OffenerSchreibstopp,
  umgebung: SchreibstoppUmgebung,
): Promise<void> {
  let allesDurch = true;

  for (const zeile of eintrag.resumeCommands) {
    const erfolg = await umgebung.konsole(
      eintrag.containerId,
      eintrag.serverId,
      zeile,
      eintrag.rcon,
      'Aufheben des Schreibstopps',
    );

    allesDurch &&= erfolg;
  }

  if (allesDurch) {
    await umgebung.marker?.vergessen(eintrag.serverId);
    return;
  }

  // Merkzettel bleibt liegen: Beim nächsten Start wird es erneut versucht.
  umgebung.log.warn('Schreibstopp konnte nicht aufgehoben werden - der Merkzettel bleibt liegen.', {
    serverId: eintrag.serverId,
    containerId: eintrag.containerId,
  });
}

/**
 * Hebt beim Start des Agents jeden Schreibstopp auf, der noch offen ist.
 *
 * Ein Merkzettel, der einen Prozessstart überlebt hat, gehört zu einer
 * Sicherung, die mitten im Fenster abgerissen ist. Der Server läuft dann weiter,
 * nimmt Spieler an und schreibt nichts mehr auf die Platte.
 *
 * Fehler bleiben hier: Der Agent soll starten, auch wenn ein Server nicht
 * erreichbar ist. Was nicht gelingt, bleibt liegen und wird beim nächsten Mal
 * erneut versucht.
 */
export async function offeneSchreibstoppsAufheben(umgebung: SchreibstoppUmgebung): Promise<number> {
  const marker = umgebung.marker;

  if (marker === undefined) {
    return 0;
  }

  let offene: OffenerSchreibstopp[];

  try {
    offene = await marker.offene();
  } catch (fehler) {
    umgebung.log.warn('Merkzettel offener Schreibstopps ließen sich nicht lesen.', {
      fehler: fehler instanceof Error ? fehler.message : String(fehler),
    });

    return 0;
  }

  for (const eintrag of offene) {
    umgebung.log.warn('Offener Schreibstopp gefunden - hebe ihn auf.', {
      serverId: eintrag.serverId,
      containerId: eintrag.containerId,
      seit: eintrag.seit,
    });

    await aufheben(eintrag, umgebung);
  }

  return offene.length;
}
