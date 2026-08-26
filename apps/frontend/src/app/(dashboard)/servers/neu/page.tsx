import { CreateServerWizard } from '@/components/servers/CreateServerWizard';

export const metadata = {
  title: 'Neuer Server · Palantir',
};

/** „Server erstellen"-Wizard (Arbeitspaket F3, Lastenheft §3.3). */
export default function NewServerPage() {
  return <CreateServerWizard />;
}
