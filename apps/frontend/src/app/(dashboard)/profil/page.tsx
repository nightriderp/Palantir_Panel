import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { ProfileView } from '@/components/account/ProfileView';
import { THEME_COOKIE } from '@/lib/theme/cookie';
import { themeFuerId } from '@/lib/theme/palette';

export const metadata = {
  title: 'Profil · Palantir',
};

/**
 * Profil und verknüpfte Anmeldeverfahren (Lastenheft §3.1).
 *
 * `ProfileView` liest die Rückkehr-Query (`?linked=…`) über `useSearchParams`;
 * das verlangt in Next.js eine Suspense-Grenze, damit die Seite gebaut werden
 * kann.
 *
 * Das gewählte Erscheinungsbild wird **hier** gelesen und hineingereicht: Es
 * steht im Cookie, und an das kommt nur der Server. Die Auswahl selbst ist
 * eine Client-Komponente – sie könnte es allenfalls nach der Hydrierung aus
 * dem Dokument holen und hätte bis dahin die falsche Kachel markiert.
 */
export default async function ProfilePage() {
  const thema = themeFuerId((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <Suspense>
      <ProfileView aktivesTheme={thema.id} />
    </Suspense>
  );
}
