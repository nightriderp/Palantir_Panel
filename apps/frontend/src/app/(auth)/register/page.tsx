import type { Metadata } from 'next';

import { RegisterView } from '../_components/RegisterView';

export const metadata: Metadata = {
  title: 'Konto erstellen · Palantir',
  description:
    'Registriere dich – neue Konten starten als Gast, bis ein Administrator freischaltet.',
};

/** Registrierungsseite inklusive ALTCHA-Widget (Arbeitspaket F1). */
export default function RegisterPage() {
  return <RegisterView />;
}
