'use client';

import { type ArcadeGameDefinition } from '@palantir/contracts';
import { Icon } from '@/components/shared';

/**
 * Kachel eines Minispiels auf der Arcade-Auswahlseite (Arbeitspaket F8).
 *
 * Zeigt den eigenständigen Namen, den Untertitel und eine kurze Beschreibung
 * (alles aus dem Contract-Katalog). Kein Original-Titel und keine
 * Original-Grafik – die Kachel trägt nur ein schlichtes Symbol (Lastenheft §3.9).
 */

export interface GameCardProps {
  game: ArcadeGameDefinition;
  onSelect(): void;
}

export function GameCard({ game, onSelect }: GameCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex flex-col gap-3 rounded-2xl border border-line-strong bg-card-gradient p-4 text-left transition hover:border-brand-line hover:shadow-panel focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <div className="flex items-center justify-between">
        <span className="flex h-11 w-11 items-center justify-center rounded-tile bg-brand-soft text-brand-bright">
          <Icon name="gamepad" size={22} />
        </span>
        <span className="font-mono text-sm text-ink-faint transition group-hover:text-brand-bright">
          Spielen →
        </span>
      </div>
      <div>
        <h3 className="text-md font-semibold text-ink">{game.name}</h3>
        <p className="mt-0.5 text-sm text-ink-soft">{game.tagline}</p>
      </div>
      <p className="text-sm leading-relaxed text-ink-muted">{game.description}</p>
    </button>
  );
}
