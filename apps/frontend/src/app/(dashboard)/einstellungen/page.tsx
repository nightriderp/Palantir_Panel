import { permanentRedirect } from 'next/navigation';

/**
 * Alte Adresse der Konto-Einstellungen.
 *
 * Passwort und Zwei-Faktor stehen seit der Zusammenlegung auf dem Profil
 * (Abgleich 11.1). Die Route bleibt bestehen, damit gespeicherte Links und
 * Lesezeichen nicht ins Leere laufen; sie leitet dauerhaft auf den Abschnitt
 * „Passwort" des Profils.
 */
export default function SettingsPage() {
  permanentRedirect('/profil#passwort');
}
