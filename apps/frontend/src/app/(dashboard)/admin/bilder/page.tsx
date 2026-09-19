import { redirect } from 'next/navigation';

/**
 * Spiel-Bilder – gibt es, aber unter „Templates" (Fundpunkt 308).
 *
 * Diese Seite trug bis v1.63.0 einen Platzhalter mit dem Versprechen, hier
 * lasse sich „später" je Spiel ein Titel- und ein Kachelbild hinterlegen.
 * Genau das ist seit v1.62.0 gebaut – nur an anderer Stelle: `GameImagePicker`
 * sitzt in `TemplatesView`, wo auch der Rest einer Vorlage bearbeitet wird.
 * Zwei Navigationseinträge für dieselbe Sache, einer davon mit einem Text, der
 * der laufenden Anwendung widerspricht.
 *
 * Der Eintrag ist deshalb aus der Navigation entfernt. Die Adresse bleibt und
 * leitet weiter, damit ein Lesezeichen oder ein alter Link nicht ins Leere
 * läuft.
 */
export default function AdminBilderPage() {
  redirect('/admin/templates');
}
