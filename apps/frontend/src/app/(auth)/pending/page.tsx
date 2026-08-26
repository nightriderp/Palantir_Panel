import type { Metadata } from 'next';

import { PendingView } from '../_components/PendingView';

export const metadata: Metadata = {
  title: 'Warten auf Freischaltung · Palantir',
  description: 'Dein Konto wartet auf die Freischaltung durch einen Administrator.',
};

/** Gast-Wartebildschirm (Arbeitspaket F1, Lastenheft §3.1). */
export default function PendingPage() {
  return <PendingView />;
}
