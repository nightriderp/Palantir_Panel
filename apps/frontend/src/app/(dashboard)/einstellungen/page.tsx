import { SecuritySettingsView } from '@/components/account/SecuritySettingsView';

export const metadata = {
  title: 'Einstellungen · Palantir',
};

/** Konto-Einstellungen: Passwort und Zwei-Faktor-Authentisierung (Pflichtenheft §7). */
export default function SettingsPage() {
  return <SecuritySettingsView />;
}
