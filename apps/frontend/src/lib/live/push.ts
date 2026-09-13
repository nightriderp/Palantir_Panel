import { type PushConfigDto } from '@palantir/contracts';
import { apiRequest } from '@/lib/api/client';

/**
 * Web-Push im Browser: anmelden, abmelden, Zustand feststellen.
 *
 * **Abgrenzung zu den Bildschirm-Meldungen** (`components/notifications/desktop.ts`):
 * Die zeigen eine Meldung, solange das Panel offen ist – dafür genügt die
 * Notification-API. Push ist der andere Fall: Das Panel ist zu, der Browser
 * vielleicht auch, und der Zustelldienst des Herstellers weckt den Service
 * Worker. Beides nutzt dieselbe Erlaubnis des Browsers.
 *
 * Alles hier prüft zuerst, ob der Browser überhaupt mitspielt: Ohne Service
 * Worker oder ohne `PushManager` (iOS bis 16.4, Firefox in privaten Fenstern)
 * gibt es kein Abonnement – dann bleibt es bei der Inbox im Panel.
 */

/** Pfad des Service Workers – die Datei liegt unter `public/`. */
const SW_PFAD = '/push-sw.js';

export type PushZustand =
  /** Browser kann kein Push. */
  | 'nicht-moeglich'
  /** Instanz hat keinen VAPID-Schlüssel hinterlegt. */
  | 'nicht-eingerichtet'
  /** Erlaubnis wurde abgelehnt – ohne Zutun des Nutzers geht nichts mehr. */
  | 'abgelehnt'
  /** Möglich, aber dieses Gerät ist nicht angemeldet. */
  | 'aus'
  /** Dieses Gerät bekommt Meldungen. */
  | 'an';

export function pushMoeglich(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Öffentlicher Schlüssel der Instanz; `null` = Push ist nicht eingerichtet. */
export async function ladePushConfig(signal?: AbortSignal): Promise<string | null> {
  const antwort = await apiRequest<PushConfigDto>('/notifications/push/config', { signal });

  return antwort.success ? antwort.data.publicKey : null;
}

/**
 * Base64url → Bytes.
 *
 * Der VAPID-Schlüssel kommt als Base64url-Zeichenkette, `subscribe()` verlangt
 * ein `Uint8Array`. Die Umrechnung steht in jedem Push-Beispiel des Web –
 * hier einmal, mit dem Polster, das Base64url weglässt.
 */
export function schluesselAlsBytes(base64url: string): Uint8Array {
  const polster = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + polster).replace(/-/g, '+').replace(/_/g, '/');
  const roh = window.atob(base64);
  const bytes = new Uint8Array(roh.length);

  for (let i = 0; i < roh.length; i += 1) {
    bytes[i] = roh.charCodeAt(i);
  }

  return bytes;
}

/** Bestehendes Abonnement dieses Browsers, falls vorhanden. */
export async function vorhandenesAbo(): Promise<PushSubscription | null> {
  if (!pushMoeglich()) return null;

  const registrierung = await navigator.serviceWorker.getRegistration(SW_PFAD);

  return (await registrierung?.pushManager.getSubscription()) ?? null;
}

/** Zustand für die Anzeige zusammensetzen. */
export async function pushZustand(publicKey: string | null): Promise<PushZustand> {
  if (!pushMoeglich()) return 'nicht-moeglich';
  if (publicKey === null) return 'nicht-eingerichtet';
  if (Notification.permission === 'denied') return 'abgelehnt';

  return (await vorhandenesAbo()) === null ? 'aus' : 'an';
}

/**
 * Dieses Gerät anmelden.
 *
 * Reihenfolge mit Absicht: erst die Erlaubnis (das ist der Dialog, den der
 * Nutzer sieht), dann der Service Worker, dann das Abonnement, und erst zum
 * Schluss das Backend. Scheitert etwas davor, steht im Panel kein Gerät, das
 * es nicht gibt.
 */
export async function pushAnmelden(publicKey: string): Promise<void> {
  if (!pushMoeglich()) {
    throw new Error('Dieser Browser kann keine Push-Meldungen empfangen.');
  }

  const erlaubnis = await Notification.requestPermission();

  if (erlaubnis !== 'granted') {
    throw new Error('Ohne die Erlaubnis des Browsers geht es nicht.');
  }

  const registrierung = await navigator.serviceWorker.register(SW_PFAD);
  await navigator.serviceWorker.ready;

  const abo =
    (await registrierung.pushManager.getSubscription()) ??
    (await registrierung.pushManager.subscribe({
      // Ohne diese Angabe verweigern die Browser das Abonnement: Eine Meldung,
      // die nichts anzeigt, wäre für den Betrachter eine stille Beobachtung.
      userVisibleOnly: true,
      // `BufferSource` verlangt einen echten `ArrayBuffer`; die Sicht auf
      // den Puffer genuegt der Typdefinition nicht.
      applicationServerKey: schluesselAlsBytes(publicKey).buffer as ArrayBuffer,
    }));

  const daten = abo.toJSON();
  const antwort = await apiRequest<null>('/notifications/push/subscriptions', {
    method: 'POST',
    json: {
      endpoint: abo.endpoint,
      keys: { p256dh: daten.keys?.p256dh ?? '', auth: daten.keys?.auth ?? '' },
    },
  });

  if (!antwort.success) {
    // Das Abonnement wieder abräumen: Sonst hielte der Browser eines, von dem
    // das Panel nichts weiß – und der Schalter stünde auf „an", ohne dass je
    // etwas ankäme.
    await abo.unsubscribe();
    throw new Error(antwort.error.message);
  }
}

/** Dieses Gerät abmelden – im Browser und im Panel. */
export async function pushAbmelden(): Promise<void> {
  const abo = await vorhandenesAbo();

  if (abo === null) return;

  // Erst das Panel, dann der Browser: Andersherum bliebe bei einem Fehler eine
  // Zeile stehen, zu der es kein Gerät mehr gibt.
  await apiRequest<null>('/notifications/push/subscriptions', {
    method: 'DELETE',
    json: { endpoint: abo.endpoint },
  });

  await abo.unsubscribe();
}
