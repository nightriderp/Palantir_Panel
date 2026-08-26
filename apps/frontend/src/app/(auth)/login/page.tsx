import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoginView } from '../_components/LoginView';

export const metadata: Metadata = {
  title: 'Anmelden · Palantir',
  description: 'Melde dich an, um deine Gameserver zu verwalten.',
};

/**
 * Login-Seite (Arbeitspaket F1).
 *
 * `Suspense` ist Pflicht, weil `LoginView` über `useSearchParams` den
 * Fehlercode eines gescheiterten Provider-Rücklaufs liest; ohne Grenze könnte
 * Next.js die Seite nicht statisch vorrendern.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<p className="text-base text-ink-muted">Wird geladen …</p>}>
      <LoginView />
    </Suspense>
  );
}
