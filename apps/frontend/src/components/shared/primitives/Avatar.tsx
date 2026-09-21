import { Icon } from '../icons/Icon';
import { cn } from '../utils/cn';

/**
 * Profilbild eines Kontos (Betreiber-Wunsch 21.09.2026).
 *
 * Bis hierher zeichnete jede Stelle ihr eigenes: das Kontomenü, die
 * Profilseite, die Freischalt-Warteliste – dreimal derselbe Kreis mit leicht
 * verschiedenen Größen und Rückfallbildern. Wer ein Bild hochlud, sah es
 * trotzdem nur an diesen drei Stellen und nirgends dort, wo man sich
 * tatsächlich begegnet: im Chat, an den Server-Kacheln, in der Bestenliste.
 *
 * Dieser Baustein ist die eine Stelle dafür. Er bekommt die fertige Adresse
 * (`avatarUrl()` aus `lib/auth/api`) und **nicht** Konto-Id plus Zeitstempel:
 * Wie eine Bild-Adresse entsteht, gehört in die API-Schicht, nicht in ein
 * Darstellungs-Element.
 *
 * **Rückfall ist der Anfangsbuchstabe, nicht das Sinnbild.** In einer Liste
 * mit zehn Zeilen sind zehn identische graue Köpfe keine Unterscheidung. Ein
 * Buchstabe ist einer – und wo gar kein Name da ist (gelöschtes Konto), bleibt
 * das Sinnbild.
 */

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';

const SIZE_CLASSES: Record<AvatarSize, string> = {
  xs: 'h-6 w-6 text-[0.625rem]',
  sm: 'h-7 w-7 text-xs',
  md: 'h-9 w-9 text-sm',
  lg: 'h-12 w-12 text-base',
};

const ICON_SIZES: Record<AvatarSize, number> = { xs: 12, sm: 14, md: 16, lg: 20 };

export interface AvatarProps {
  /** Fertige Bild-Adresse aus `avatarUrl()`; `null`, wenn es keins gibt. */
  src: string | null;
  /** Anzeigename – liefert den Rückfall-Buchstaben und die Vorlesehilfe. */
  displayName: string | null;
  size?: AvatarSize;
  className?: string;
}

/** Erster darstellbarer Buchstabe eines Namens; `null`, wenn es keinen gibt. */
function anfangsbuchstabe(displayName: string | null): string | null {
  const getrimmt = displayName?.trim() ?? '';

  // `[...]` statt `charAt`: Ein Name, der mit einem Emoji beginnt, soll nicht
  // als halbes Ersatzzeichen im Kreis stehen.
  const erstes = [...getrimmt][0];

  return erstes === undefined ? null : erstes.toLocaleUpperCase('de-DE');
}

export function Avatar({ src, displayName, size = 'sm', className }: AvatarProps) {
  const buchstabe = anfangsbuchstabe(displayName);

  return (
    <span
      className={cn(
        'flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-fill-strong font-semibold text-ink-muted',
        SIZE_CLASSES[size],
        className,
      )}
      /*
       * Das Bild ist Beiwerk zum Namen, der immer danebensteht – deshalb
       * `aria-hidden` und kein Alternativtext: Eine Vorlesehilfe soll den
       * Namen einmal hören, nicht zweimal.
       */
      aria-hidden
    >
      {src === null ? (
        buchstabe === null ? (
          <Icon name="user" size={ICON_SIZES[size]} />
        ) : (
          buchstabe
        )
      ) : (
        /* Adresse der API, zur Bauzeit unbekannt – `next/image` bräuchte dafür
           eine konfigurierte Domain. */
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      )}
    </span>
  );
}
