/*
 * Service Worker für Web-Push.
 *
 * Bewusst winzig und bewusst **nur** für Push: Er fängt keine Anfragen ab, legt
 * nichts in einen Zwischenspeicher und macht das Panel nicht offlinefähig. Ein
 * Service Worker, der Antworten zwischenspeichert, ist die häufigste Ursache
 * für „nach dem Deployment sehe ich die alte Fassung" – und genau die vermeidet
 * das Panel an anderer Stelle (`DeployBanner`) mit einigem Aufwand.
 *
 * Er läuft in einer eigenen Welt: kein Zugriff auf das DOM, keine gemeinsamen
 * Module mit der Anwendung. Deshalb steht er als einfache Datei unter `public`
 * und nicht im Bündel.
 */

/** Was das Backend verschickt (siehe `push.ts`, `PushMessage`). */
function meldungAus(event) {
  try {
    return event.data ? event.data.json() : null;
  } catch {
    return null;
  }
}

self.addEventListener('push', (event) => {
  const meldung = meldungAus(event);

  // Ohne lesbare Nutzlast trotzdem etwas zeigen: Die Zustelldienste mancher
  // Browser schicken auch leere Weckrufe, und eine stille Meldung wäre für den
  // Betrachter dasselbe wie keine.
  const titel = meldung?.title ?? 'Palantir';
  const optionen = {
    body: meldung?.body ?? 'Es gibt etwas Neues im Panel.',
    tag: meldung?.tag ?? 'palantir',
    // Dieselbe Kennung ersetzt die vorherige Meldung, statt zu stapeln.
    renotify: Boolean(meldung?.tag),
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: meldung?.url ?? '/notifications' },
  };

  event.waitUntil(self.registration.showNotification(titel, optionen));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const ziel = new URL(event.notification.data?.url ?? '/notifications', self.location.origin).href;

  /*
   * Ein bereits offenes Panel bekommt den Klick, statt einen zweiten Tab
   * aufzumachen. Erst wenn keiner offen ist, entsteht ein neues Fenster.
   */
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((fenster) => {
      for (const client of fenster) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.navigate(ziel);

          return client.focus();
        }
      }

      return self.clients.openWindow(ziel);
    }),
  );
});
