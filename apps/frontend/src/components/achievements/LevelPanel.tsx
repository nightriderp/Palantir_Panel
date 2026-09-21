import { type AchievementOverviewDto } from '@palantir/contracts';
import { Icon, Panel } from '@/components/shared';

/**
 * Stufe und Fortschritt (Betreiber-Wunsch 21.09.2026).
 *
 * Zeigt die erreichte Stufe, wie viele Abzeichen sie getragen haben und wie
 * viele bis zur nächsten fehlen. Der Balken misst den Weg **innerhalb** der
 * laufenden Stufe, nicht den Gesamtfortschritt: „noch zwei bis Stammgast" ist
 * die Auskunft, die jemanden trägt – „9 von 20" sagt nur, wie weit es noch ist.
 */

export interface LevelPanelProps {
  overview: AchievementOverviewDto;
}

export function LevelPanel({ overview }: LevelPanelProps) {
  const { level, nextLevel, unlockedCount, totalCount } = overview;

  const spanne = nextLevel === null ? 0 : nextLevel.required - level.required;
  const geschafft = unlockedCount - level.required;
  const anteil = spanne === 0 ? 100 : Math.min(100, Math.round((geschafft / spanne) * 100));
  const fehlend = nextLevel === null ? 0 : nextLevel.required - unlockedCount;

  return (
    <Panel className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon name="medal" size={18} className="text-brand" />
          <span className="text-md font-semibold text-ink">
            Stufe {level.level} · {level.label}
          </span>
        </div>
        <span className="font-mono text-sm text-ink-muted">
          {unlockedCount} von {totalCount} Abzeichen
        </span>
      </div>

      <div
        className="h-2 w-full overflow-hidden rounded-full bg-fill"
        role="progressbar"
        aria-valuenow={anteil}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Fortschritt zur nächsten Stufe: ${anteil} Prozent`}
      >
        <div
          className="h-full rounded-full bg-brand transition-all"
          style={{ width: `${anteil}%` }}
        />
      </div>

      <p className="text-sm text-ink-muted">
        {nextLevel === null
          ? 'Höchste Stufe erreicht – es gibt nichts mehr zu holen. Respekt.'
          : `Noch ${fehlend} ${fehlend === 1 ? 'Abzeichen' : 'Abzeichen'} bis „${nextLevel.label}".`}
      </p>
    </Panel>
  );
}
