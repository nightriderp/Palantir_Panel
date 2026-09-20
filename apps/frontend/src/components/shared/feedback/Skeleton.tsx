import { cn } from '../utils/cn';

export interface SkeletonProps {
  className?: string;
}

/**
 * Platzhalterfläche für Inhalt, der noch unterwegs ist.
 *
 * Bewusst nur eine getönte Fläche mit ruhigem Puls und **keine** Nachbildung
 * der späteren Seite: Ein Gerüst, das dem Ergebnis nicht entspricht, verschiebt
 * beim Eintreffen der Daten alles noch einmal – dann wäre der Platzhalter
 * schlimmer als eine leere Fläche.
 *
 * `aria-hidden`, weil der Ladezustand über `aria-busy` am umgebenden Bereich
 * angesagt wird; die einzelnen Balken haben keine eigene Aussage.
 */
export function Skeleton({ className }: SkeletonProps) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-fill-strong', className)} />;
}

/**
 * Ladebild einer ganzen Seite: Kopfzeile, zwei Kartenreihen.
 *
 * Steht in jedem `loading.tsx` des eingeloggten Bereichs. Die Form ist
 * absichtlich neutral – jede Ansicht hat eine Überschrift und darunter
 * Karten, und mehr soll der Platzhalter nicht behaupten.
 */
export function PageSkeleton() {
  return (
    <div className="flex animate-fade-up flex-col gap-4" aria-busy>
      <span className="sr-only" role="status">
        Inhalt wird geladen …
      </span>

      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-3.5 w-72 max-w-full" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-44 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
