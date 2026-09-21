import { Avatar, type AvatarSize } from './Avatar';
import { cn } from '../utils/cn';

/**
 * Ein Konto, wie es überall im Panel erscheint: Bild, Name, Titel
 * (Betreiber-Wunsch 21.09.2026).
 *
 * Die drei gehören zusammen und sollen überall gleich aussehen – im Chat, an
 * der Server-Kachel, in der Bestenliste. Ohne einen gemeinsamen Baustein
 * entscheidet jede Ansicht für sich, wie groß das Bild ist und ob der Titel
 * vor oder hinter den Namen rutscht; nach drei Ansichten sieht dieselbe Person
 * an drei Stellen verschieden aus.
 *
 * **Der Titel steht gedämpft hinter dem Namen.** Er schmückt ihn, er ersetzt
 * ihn nicht: Wer eine Liste überfliegt, sucht den Namen. Reicht der Platz
 * nicht, wird der Titel abgeschnitten und nicht der Name – deshalb liegt das
 * `truncate` auf dem Namen und der Titel steht in einem Element, das schrumpfen
 * darf.
 */

export interface UserLabelProps {
  /** Fertige Bild-Adresse aus `avatarUrl()`; `null`, wenn es keins gibt. */
  avatarSrc: string | null;
  displayName: string;
  /** Getragener Titel; `null`, wenn keiner gewählt ist. */
  title?: string | null;
  size?: AvatarSize;
  /** Zusatz hinter dem Titel, z. B. „· du" in der Bestenliste. */
  suffix?: string | null;
  /** Ohne Bild – für Zeilen, die ihr eigenes daneben zeichnen. */
  hideAvatar?: boolean;
  className?: string;
}

export function UserLabel({
  avatarSrc,
  displayName,
  title = null,
  size = 'sm',
  suffix = null,
  hideAvatar = false,
  className,
}: UserLabelProps) {
  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      {hideAvatar ? null : <Avatar src={avatarSrc} displayName={displayName} size={size} />}
      <span className="min-w-0 truncate text-ink">
        {displayName}
        {title === null ? null : (
          <span className="ml-1.5 text-sm font-normal text-ink-faint">{title}</span>
        )}
        {suffix === null ? null : <span className="ml-1 text-sm text-brand-bright">{suffix}</span>}
      </span>
    </span>
  );
}
