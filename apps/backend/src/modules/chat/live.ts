/**
 * Live-Zustellung des Chats (Pflichtenheft §5.3, §15).
 *
 * Eine WebSocket-Verbindung gehört genau einem angemeldeten Konto. Über sie
 * gehen die Ereignisse **aller** Konversationen, an denen dieses Konto
 * teilnimmt – ohne `subscribe`-Frame: Eine gerade erst entstandene DM ließe
 * sich nicht abonnieren, bevor man von ihr weiß, und genau davon soll der Kanal
 * berichten.
 *
 * **Adressiert wird je Konto, nicht je Konversation.** Das ist der Grund, warum
 * dieser Verteiler keinen Bezug zu Konversationen kennt: Wer etwas zugestellt
 * bekommt, entscheidet der Dienst, der die Sichtbarkeitsregel aus
 * `visibility.ts` bereits angewendet hat. Ein Verteiler, der selbst
 * Teilnehmerkreise auflöste, wäre eine zweite Stelle mit derselben Regel.
 *
 * Ein Konto kann mehrere Verbindungen haben (mehrere Geräte oder Tabs); alle
 * bekommen dasselbe Frame.
 */

import { type ChatEventPayloads, type ChatServerEventFrame } from '@palantir/contracts';

/**
 * Close-Code „nicht (mehr) angemeldet".
 *
 * Dieselbe Zahl wie beim Inbox-Kanal (`NOTIFICATION_LIVE_CLOSE_CODE_UNAUTHORIZED`
 * in `@palantir/contracts`), beim Agent-Kanal und im Frontend
 * (`lib/live/chatChannel.ts`): Aus dem privaten Bereich, damit der Browser
 * „nicht angemeldet" von „Backend gerade weg" unterscheiden und in diesem Fall
 * auf den Wiederverbindungsversuch verzichten kann. Hier als benannte Konstante,
 * damit Handshake-Abweisung und {@link ChatLiveHub.closeAll} dieselbe Zahl
 * benutzen (der Vertrag führt bislang nur die Konstante des Inbox-Kanals –
 * „Gefundener Punkt" 91).
 */
export const CHAT_LIVE_CLOSE_CODE_UNAUTHORIZED = 4401;

/**
 * Close-Code „zu viele Verbindungen dieses Kontos" (Audit W2-3,
 * `backend-community-visibility-11`).
 *
 * Aus demselben privaten Bereich wie {@link CHAT_LIVE_CLOSE_CODE_UNAUTHORIZED},
 * die Zahl lehnt sich an HTTP 429 an. **Backend-lokal, mit Absicht:** Der
 * Vertrag führt bislang nur `NOTIFICATION_LIVE_CLOSE_CODE_UNAUTHORIZED`; ein
 * weiterer geteilter Close-Code gehört in einen eigenen Contracts-PR
 * (CLAUDE.md §6) und wird als Vertragsbedarf notiert. Für das Frontend ist die
 * Unterscheidung ohnehin unkritisch: Es darf – anders als bei 4401 – neu
 * verbinden, nur eben nicht sofort und nicht hundertfach.
 */
export const CHAT_LIVE_CLOSE_CODE_TOO_MANY_CONNECTIONS = 4029;

/**
 * Wie viele gleichzeitige Live-Verbindungen ein Konto haben darf.
 *
 * Zehn decken den realistischen Fall ab (mehrere Geräte, mehrere Tabs, ein
 * Reload, dessen alte Verbindung noch nicht abgeräumt ist) und begrenzen
 * trotzdem den Hebel: Jede Zustellung an ein Konto wird einmal serialisiert und
 * je Verbindung gesendet – ohne Obergrenze vervielfachte ein Konto mit 5 000
 * offenen Sockets jeden fremden Beitrag im Server-Chat
 * (`backend-community-visibility-11`).
 *
 * Bewusst eine Konstante und keine Umgebungsvariable: Es gibt keinen
 * Betriebsfall, in dem hier eine andere Zahl gebraucht würde (CLAUDE.md §8).
 */
export const CHAT_LIVE_MAX_CONNECTIONS_PER_USER = 10;

/** Abstand zweier Server-Pings am offenen Live-Kanal. */
export const CHAT_LIVE_HEARTBEAT_INTERVAL_MS = 30_000;

/** Der Ausschnitt eines WebSockets, den die Zustellung braucht. */
export interface ChatSocket {
  send(data: string): void;
  /**
   * Beendet die Verbindung.
   *
   * Gehört zur Schnittstelle, weil der Verteiler die Sockets eines Kontos von
   * sich aus schließen können muss, sobald dessen Sitzungen ungültig werden
   * (Sperre, Remote-Logout) – ohne das lief ein offener Socket weiter
   * (Audit W2-2, `backend-community-visibility-03`).
   */
  close(code: number, reason?: string): void;
}

/** Zustellung an genau ein Konto. */
export interface ChatDelivery {
  deliver(userId: string, frame: ChatServerEventFrame): void;
}

