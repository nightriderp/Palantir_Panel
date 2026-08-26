import { afterEach } from 'vitest';

/**
 * Vorbereitung für jeden Testlauf des Frontends.
 *
 * Nach jedem Komponententest wird der gerenderte Baum abgeräumt, sonst sammeln
 * sich mehrere Fassungen derselben Komponente im Dokument und `getByRole`
 * findet plötzlich zwei Treffer.
 *
 * Die Datei gilt für **alle** Tests, auch die reinen Logiktests in der
 * Node-Umgebung. Dort gibt es kein `document`; deshalb die Abfrage und der
 * nachgeladene Import – ein Import auf oberster Ebene würde Testing Library
 * auch in Läufe ziehen, die gar kein DOM haben.
 */
afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});
