import { GameAdminPlaceholder } from '@/components/admin/games/GameAdminPlaceholder';

export const metadata = {
  title: 'Arcade-Musik · Palantir',
};

/**
 * Arcade-Musik (Arbeitspaket F11) – Platzhalter bis Phase 3.
 *
 * Je Spiel ein eigenes Musikstück; ohne eigenes klingt das eingebaute. Die
 * Verwaltung entsteht mit dem generischen Spiele-System (Phase 3) und wird in
 * Version 1 bewusst nicht gebaut (Lastenheft §6, §7).
 */
export default function AdminArcadeMusikPage() {
  return (
    <GameAdminPlaceholder
      title="Arcade-Musik"
      subtitle="Musik je Arcade-Spiel"
      description="Hier hinterlegst du später je Spiel ein eigenes Musikstück – ohne eigenes klingt das eingebaute."
      icon="gamepad"
    />
  );
}
