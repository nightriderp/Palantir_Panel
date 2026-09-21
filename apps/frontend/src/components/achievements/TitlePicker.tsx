'use client';

import { type AchievementId, type AchievementOverviewDto } from '@palantir/contracts';
import { Icon, Panel } from '@/components/shared';

/**
 * Auswahl des getragenen Titels (Betreiber-Wunsch 21.09.2026).
 *
 * Die Liste kommt vollständig vom Backend (`availableTitles`) – hier wird
 * nichts aus dem Katalog nachgeschlagen und nichts gefiltert. Ein Titel, den
 * das Konto nicht hat, erscheint deshalb gar nicht erst; und käme der Aufruf
 * doch zustande, lehnte ihn die Route ab (`ACHIEVEMENT_NOT_UNLOCKED`).
 *
 * „Keinen Titel" steht als erste Wahl und ist damit genauso leicht erreichbar
 * wie jeder andere Eintrag: Einen Titel abzulegen soll kein Suchspiel sein.
 */

export interface TitlePickerProps {
  overview: AchievementOverviewDto;
  /** Läuft gerade ein Wechsel? Sperrt die Auswahl, statt sie zu verstecken. */
  busy: boolean;
  onChoose(achievementId: AchievementId | null): void;
}

export function TitlePicker({ overview, busy, onChoose }: TitlePickerProps) {
  const gewaehlt = overview.selectedTitle?.achievementId ?? null;

  return (
    <Panel variant="outline" className="flex flex-col gap-3">
      <div>
        <div className="text-md font-semibold text-ink">Titel</div>
        <p className="mt-1 text-sm text-ink-muted">
          {overview.permissions.canChooseTitle
            ? 'Dein Titel steht neben deinem Namen in der Bestenliste der Spielhalle.'
            : 'Manche Abzeichen bringen einen Titel mit. Du hast noch keines davon.'}
        </p>
      </div>

      {overview.permissions.canChooseTitle ? (
        <div className="flex flex-wrap gap-2">
          <TitleChip
            label="Keiner"
            active={gewaehlt === null}
            busy={busy}
            onClick={() => onChoose(null)}
          />
          {overview.availableTitles.map((titel) => (
            <TitleChip
              key={titel.achievementId}
              label={titel.title}
              active={gewaehlt === titel.achievementId}
              busy={busy}
              onClick={() => onChoose(titel.achievementId)}
            />
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

interface TitleChipProps {
  label: string;
  active: boolean;
  busy: boolean;
  onClick(): void;
}

function TitleChip({ label, active, busy, onClick }: TitleChipProps) {
  return (
    <button
      type="button"
      // Der laufende Wechsel sperrt alle Knöpfe, auch den bereits gewählten:
      // Zwei Wechsel gleichzeitig kämen in unbestimmter Reihenfolge an.
      disabled={busy}
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors disabled:opacity-60 ${
        active
          ? 'border-brand-line bg-brand-soft text-brand'
          : 'border-line bg-fill text-ink-muted hover:text-ink'
      }`}
    >
      {active ? <Icon name="check" size={14} /> : null}
      {label}
    </button>
  );
}
