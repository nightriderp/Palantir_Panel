import { GameAdminPlaceholder } from '@/components/admin/games/GameAdminPlaceholder';

export const metadata = {
  title: 'Templates · Palantir',
};

/**
 * Spiel-Vorlagen (Arbeitspaket F11) – Platzhalter bis Phase 3.
 *
 * Kein Scope-Creep: In Version 1 gibt es keine Admin-Oberfläche zum Anlegen von
 * Spiele-Typen (Lastenheft §6); die Vorlagen mit generischen Feldern entstehen
 * fachlich erst mit dem Spiele-Definitionssystem der Phase 3 (§7).
 */
export default function AdminTemplatesPage() {
  return (
    <GameAdminPlaceholder
      title="Templates"
      subtitle="Vorlagen, aus denen neue Spiele-Typen entstehen"
      description="Hier entstehen später die Spiel-Vorlagen mit ihren generischen Feldern – die Grundlage, auf der neue Spiele-Typen ohne Code-Änderung angelegt werden."
      icon="layers"
    />
  );
}
