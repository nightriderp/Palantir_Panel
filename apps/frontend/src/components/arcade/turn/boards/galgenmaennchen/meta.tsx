'use client';

import { cn } from '@/components/shared';
import { type TurnBoardDefinition } from '../../types';

/**
 * Kategorien der Wortliste. Das Regelpaket exportiert nur das Spiel, deshalb
 * stehen Kennung und Name hier noch einmal – `parseOptions` weist unbekannte
 * Kennungen ab, ein Tippfehler fiele also sofort auf.
 */
const KATEGORIEN = [
  { id: 'alle', name: 'Bunt gemischt' },
  { id: 'tiere', name: 'Tiere' },
  { id: 'essen', name: 'Essen und Trinken' },
  { id: 'haushalt', name: 'Dinge im Haus' },
  { id: 'natur', name: 'Natur und Wetter' },
  { id: 'freizeit', name: 'Sport und Freizeit' },
  { id: 'berufe', name: 'Berufe und Orte' },
] as const;

function OptionsForm({
  value,
  onChange,
  seatCount,
}: {
  value: { kategorie?: string };
  onChange(value: { kategorie: string }): void;
  seatCount: number;
}) {
  if (seatCount > 1) {
    return (
      <p className="text-sm text-ink-muted">
        Zu mehreren denkt sich jede Person reihum ein eigenes Wort aus – eine Kategorie gibt es dann
        nicht.
      </p>
    );
  }
  const current = value.kategorie ?? 'alle';
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm text-ink-muted">Kategorie</legend>
      <div className="grid grid-cols-2 gap-2">
        {KATEGORIEN.map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => onChange({ kategorie: k.id })}
            className={cn(
              'min-h-[44px] rounded-tile border px-3 text-md transition-colors',
              current === k.id
                ? 'border-brand bg-brand-soft text-ink'
                : 'border-line-strong bg-fill text-ink-muted hover:text-ink',
            )}
          >
            {k.name}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export const meta: Pick<TurnBoardDefinition, 'rulesText' | 'OptionsForm'> = {
  rulesText: [
    '• Errate das Wort Buchstabe für Buchstabe, bevor das Männchen nach zehn Fehlern fertig gezeichnet ist.',
    '• Allein: Das Wort kommt aus der Wortliste, der Hinweis ist die Kategorie.',
    '• Zu mehreren: Reihum denkt sich eine Person ein Wort aus (3–24 Buchstaben, Umlaute erlaubt), alle anderen raten nacheinander.',
    '• Punkte: je richtiger Buchstabe so viele, wie er im Wort vorkommt. Wer das Wort vollständig macht, bekommt 3 extra; wer es früher komplett errät, zusätzlich 1 je noch verdeckten Buchstaben.',
    '• Ein falsches Lösungswort zählt als Fehler. Bleibt das Wort ungelöst, bekommt die Wortgeberin 10 Punkte.',
    '• Nach so vielen Runden, wie Personen mitspielen, gewinnt die höchste Punktzahl.',
  ].join('\n'),
  OptionsForm,
};
