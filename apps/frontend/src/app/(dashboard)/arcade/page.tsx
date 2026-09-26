import { Suspense } from 'react';
import { ArcadeView } from '@/components/arcade/ArcadeView';

export const metadata = {
  title: 'Spielhalle · Palantir',
};

/**
 * Spielhalle (Lastenheft §3.9, Pflichtenheft §17).
 *
 * `Suspense` ist Pflicht: `ArcadeView` liest über `useSearchParams`, welches
 * Spiel bzw. welcher Raum offen ist (`?spiel=…`, `?raum=…`). Ohne Grenze
 * müsste Next.js die ganze Seite bis zur Wurzel im Browser rendern.
 */
export default function ArcadePage() {
  return (
    <Suspense fallback={<p className="p-5 text-base text-ink-muted">Spielhalle wird geladen …</p>}>
      <ArcadeView />
    </Suspense>
  );
}
