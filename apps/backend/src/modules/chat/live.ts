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
   */
  register(userId: string, socket: ChatSocket): () => void {
    const existing = this.#sockets.get(userId);

    if (existing) {
      existing.add(socket);
    } else {
      this.#sockets.set(userId, new Set([socket]));
    }

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
