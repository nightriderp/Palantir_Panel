/**
 * Angezeigte Anwendungsversion.
 *
 * Gespeist aus dem `version`-Feld der Frontend-`package.json`, das
 * `next.config.mjs` zur Bauzeit als `NEXT_PUBLIC_APP_VERSION` einsetzt. Ein
 * Release erhöht dort die Version und setzt den passenden Git-Tag `v<version>`;
 * die angezeigte Version entspricht damit immer dem gebauten Stand.
 *
 * Der Rückfallwert greift nur, wenn ganz ohne den Next-Build gerendert wird
 * (z. B. ein isolierter Unit-Test) – im ausgelieferten Bundle steht die echte
 * Version.
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0';

/** Version mit vorangestelltem `v`, wie sie in der Oberfläche erscheint. */
export const APP_VERSION_LABEL = `v${APP_VERSION}`;
