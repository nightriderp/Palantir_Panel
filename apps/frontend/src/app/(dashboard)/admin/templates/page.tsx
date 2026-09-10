import { TemplatesView } from '@/components/admin/games/TemplatesView';

export const metadata = {
  title: 'Templates · Palantir',
};

/**
 * Spiel-Vorlagen (Arbeitspaket F11).
 *
 * Kein Anlegen, kein Bearbeiten: Der Katalog bleibt Code (Lastenheft §6,
 * Pflichtenheft §11). Was hier steht, ist die andere Frage – welche der
 * vorhandenen Vorlagen diese Instanz anbietet.
 */
export default function AdminTemplatesPage() {
  return <TemplatesView />;
}
