import { GameAdminPlaceholder } from '@/components/admin/games/GameAdminPlaceholder';

export const metadata = {
  title: 'Bilder · Palantir',
};

/**
 * Spiel-Bilder (Arbeitspaket F11) – Platzhalter bis Phase 3.
 *
 * Je Spiel ein Titelbild für den Wizard und ein Kachelbild für die Übersicht.
 * Uploads/Verwaltung gehören zum generischen Spiele-System (Phase 3) und werden
 * in Version 1 bewusst nicht gebaut (Lastenheft §6, §7).
 */
export default function AdminBilderPage() {
  return (
    <GameAdminPlaceholder
      title="Bilder"
      subtitle="Titel- und Kachelbilder je Spiel"
      description="Hier hinterlegst du später je Spiel ein Titelbild für den Wizard und ein Kachelbild für die Serverübersicht."
      icon="image"
    />
  );
}
