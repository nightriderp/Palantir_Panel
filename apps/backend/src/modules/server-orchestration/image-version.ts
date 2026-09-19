/**
 * Die Fassung aus einer Image-Adresse lesen.
 *
 * Eigene Datei, weil zwei Stellen sie brauchen, die sich sonst gegenseitig
 * importieren muessten: die Server-DTOs und die Spiele-Registry.
 */

/**
 * Marke hinter dem Doppelpunkt, z. B. `9` aus
 * `ghcr.io/…/palantir-game-minecraft:9`.
 *
 * `null`, wenn die Adresse keine Marke traegt. Der Doppelpunkt darf nicht der
 * aus `registry:5000/…` sein - deshalb zaehlt nur ein Doppelpunkt hinter dem
 * letzten Schraegstrich.
 */
export function imageVersionLabel(imageRef: string | null): string | null {
  if (imageRef === null) {
    return null;
  }

  const letzterSchraegstrich = imageRef.lastIndexOf('/');
  const doppelpunkt = imageRef.indexOf(':', letzterSchraegstrich + 1);

  if (doppelpunkt === -1) {
    return null;
  }

  const marke = imageRef.slice(doppelpunkt + 1).trim();

  return marke === '' ? null : marke;
}
