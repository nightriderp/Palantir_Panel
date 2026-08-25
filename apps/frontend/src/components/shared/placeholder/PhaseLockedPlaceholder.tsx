import { type ReactNode } from 'react';
import { Icon, type IconName } from '../icons/Icon';
import { cn } from '../utils/cn';

/** Phase aus dem Phasenplan (Lastenheft §7). */
export type ProjectPhase = 2 | 3;

const PHASE_TEXT: Record<ProjectPhase, string> = {
  2: 'Phase 2 – erstes vollständig unterstütztes Spiel',
  3: 'Phase 3 – Erweiterung um weitere Spiele',
};

export interface PhaseLockedPlaceholderProps {
  /** Worum es geht, z. B. „Skins" oder „Arcade-Musik". */
  title: string;
  /**
   * Was hier später zu sehen sein wird – ein bis zwei Sätze, damit der Bereich
   * nicht wie ein Fehler wirkt.
   */
  description: string;
  /** Phase, in der der Inhalt fachlich entsteht (Lastenheft §7). */
  phase: ProjectPhase;
  icon?: IconName;
  /** Zusätzliche Hinweise, z. B. eine Liste geplanter Funktionen. */
  children?: ReactNode;
  className?: string;
}

/**
 * Einheitlicher „Kommt später"-Zustand für Inhalte, die es fachlich erst in
 * Phase 2/3 gibt (Skins, Templates, Bilder, Sticker, Arcade-Musik).
 *
 * Wird von F9 (Skins) und F11 (Admin-Spiele-Verwaltung) genutzt – STRUKTUR.md
 * sieht dafür ausdrücklich **eine** gemeinsame Komponente vor, damit alle
 * Platzhalter gleich aussehen und später gleichzeitig verschwinden können.
 *
 * Absichtlich ohne Aktionen: hier gibt es nichts zu bedienen, und ein
 * angedeuteter Knopf würde eine Funktion versprechen, die noch nicht existiert.
 */
export function PhaseLockedPlaceholder({
  title,
  description,
  phase,
  icon = 'lock',
  children,
  className,
}: PhaseLockedPlaceholderProps) {
  return (
    <section
      className={cn(
        'rounded-2xl border border-dashed border-line-strong bg-fill px-5 py-12 text-center sm:py-16',
        className,
      )}
    >
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-tile bg-brand-soft text-brand">
        <Icon name={icon} size={22} />
      </span>

      <h2 className="mt-4 text-2xl font-bold">{title}</h2>
      <p className="mx-auto mt-2 max-w-lg text-base text-ink-muted">{description}</p>

      <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-3 py-1 text-xs font-semibold text-warning">
        <Icon name="clock" size={12} />
        Kommt später · {PHASE_TEXT[phase]}
      </p>

      {children ? (
        <div className="mx-auto mt-5.5 max-w-lg text-left text-sm text-ink-soft">{children}</div>
      ) : null}
    </section>
  );
}
