import { Suspense } from 'react';
import { ProfileView } from '@/components/account/ProfileView';

export const metadata = {
  title: 'Profil · Palantir',
};

/**
 * Profil und verknüpfte Anmeldeverfahren (Lastenheft §3.1).
 *
 * `ProfileView` liest die Rückkehr-Query (`?linked=…`) über `useSearchParams`;
 * das verlangt in Next.js eine Suspense-Grenze, damit die Seite gebaut werden
 * kann.
 */
export default function ProfilePage() {
  return (
    <Suspense>
      <ProfileView />
    </Suspense>
  );
}
