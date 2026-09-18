/**
 * Textbildung: Ereignis + Nutzlast → Titel, Text, Dringlichkeit, Bezug.
 *
 * Die Texte entstehen **einmal beim Auslösen** und werden dann fertig
 * gespeichert (`notifications.title`/`body`). Bewusst nicht bei jedem Abruf neu
 * gebildet: Die Meldung soll den Stand zum Zeitpunkt des Ereignisses zeigen –
 * wird ein Server später umbenannt oder gelöscht, bleibt „Server »Wüstensturm«
 * ist abgestürzt" lesbar. Dieselbe Überlegung wie bei
 * `AuditLogEntryDto.actorDisplayName` (Pflichtenheft §6).
 *
 * Sprache ist Deutsch wie die gesamte Oberfläche (Pflichtenheft §8, Kommentar
 * zum Permission-Katalog).
 */

import type {
  NotificationEvent,
  NotificationSeverity,
  NotificationSubject,
} from '@palantir/contracts';

export interface RenderedNotification {
  title: string;
  body: string;
  /**
   * Dringlichkeit, die zum Ereignis selbst passt.
   *
   * Eine Regel darf sie überschreiben (`NotificationRuleDto.severity`) – manche
   * Instanz will einen Serverstopp lauter oder leiser hören. Ohne eigene Angabe
   * gilt dieser Wert.
   */
  severity: NotificationSeverity;
  subject: NotificationSubject | null;
}

/** Ressourcen-Bezeichnungen für den Text der Ressourcen-Warnung. */
const RESOURCE_LABELS = {
  ram: 'Arbeitsspeicher',
  cpu: 'CPU',
  disk: 'Speicherplatz',
} as const;

/**
 * „Gewünscht: 16384 MiB RAM, 4 Server" – der beantragte Teil in einem Satz.
 *
 * Ohne Wunsch gibt es nichts zu nennen; das kommt bei einer Kontingent-Anfrage
 * nicht vor (das Schema verlangt einen), aber die Nutzlast kommt über eine
 * bewusst schmale Senke und wird hier nicht erzwungen – dieselbe Überlegung
 * wie bei {@link withDetail}.
 */
function quotaWish(payload: {
  requestedRamMb: number | null;
  requestedMaxConcurrentServers: number | null;
}): string {
  const teile = [
    payload.requestedRamMb === null ? null : `${String(payload.requestedRamMb)} MiB RAM`,
    payload.requestedMaxConcurrentServers === null
      ? null
      : `${String(payload.requestedMaxConcurrentServers)} gleichzeitige Server`,
  ].filter((teil): teil is string => teil !== null);

  return teile.length === 0
    ? 'Die Anfrage nennt keinen Wunsch.'
    : `Gewünscht: ${teile.join(', ')}.`;
}

function serverSubject(payload: { serverId: string; serverName: string }): NotificationSubject {
  return { type: 'server', id: payload.serverId, displayName: payload.serverName };
}

/** Hängt den Zusatz der Quelle an, sofern es einen gibt. */
/**
 * Haengt einen Freitextzusatz an, wenn es einen gibt.
 *
 * `undefined` gilt wie `null` (Gefundener Punkt 118): Die Nutzlasten kommen
 * ueber eine bewusst schmale Senke (`Record<string, unknown>`), der Vertrag
 * wird dort nicht erzwungen. Ein fehlendes Feld darf das Rendern nicht
 * abstuerzen lassen - sonst geht die ganze Meldung verloren, und das
 * ausgerechnet im Fehlerfall, in dem sie am meisten zaehlt.
 */
function withDetail(text: string, detail: string | null | undefined): string {
  const zusatz = detail?.trim() ?? '';

  return zusatz.length === 0 ? text : `${text} ${zusatz}`;
}

/** Prozentwert in deutscher Schreibweise, auf eine Nachkommastelle. */
function percent(value: number): string {
  return value.toFixed(1).replace('.', ',');
}

/**
 * Bildet Titel und Text zu einem Ereignis.
 *
 * Der Parameter ist die unterscheidbare Vereinigung `NotificationEvent` aus
 * `@palantir/contracts` und nicht ein Paar aus Name und `unknown`: So ist die
 * Nutzlast in jedem Zweig ohne Typumwandlung richtig typisiert, und der
 * `never`-Zweig am Ende lässt den Übersetzer scheitern, sobald ein Ereignis zu
 * `NOTIFIABLE_EVENTS` dazukommt und hier vergessen wird. Ein neues Ereignis
 * kann damit nicht still mit leerem Text zugestellt werden.
 */