/**
 * Zustellung ins Leere – Vorgabe, solange keine Verbindung offen ist, und
 * Vorgabe in Tests, die den Kanal nicht prüfen.
 *
 * Bewusst wirkungslos statt einer Fehlermeldung: Eine Nachricht darf nicht
 * daran scheitern, dass der Empfänger gerade nicht online ist – sie steht beim
 * nächsten Abruf im Verlauf.
 */
export const noopChatDelivery: ChatDelivery = {
  deliver() {
    // absichtlich leer
  },
};

export class ChatLiveHub implements ChatDelivery {
  readonly #sockets = new Map<string, Set<ChatSocket>>();

  /**
   * Meldet eine Verbindung an und liefert die Abmeldung zurück.
   *
   * Die Abmeldung ist idempotent: Sie wird sowohl beim `close` als auch beim
   * `error` des Sockets aufgerufen, und beide können nacheinander kommen.
   *
   * Über {@link CHAT_LIVE_MAX_CONNECTIONS_PER_USER} hinaus fallen die
   * **ältesten** Verbindungen desselben Kontos weg (Audit W2-3,
   * `backend-community-visibility-11`). Bewusst die ältesten und nicht die
   * neue: Eine halboffene Verbindung (Mobilfunk, Proxy-Timeout ohne FIN) bleibt
   * bis zum TCP-Timeout im Verteiler stehen; würde die neue abgewiesen, sperrte
   * sich ein Nutzer mit wackliger Leitung selbst aus. Konten anderer Nutzer
   * sind davon nie betroffen – gezählt wird je Konto.
   */
  register(userId: string, socket: ChatSocket): () => void {
    const existing = this.#sockets.get(userId);

    if (existing) {
      existing.add(socket);
    } else {
      this.#sockets.set(userId, new Set([socket]));
    }

    this.#trimOldest(userId);

    return (): void => {
      const sockets = this.#sockets.get(userId);

      if (!sockets) {
        return;
      }

      sockets.delete(socket);

      if (sockets.size === 0) {
        this.#sockets.delete(userId);
      }
    };
  }

  /**
   * Stellt ein Frame an alle Verbindungen eines Kontos zu.
   *
   * Ein Fehler beim Senden beendet die Zustellung an die übrigen Verbindungen
   * nicht: Ein halb geschlossener Socket darf die anderen Empfänger nicht um
   * ihre Nachricht bringen.
   */
  deliver(userId: string, frame: ChatServerEventFrame): void {
    const sockets = this.#sockets.get(userId);

    if (!sockets || sockets.size === 0) {
      return;
    }

    const payload = JSON.stringify(frame);

    for (const socket of sockets) {
      try {
        socket.send(payload);
      } catch {
        // Verbindung ist bereits weg; das `close`-Ereignis meldet sie ab.
      }
    }
  }

  /**
   * Schließt **alle** Verbindungen eines Kontos und meldet sie ab; liefert
   * zurück, wie viele es waren.
   *
   * Der Anschluss für Sperre und Sitzungswiderruf (Audit W2-2,
   * `backend-community-visibility-03`): Die Sitzung wurde bisher nur im
   * Handshake geprüft, ein einmal offener Socket bekam danach weiter private
   * Nachrichten – auch nachdem jeder REST-Aufruf desselben Kontos längst
   * abgelehnt wurde. Wer das auslöst, entscheidet `server.ts`; dieser Verteiler
   * kennt weder Sitzungen noch Sperren.
   *
   * Ein Fehler beim Schließen beendet den Durchlauf nicht – die übrigen
   * Verbindungen müssen trotzdem weg.
   */
  closeAll(userId: string, code: number, reason = 'Sitzung beendet.'): number {
    const sockets = this.#sockets.get(userId);

    if (!sockets || sockets.size === 0) {
      return 0;
    }

    const open = [...sockets];

    // Erst abmelden, dann schließen: Das `close`-Ereignis meldet dieselbe
    // Verbindung gleich noch einmal ab – die Abmeldung ist idempotent, aber
    // eine Zustellung dazwischen darf es nicht mehr geben.
    this.#sockets.delete(userId);

    for (const socket of open) {
      try {
        socket.close(code, reason);
      } catch {
        // Verbindung ist bereits weg; mehr als schließen war nicht zu tun.
      }
    }

    return open.length;
  }

  /** Offene Verbindungen eines Kontos – für Tests und Diagnose. */
  connectionCount(userId: string): number {
    return this.#sockets.get(userId)?.size ?? 0;
  }

  /**
   * Schließt die ältesten Verbindungen eines Kontos, bis die Obergrenze wieder
   * eingehalten ist.
   *
   * Ein `Set` behält die Einfügereihenfolge; der erste Eintrag ist damit die
   * älteste Verbindung. Sie wird zuerst abgemeldet und dann geschlossen – ihr
   * `close`-Ereignis meldet dieselbe Verbindung gleich noch einmal ab, was
   * idempotent ist, aber eine Zustellung dazwischen darf es nicht mehr geben.
   */
  #trimOldest(userId: string): void {
    const sockets = this.#sockets.get(userId);

