import { type ReactNode } from 'react';
import { DashboardShell } from '@/app/(dashboard)/DashboardShell';

/**
 * Rahmen des Admin-Kernbereichs (Arbeitspaket F10).
 *
 * Bewusst derselbe Rahmen wie im eingeloggten Bereich: Das Mockup zeigt die
 * Admin-Abschnitte als weitere Einträge in derselben Seitenleiste, nicht als
 * getrennte Oberfläche. `DashboardShell` bringt Seitenleiste (samt der
 * Admin-Navigation aus `DashboardNav`), Kopfzeile, Toasts und den Live-Kanal
 * mit – hier wird er nur wiederverwendet, keine zweite Navigation angelegt
 * (`components/shared/README.md`).
 *
 * Die Sichtbarkeit der einzelnen Abschnitte entscheidet ausschließlich das
 * `permissions`-Objekt des Kontos (Pflichtenheft §5.2, §8); das Ausblenden im
 * UI ergänzt die Backend-Prüfung, ersetzt sie aber nie.
 */
export default function AdminCoreLayout({ children }: { children: ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