export function renderNotification(input: NotificationEvent): RenderedNotification {
  switch (input.event) {
    case 'server.created':
      return {
        title: `Server »${input.payload.serverName}« wurde erstellt`,
        body: withDetail('Der Server ist angelegt und einsatzbereit.', input.payload.detail),
        severity: 'info',
        subject: serverSubject(input.payload),
      };

    case 'server.started':
      return {
        title: `Server »${input.payload.serverName}« läuft`,
        body: withDetail('Der Server wurde gestartet und ist erreichbar.', input.payload.detail),
        severity: 'info',
        subject: serverSubject(input.payload),
      };

    case 'server.stopped':
      return {
        title: `Server »${input.payload.serverName}« wurde gestoppt`,
        body: withDetail('Der Server ist heruntergefahren.', input.payload.detail),
        severity: 'info',
        subject: serverSubject(input.payload),
      };

    case 'server.restarted':
      return {
        title: `Server »${input.payload.serverName}« wurde neu gestartet`,
        body: withDetail('Der Neustart ist abgeschlossen.', input.payload.detail),
        severity: 'info',
        subject: serverSubject(input.payload),
      };

    case 'server.crashed':
      return {
        title: `Server »${input.payload.serverName}« ist abgestürzt`,
        body: withDetail(
          'Der Server wurde unerwartet beendet und wird automatisch neu gestartet.',
          input.payload.detail,
        ),
        severity: 'warning',
        subject: serverSubject(input.payload),
      };

    case 'server.failed':
      return {
        title: `Server »${input.payload.serverName}« braucht Aufmerksamkeit`,
        body: withDetail(
          'Der Server steht im Fehlerzustand und startet nicht von allein wieder.',
          input.payload.detail,
        ),
        severity: 'error',
        subject: serverSubject(input.payload),
      };

    case 'server.cloned':
      return {
        title: `Server »${input.payload.serverName}« wurde geklont`,
        body: withDetail('Der geklonte Server ist angelegt.', input.payload.detail),
        severity: 'info',
        subject: serverSubject(input.payload),
      };

    case 'server.deleted':
      return {
        title: `Server »${input.payload.serverName}« wurde gelöscht`,
        body: withDetail('Container, Daten und Adresse wurden entfernt.', input.payload.detail),
        severity: 'warning',
        // Bewusst ohne Bezug: Der Sprung ginge auf eine Seite, die es nicht
        // mehr gibt.
        subject: null,
      };

    case 'server.ownerTransferred':
      return {
        title: `Server »${input.payload.serverName}« hat einen neuen Besitzer`,
        body: withDetail(
          'Ein Administrator hat den Server samt Sicherungen übertragen. Wer ihn jetzt besitzt, steht in den Server-Details.',
          input.payload.detail,
        ),
        severity: 'info',
        subject: serverSubject(input.payload),
      };

    case 'autoShutdown.triggered':
      return {
        title: `Server »${input.payload.serverName}« wurde automatisch abgeschaltet`,
        body: withDetail(
          `Der Server war ${String(input.payload.idleMinutes)} Minuten ohne Spieler und wurde deshalb gestoppt.`,
          input.payload.detail,
        ),
        severity: 'info',
        subject: serverSubject(input.payload),
      };

    case 'backup.failed':
      return {
        title: `Backup von »${input.payload.serverName}« ist fehlgeschlagen`,
        body: withDetail(
          `Die Sicherung wurde nicht abgeschlossen (${input.payload.failureCode}).`,
          input.payload.failureMessage,
        ),
        severity: 'error',
        subject: {
          type: 'backup',
          id: input.payload.backupId,
          displayName: input.payload.serverName,
        },
      };

    case 'resource.low': {
      const { payload } = input;
      const resource = RESOURCE_LABELS[payload.resource];

      if (payload.scope === 'node') {
        return {
          title: `${resource} wird knapp`,
          body: `Die Node ist zu ${percent(payload.usedPercent)} % ausgelastet (Warnschwelle ${percent(payload.thresholdPercent)} %).`,
          severity: 'warning',
          subject: { type: 'node', id: payload.nodeId, displayName: null },
        };
      }

      return {
        title: `${resource} eines Servers wird knapp`,
        body: `Der Server nutzt ${percent(payload.usedPercent)} % seines Kontingents (Warnschwelle ${percent(payload.thresholdPercent)} %).`,
        severity: 'warning',
        subject:
          payload.serverId === null
            ? { type: 'node', id: payload.nodeId, displayName: null }
            : { type: 'server', id: payload.serverId, displayName: null },
      };
    }

    case 'user.registered':
      return {
        title: `Neue Registrierung: ${input.payload.displayName}`,
        body: input.payload.awaitingApproval
          ? 'Das Konto wartet auf die Freischaltung durch einen Administrator.'
          : 'Das Konto wurde angelegt und ist freigeschaltet.',
        severity: 'info',
        subject: {
          type: 'user',
          id: input.payload.userId,
          displayName: input.payload.displayName,
        },
      };

    case 'message.reported':
      return {
        title: 'Eine Nachricht wurde gemeldet',
        body: withDetail('Die Meldung wartet auf Bearbeitung.', input.payload.reason),
        severity: 'warning',
        subject: { type: 'message', id: input.payload.messageId, displayName: null },
      };

    /*
     * Zwei Sorten Bitte unter einem Ereignis (siehe `QuotaRequestTrigger`), und
     * sie verlangen Verschiedenes: Die eine hebt eine Grenze, die andere
     * schafft Platz auf der Maschine. Der Titel sagt deshalb, worum es geht,
     * bevor jemand die Anfrage öffnet.
     *
     * Die Begründung steht mit im Text: Sie ist das, woran ein Mensch
     * entscheidet – eine Meldung, die nur „X hat etwas beantragt" sagt, zwingt
     * zum Nachsehen, bevor man weiß, ob es eilt.
     */
    case 'quotaRequest.created': {
      const kapazitaet = input.payload.trigger === 'nodeCapacity';

      return {
        title: kapazitaet
          ? `${input.payload.displayName} meldet zu wenig freie Kapazität`
          : `${input.payload.displayName} beantragt mehr Kontingent`,
        body: withDetail(
          kapazitaet
            ? 'Ein Start ist an den freien Ressourcen der Node geraten.'
            : quotaWish(input.payload),
          input.payload.reason,
        ),
        severity: 'info',
        subject: {
          type: 'user',
          id: input.payload.userId,
          displayName: input.payload.displayName,
        },
      };
    }

    case 'announcement.published':
      return {
        title: input.payload.title,
        body: input.payload.body,
        severity: input.payload.severity,
        subject: {
          type: 'announcement',
          id: input.payload.announcementId,
          displayName: input.payload.title,
        },
      };

    default: {
      const exhaustive: never = input;

      throw new Error(
        `Kein Meldungstext für das Ereignis ${JSON.stringify(exhaustive)} hinterlegt.`,
      );
    }
  }
}