    if (!sockets) {
      return;
    }

    while (sockets.size > CHAT_LIVE_MAX_CONNECTIONS_PER_USER) {
      const aeltester = sockets.values().next().value;

      if (aeltester === undefined) {
        return;
      }

      sockets.delete(aeltester);

      try {
        aeltester.close(
          CHAT_LIVE_CLOSE_CODE_TOO_MANY_CONNECTIONS,
          'Zu viele gleichzeitige Verbindungen dieses Kontos.',
        );
      } catch {
        // Verbindung ist bereits weg; mehr als schließen war nicht zu tun.
      }
    }
  }
}

/**
 * Der Ausschnitt einer echten WebSocket-Verbindung, den das Lebenszeichen
 * braucht.
 *
 * Absichtlich schmaler als `ws.WebSocket`: So lässt sich der Zyklus ohne Netz
 * prüfen (CLAUDE.md §4).
 */
export interface ChatHeartbeatSocket {
  /** Sendet einen Ping-Frame; die Gegenstelle antwortet auf Protokollebene. */
  ping(): void;
  /** Reißt die Verbindung ab – ohne Close-Handshake, den es hier nicht mehr gibt. */
  terminate(): void;
  on(event: 'pong', listener: () => void): unknown;
}

export interface ChatHeartbeatOptions {
  /** Abstand zweier Pings; Vorgabe {@link CHAT_LIVE_HEARTBEAT_INTERVAL_MS}. */
  readonly intervalMs?: number;
}

/**
 * Server-seitiges Lebenszeichen einer Live-Verbindung (Audit W2-3,
 * `backend-community-visibility-11`, `backend-community-13`).
 *
 * **Warum serverseitig.** Der Client schickt zwar einen `ping`-Frame, den las
 * dieser Kanal aber nie – und selbst wenn: Ein Lebenszeichen, das die
 * Gegenstelle senden muss, erkennt genau den Fall nicht, um den es geht. Eine
 * halboffene Verbindung (Mobilfunk-Abbruch, Proxy-Timeout ohne FIN) meldet sich
 * nicht mehr und feuert auch kein `close`; sie blieb bis zum TCP-Timeout im
 * Verteiler und bekam bei jeder Zustellung ihre Kopie.
 *
 * **Der Ablauf** ist der übliche für `ws`: Jeder Takt prüft, ob seit dem
 * letzten Ping ein Pong kam. Fehlt er, wird die Verbindung abgerissen
 * (`terminate()`, nicht `close()` – auf einen Handshake antwortet dort niemand
 * mehr). Eine tote Verbindung ist damit nach höchstens zwei Takten weg.
 *
 * Die Rückgabe beendet den Zyklus; sie gehört in dieselbe Aufräumfunktion wie
 * die Abmeldung am Verteiler.
 */
export function startChatHeartbeat(
  socket: ChatHeartbeatSocket,
  options: ChatHeartbeatOptions = {},
): () => void {
  const intervalMs = options.intervalMs ?? CHAT_LIVE_HEARTBEAT_INTERVAL_MS;

  let lebtNoch = true;

  socket.on('pong', () => {
    lebtNoch = true;
  });

  const timer = setInterval(() => {
    if (!lebtNoch) {
      clearInterval(timer);
      socket.terminate();

      return;
    }

    lebtNoch = false;
    socket.ping();
  }, intervalMs);

  // Der Zeitgeber darf das Beenden des Prozesses nicht aufhalten.
  timer.unref();

  return (): void => {
    clearInterval(timer);
  };
}

/*
 * Frame-Bauer je Ereignis.
 *
 * Bewusst drei kleine Funktionen statt einer generischen: So prüft der Compiler
 * die Nutzdaten gegen `ChatEventPayloads`, ohne dass irgendwo eine Typzusicherung
 * (`as`) nötig wäre.
 */

export function messageSentFrame(
  data: ChatEventPayloads['message.sent'],
  sentAt: Date,
): ChatServerEventFrame {
  return { kind: 'event', event: 'message.sent', data, sentAt: sentAt.toISOString() };
}

export function messageDeletedFrame(
  data: ChatEventPayloads['message.deleted'],
  sentAt: Date,
): ChatServerEventFrame {
  return { kind: 'event', event: 'message.deleted', data, sentAt: sentAt.toISOString() };
}

export function conversationCreatedFrame(
  data: ChatEventPayloads['conversation.created'],
  sentAt: Date,
): ChatServerEventFrame {
  return { kind: 'event', event: 'conversation.created', data, sentAt: sentAt.toISOString() };
}

export function conversationReadFrame(
  data: ChatEventPayloads['conversation.read'],
  sentAt: Date,
): ChatServerEventFrame {
  return { kind: 'event', event: 'conversation.read', data, sentAt: sentAt.toISOString() };
}
