import { type AchievementDto } from '@palantir/contracts';
import { Badge, Icon, Panel, formatDate } from '@/components/shared';

/**
 * Eine Abzeichen-Kachel (Betreiber-Wunsch 21.09.2026).
 *
 * Drei Zustände, jeder mit eigener Anmutung:
 *  - **freigeschaltet** – volle Fläche, Medaille in Markenfarbe, Datum
 *  - **verschlossen** – nur Kontur, gedämpft, Hinweis statt Beschreibung
 *  - **verschlossenes Geheimnis** – dasselbe, aber ohne Namen und ohne Hinweis
 *
 * Was ein geheimes Abzeichen ist, entscheidet das Backend: Es liefert Namen
 * und Beschreibung erst mit, wenn es freigeschaltet ist. Diese Kachel könnte
 * also gar nichts verraten, selbst wenn sie wollte – der Katalog steht zwar
 * auch im Browser, die Zuordnung zum eigenen Konto aber nicht.
 */

export interface AchievementCardProps {
  entry: AchievementDto;
}

export function AchievementCard({ entry }: AchievementCardProps) {
  const frei = entry.unlockedAt !== null;

  return (
    <Panel
      variant={frei ? 'raised' : 'outline'}
      padding="sm"
      className={frei ? '' : 'border-dashed'}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
            frei ? 'bg-brand-soft text-brand' : 'bg-fill text-ink-faint'
          }`}
        >
          <Icon name={entry.secret ? 'lock' : 'medal'} size={18} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-base font-semibold ${frei ? 'text-ink' : 'text-ink-muted'}`}>
              {entry.secret ? 'Geheimes Abzeichen' : entry.name}
            </span>
            {entry.title === null ? null : (
              <Badge
                tone={frei ? 'brand' : 'neutral'}
                title="Dieses Abzeichen bringt einen Titel mit"
              >
                Titel
              </Badge>
            )}
          </div>

          <p className="mt-1 text-sm text-ink-muted">
            {entry.secret ? 'Das findest du selbst heraus.' : entry.description}
          </p>

          {entry.unlockedAt === null ? null : (
            <p className="mt-1.5 text-xs text-ink-faint">
              Freigeschaltet am {formatDate(entry.unlockedAt)}
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}
