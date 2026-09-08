import { FontsView } from '@/components/admin/fonts/FontsView';

export const metadata = {
  title: 'Schriften · Palantir',
};

/**
 * Schriften der Oberfläche (Arbeitspaket S-3, Lastenheft §3.10).
 *
 * Verwaltung und Auswahl der beiden Schriftrollen. Berechtigung ist
 * `user.manage` – dieselbe, die die Backend-Routen verlangen und unter der die
 * Auswahl in den Instanz-Einstellungen gespeichert wird.
 */
export default function AdminSchriftenPage() {
  return <FontsView />;
}
