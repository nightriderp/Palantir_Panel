'use client';

import {
  ACHIEVEMENT_CATEGORIES,
  ACHIEVEMENT_CATEGORY_LABELS,
  type AchievementCategory,
  type AchievementId,
  type AchievementOverviewDto,
} from '@palantir/contracts';
import { useState } from 'react';
import { Button, EmptyState, Icon, PageHeader, Panel, useToast } from '@/components/shared';
import { chooseAchievementTitle, fetchAchievements } from '@/lib/achievements/api';
import { errorText } from '@/lib/api/client';
import { useApiResource } from '@/lib/api/useApiResource';
import { AchievementCard } from './AchievementCard';
import { LevelPanel } from './LevelPanel';
import { TitlePicker } from './TitlePicker';

/**
 * Erfolge – Abzeichen, Stufe und Titel (Betreiber-Wunsch 21.09.2026).
 *
 * Zeigt ausschließlich das **eigene** Konto; es gibt keine Route auf fremde
 * Abzeichen. Was andere sehen, ist der Titel – und der steht dort, wo ohnehin
 * ein Anzeigename steht (Bestenliste der Spielhalle).
 *
 * Die Übersicht wird einmal geladen und nach einem Titelwechsel aus der
 * Antwort ersetzt, nicht neu geholt: Die Route liefert den vollständigen
 * neuen Stand zurück.
 */

/** Abzeichen einer Rubrik, in Katalogreihenfolge. */
function rubrik(overview: AchievementOverviewDto, category: AchievementCategory) {
  return overview.entries.filter((entry) => entry.category === category);
}

export function AchievementsView() {
  const { data, loading, error, reload, setData } = useApiResource(
    (signal) => fetchAchievements(signal),
    [],
  );
  const toast = useToast();
  const [wechselt, setWechselt] = useState(false);

  async function titelWaehlen(achievementId: AchievementId | null): Promise<void> {
    setWechselt(true);

    const ergebnis = await chooseAchievementTitle(achievementId);

    setWechselt(false);

    if (!ergebnis.success) {
      toast.error(errorText(ergebnis));

      return;
    }

    setData(ergebnis.data);
    toast.success(
      ergebnis.data.selectedTitle === null
        ? 'Titel abgelegt.'
        : `Du trägst jetzt den Titel „${ergebnis.data.selectedTitle.title}".`,
    );
  }

  return (
    <>
      <PageHeader
        title="Erfolge"
        subtitle="Abzeichen für das, was du im Panel ohnehin tust – plus Titel zum Anzeigen."
      />

      <div className="flex flex-col gap-5 p-5">
        {error !== null ? (
          <EmptyState
            icon="warning"
            title="Erfolge nicht ladbar"
            description={error}
            action={
              <Button variant="secondary" onClick={reload}>
                Erneut versuchen
              </Button>
            }
          />
        ) : data === null ? (
          <p className="text-base text-ink-muted">
            {loading ? 'Abzeichen werden geladen …' : 'Keine Daten.'}
          </p>
        ) : (
          <>
            <LevelPanel overview={data} />
            <TitlePicker overview={data} busy={wechselt} onChoose={(id) => void titelWaehlen(id)} />

            <Panel variant="outline" className="flex items-start gap-3">
              <Icon name="medal" size={18} className="mt-0.5 shrink-0 text-brand" />
              <div>
                <div className="text-md font-semibold text-ink">Wie das hier funktioniert</div>
                <p className="mt-1 text-base text-ink-muted">
                  Abzeichen schalten sich von selbst frei, wenn du das Panel benutzt – du musst
                  nichts abhaken und nichts sammeln. Jedes gibt es genau einmal; zweimal dasselbe zu
                  tun bringt nichts. Ein paar sind geheim und verraten sich erst, wenn du sie hast.
                </p>
              </div>
            </Panel>

            {ACHIEVEMENT_CATEGORIES.map((category) => {
              const eintraege = rubrik(data, category);

              if (eintraege.length === 0) return null;

              return (
                <section key={category} className="flex flex-col gap-3">
                  <h2 className="text-md font-semibold text-ink">
                    {ACHIEVEMENT_CATEGORY_LABELS[category]}
                  </h2>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {eintraege.map((entry) => (
                      <AchievementCard key={entry.id} entry={entry} />
                    ))}
                  </div>
                </section>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}
