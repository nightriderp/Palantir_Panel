import { Suspense } from 'react';
import { MessagesView } from '@/components/messages/MessagesView';

export const metadata = {
  title: 'Nachrichten · Palantir',
};

/**
 * Nachrichten/Chat (Arbeitspaket F5, Lastenheft §3.6).
 *
 * Die zu öffnende Unterhaltung darf als `?c=` in der Adresszeile stehen – so
 * springt der Knopf „Nachricht" auf der Karte eines fremden Servers direkt in
 * den richtigen Verlauf. `useSearchParams()` verlangt deshalb eine
 * `Suspense`-Grenze, wie schon bei der Server-Detailansicht.
 */
export default function MessagesPage() {
  return (
    <Suspense fallback={<p className="text-base text-ink-muted">Nachrichten werden geladen …</p>}>
      <MessagesView />
    </Suspense>
  );
}
