import { Icon, PageHeader, PhaseLockedPlaceholder } from '@/components/shared';

/**
 * Skins aus Nutzersicht (Arbeitspaket F9, Lastenheft §7).
 *
 * In Phase 1 bewusst ein einheitlicher „Kommt später"-Zustand über die
 * gemeinsame Komponente `PhaseLockedPlaceholder` aus F2 – hier wird **keine**
 * Skin-Logik gebaut (kein Upload, keine Verwaltung, kein Backend-Aufruf). Die
 * echte Umsetzung folgt in Phase 2, sobald das erste Spiel vollständig
 * unterstützt wird.
 *
 * Die Ansicht ist über die Seitenleiste erreichbar und für alle eingeloggten
 * Konten sichtbar (kein `requires` am Navigationseintrag).
 */
export function SkinsView() {
  return (
    <>
      <PageHeader title="Skins" subtitle="Aussehen im Spiel anpassen" />
      <div className="p-5">
        <PhaseLockedPlaceholder
          title="Skins"
          description="Hier lädst und verwaltest du später deine Skins und wählst aus, wie du und deine Server im Spiel aussehen."
          phase={2}
          icon="palette"
        >
          <p className="mb-2 font-semibold text-ink">In Phase 2 geplant:</p>
          <ul className="space-y-1.5">
            <li className="flex items-start gap-2">
              <Icon name="palette" size={16} className="mt-0.5 shrink-0 text-brand" />
              <span>Eigene Skins hochladen und in einer Übersicht sammeln</span>
            </li>
            <li className="flex items-start gap-2">
              <Icon name="grid" size={16} className="mt-0.5 shrink-0 text-brand" />
              <span>Skins pro Spiel und Server zuweisen</span>
            </li>
            <li className="flex items-start gap-2">
              <Icon name="users" size={16} className="mt-0.5 shrink-0 text-brand" />
              <span>Vorschau, wie ein Skin für andere Spieler wirkt</span>
            </li>
          </ul>
        </PhaseLockedPlaceholder>
      </div>
    </>
  );
}
