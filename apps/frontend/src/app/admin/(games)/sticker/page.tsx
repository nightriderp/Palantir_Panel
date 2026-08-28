import { GameAdminPlaceholder } from '@/components/admin/games/GameAdminPlaceholder';

export const metadata = {
  title: 'Sticker · Palantir',
};

/**
 * Sticker-Sammlung (Arbeitspaket F11) – Platzhalter bis Phase 3.
 *
 * Gemeinsame Sammlung an GIFs, Memes und Stickern für die Nachrichten. In
 * Version 1 bewusst nur Platzhalter, keine Verwaltung/Upload (Lastenheft §6).
 */
export default function AdminStickerPage() {
  return (
    <GameAdminPlaceholder
      title="Sticker"
      description="Hier verwaltest du später die gemeinsame Sammlung aus GIFs, Memes und Stickern für die Nachrichten."
      icon="smile"
    />
  );
}
