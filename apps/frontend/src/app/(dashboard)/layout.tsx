import { type ReactNode } from 'react';
import { releaseFromEnvironment } from '@/lib/version';
import { DashboardShell } from './DashboardShell';

/**
 * Layout des gesamten eingeloggten Bereichs – Dashboard **und** Administration.
 *
 * Hält sich absichtlich heraus und reicht nur an `DashboardShell` weiter – der
 * Rahmen selbst braucht Zustand (Seitenleiste, Toasts, Live-Kanal) und läuft
 * deshalb im Browser.
 *
 * Eine Sache erledigt das Layout selbst: die Version des laufenden Deployments
 * aus der Umgebung lesen. Das geht nur hier, auf der Server-Seite – im Browser
 * ist `process.env` leer, und zur Bauzeit ist das Versions-Tag noch nicht
 * vergeben (siehe `lib/version.ts`).
 *
 * **Ein Layout für alles, was hinter der Anmeldung liegt** (Fundpunkt
 * frontend-app-03). Bis zuletzt gab es drei deckungsgleiche Wrapper in drei
 * getrennten Route-Gruppen: `(dashboard)`, `admin/(core)` und `admin/(games)`.
 * Weil `admin/` neben `(dashboard)` lag statt darunter, tauschte Next beim
 * Wechsel `/servers` ↔ `/admin/users` das Layout-Segment aus und baute den
 * kompletten Provider-Stapel neu auf: beide WebSockets schlossen und verbanden
 * neu (die Live-Anzeige sprang auf „Wird verbunden"), `/auth/session`,
 * `GET /servers`, `GET /admin/nodes` und die Konversationsliste wurden erneut
 * geholt, laufende Toasts verschwanden und der Ungelesen-Zähler der Glocke fiel
 * bis zum nächsten `subscribed` auf `null` zurück.
 *
 * Seither liegen die Admin-Seiten als gewöhnliches Segment `admin/` **unter**
 * dieser Gruppe. Da Route-Gruppen (die Klammern) nicht in der URL erscheinen,
 * bleibt jede Adresse unverändert – `(dashboard)/admin/users/page.tsx` bedient
 * weiterhin `/admin/users`. Für React ist es nun aber ein und dasselbe Layout,
 * das über den Wechsel hinweg montiert bleibt; Live-Kanäle und Kontexte
 * überleben ihn.
 *
 * Der Rahmen ist für beide Bereiche bewusst derselbe: Das Mockup zeigt die
 * Admin-Abschnitte als weitere Einträge in derselben Seitenleiste, nicht als
 * getrennte Oberfläche (`components/shared/README.md` – keine zweite
 * Navigation). Ein eigenes Segment-Layout für `admin/` gibt es deshalb nicht;
 * es wäre eine leere Hülle. Die Sichtbarkeit der einzelnen Abschnitte
 * entscheidet ausschließlich das `permissions`-Objekt des Kontos
 * (Pflichtenheft §5.2, §8); das Ausblenden im UI ergänzt die Backend-Prüfung,
 * ersetzt sie aber nie.
 */
/**
 * Kein Vorrendern zur Bauzeit.
 *
 * Die Version des Deployments steht erst zur Laufzeit in der Umgebung
 * (`PALANTIR_RELEASE`, gesetzt von `deploy/vps/deploy.sh`). Ohne diese Zeile
 * rendert Next die Seiten dieses Bereichs beim **Bauen** vor – dort ist die
 * Variable leer, und im Image landete dauerhaft „Entwicklung".
 *
 * Der Bereich verliert dadurch nichts: Er steht hinter der Anmeldung und holt
 * seine Daten ohnehin erst im Browser; vorgerendert war hier nur ein leerer
 * Rahmen. Das gilt seit dem Zusammenlegen auch für die Admin-Seiten – sie
 * hängen samt und sonders an der Sitzung und am `permissions`-Objekt und dürfen
 * nie zwischengespeichert ausgeliefert werden.
 */
export const dynamic = 'force-dynamic';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardShell versionLabel={releaseFromEnvironment()}>{children}</DashboardShell>;
}
