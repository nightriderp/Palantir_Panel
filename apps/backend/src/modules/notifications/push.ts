import { type PushConfigDto } from '@palantir/contracts';

/**
 * Web-Push: Meldungen erreichen ein Konto auch, wenn das Panel geschlossen ist.
 *
 * **Verhältnis zum Bestehenden.** Die Inbox bleibt die Wahrheit, der Live-Kanal
 * versorgt offene Ansichten, und die Regeln des Administrators entscheiden
 * weiterhin, wer eine Meldung überhaupt bekommt. Push ist nur ein weiterer Weg
 * derselben Meldung – kein eigener Empfängerkreis und keine zweite Wahrheit.
 * Wer ein Ereignis abbestellt hat, bekommt es hier so wenig wie in der Inbox:
 * Der Versand hängt an `zustellen()`, also an dem, was ohnehin entstanden ist.
 *
 * **Verschlüsselung.** Die Nutzlast wird für genau ein Gerät verschlüsselt
 * (`p256dh`/`auth` aus dem Abonnement); der Zustelldienst des Browserherstellers
 * sieht nur, dass etwas kommt, nicht was. Dafür sorgt die Bibliothek – das ist
 * der Grund, sie zu nehmen.
 */

/** Ein Abonnement, wie es in der Datenbank steht. */
export interface PushSubscriptionRecord {
  readonly id: string;
  readonly userId: string;
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

/** Was an ein Gerät geht. Bewusst knapp – eine Meldung, kein Datensatz. */
export interface PushMessage {
  readonly title: string;
  readonly body: string;
  /** Wohin der Klick führt, relativ zur Panel-Adresse. */
  readonly url: string;
  /**
   * Kennung zum Zusammenfassen: Mehrere Meldungen desselben Servers ersetzen
   * einander auf dem Sperrbildschirm, statt sich zu stapeln.
   */
  readonly tag: string;
}

/**
 * Ausgang eines Versuchs.
 *
 * `gone` heisst: Der Zustelldienst kennt dieses Abonnement nicht mehr (404/410).
 * Das ist **kein Fehler**, sondern ein abgemeldetes Gerät – der Aufrufer
 * entfernt die Zeile.
 */
export type PushOutcome = 'sent' | 'gone' | 'failed';

/** Versand an ein Gerät. Die Umsetzung steht in `web-push.ts`. */
export interface PushSender {
  send(subscription: PushSubscriptionRecord, message: PushMessage): Promise<PushOutcome>;
}

/** Ablage der Abonnements. */
export interface PushSubscriptionStore {
  /** Legt an oder frischt auf – dieselbe Adresse bleibt eine Zeile. */
  save(input: {
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent: string | null;
  }): Promise<void>;
  remove(userId: string, endpoint: string): Promise<void>;
  /** Entfernt ein Abonnement, das der Zustelldienst nicht mehr kennt. */
  removeByEndpoint(endpoint: string): Promise<void>;
  listForUser(userId: string): Promise<readonly PushSubscriptionRecord[]>;
  markUsed(endpoint: string, at: Date): Promise<void>;
}

/**
 * Versand an alle Geräte eines Kontos.
 *
 * Gescheiterte Zustellungen werden **nicht** wiederholt: Eine Push-Meldung ist
 * ein Hinweis, kein Beleg – die Meldung selbst steht in der Inbox und geht
 * nicht verloren. Wiederholungen brächten hier vor allem doppelte Hinweise.
 */
export async function sendToUser(
  deps: { store: PushSubscriptionStore; sender: PushSender; now?: () => Date },
  userId: string,
  message: PushMessage,
): Promise<{ sent: number; removed: number; failed: number }> {
  const jetzt = deps.now ?? ((): Date => new Date());
  const abos = await deps.store.listForUser(userId);

  let sent = 0;
  let removed = 0;
  let failed = 0;

  for (const abo of abos) {
    const ausgang = await deps.sender.send(abo, message);

    if (ausgang === 'sent') {
      sent += 1;
      await deps.store.markUsed(abo.endpoint, jetzt());
      continue;
    }

    if (ausgang === 'gone') {
      removed += 1;
      await deps.store.removeByEndpoint(abo.endpoint);
      continue;
    }

    failed += 1;
  }

  return { sent, removed, failed };
}

/** Öffentlicher Teil der Einrichtung für die Oberfläche. */
export function toPushConfigDto(publicKey: string | undefined): PushConfigDto {
  return { publicKey: publicKey !== undefined && publicKey !== '' ? publicKey : null };
}
