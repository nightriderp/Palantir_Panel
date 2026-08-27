import { type NotificationDto } from '@palantir/contracts';

/**
 * Browser-Mitteilungen (Web-Notifications-API) für neue Meldungen.
 *
 * Bewusst hier gekapselt und nicht im Design-System: Es ist eine Eigenheit
 * dieses Arbeitspakets und hängt an einer Browser-API, die nicht überall
 * vorhanden ist. Ohne Unterstützung oder ohne Erlaubnis passiert schlicht
 * nichts – die Inbox und die Einblendungen funktionieren unabhängig davon.
 */

export type DesktopPermission = 'unsupported' | 'default' | 'granted' | 'denied';

function isSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/** Aktueller Erlaubnisstand; `unsupported`, wenn der Browser die API nicht kennt. */
export function desktopPermission(): DesktopPermission {
  if (!isSupported()) return 'unsupported';
  return Notification.permission as DesktopPermission;
}

/**
 * Erlaubnis anfragen. `true`, wenn danach zugestellt werden darf.
 *
 * Der Aufruf muss aus einer Nutzeraktion heraus geschehen (ein Klick auf den
 * Schalter) – deshalb liegt er im Umschalten der Einstellung, nicht beim Laden.
 */
export async function requestDesktopPermission(): Promise<boolean> {
  if (!isSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  try {
    const result = await Notification.requestPermission();
    return result === 'granted';
  } catch {
    return false;
  }
}

/**
 * Eine Meldung als Browser-Mitteilung zeigen, sofern erlaubt.
 *
 * Titel und Text kommen fertig aus dem `NotificationDto` (Pflichtenheft §5.2);
 * hier wird nichts neu formuliert. Fehler werden verschluckt: Eine
 * fehlgeschlagene Mitteilung darf den Empfang der Meldung nicht stören.
 */
export function showDesktopNotification(notification: NotificationDto): void {
  if (desktopPermission() !== 'granted') return;

  try {
    // Die Konstruktion selbst ist die Zustellung; das Objekt wird nicht gebraucht.
    void new Notification(notification.title, {
      body: notification.body,
      tag: notification.id,
    });
  } catch {
    // Kein Grund, den Empfang der Meldung zu stören.
  }
}
