import { PageSkeleton } from '@/components/shared';

/**
 * Ladebild für **jede** Seite des eingeloggten Bereichs.
 *
 * Bis hierher gab es im ganzen Projekt kein einziges `loading.tsx` – und das
 * war der Grund, warum sich jeder Seitenwechsel zäh anfühlte. Ohne diese Datei
 * gibt es keine Suspense-Grenze: Der Router hält die **alte** Seite stehen, bis
 * die Antwort des Servers vollständig da ist. Auf der VPS sind das je nach
 * Leitung ein paar hundert Millisekunden, in denen ein Klick sichtbar gar
 * nichts bewirkt. Alle 35 Routen sind `force-dynamic`, also trifft das jede
 * einzelne.
 *
 * Mit der Grenze tauscht der Router die Fläche sofort gegen dieses Bild und
 * schiebt den Inhalt nach, sobald er da ist.
 *
 * **Eine Datei für den ganzen Bereich.** Sie liegt in der Route-Gruppe
 * `(dashboard)`, also unterhalb von `DashboardShell`: Seitenleiste, Kopfzeile
 * und die Live-Verbindung bleiben stehen, ausgetauscht wird nur der Inhalt.
 * Genau so soll sich ein Seitenwechsel anfühlen – der Rahmen bleibt, der
 * Inhalt kommt.
 */
export default function DashboardLoading() {
  return <PageSkeleton />;
}
