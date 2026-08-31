/**
 * Angezeigte Anwendungsversion – die Version des Deployments.
 *
 * **Kommt aus dem Git-Tag, nicht aus einer gepflegten Datei.** Ein Deployment
 * läuft ausschließlich über ein Versions-Tag `v*`; auf der VPS löst
 * `deploy/vps/deploy.sh` das Tag zum ausgerollten Commit auf und reicht es als
 * `PALANTIR_RELEASE` an den Container. Niemand trägt eine Versionsnummer von
 * Hand nach – die Anzeige kann deshalb nicht von dem abweichen, was läuft.
 *
 * Der Wert wird **zur Laufzeit** gelesen: Die Images entstehen beim Merge nach
 * `main`, das Tag entsteht erst beim Freigeben. Zur Bauzeit ist es also noch
 * gar nicht bekannt. Deshalb liest ihn die Server-Seite aus der Umgebung
 * (`app/(dashboard)/layout.tsx`) und reicht ihn in den Rahmen hinein, statt ihn
 * über `NEXT_PUBLIC_` ins Bundle zu backen.
 *
 * Ohne gesetzte Umgebungsvariable – also in der Entwicklung und in Tests –
 * steht dort {@link DEV_VERSION_LABEL}. Ein ausgerollter Stand ohne Tag kann
 * nicht entstehen; sollte `deploy.sh` doch einmal keines finden, trägt es die
 * kurze Commit-SHA ein, und genau die steht dann hier.
 */

/** Beschriftung, wenn keine Deployment-Version gesetzt ist. */
export const DEV_VERSION_LABEL = 'Entwicklung';

/**
 * Beschriftung für die Fußzeile der Seitenleiste.
 *
 * Ein Wert der Form `1.2.3` bekommt ein `v` vorangestellt; ein bereits mit `v`
 * beginnendes Tag bleibt, wie es ist – doppelte `v` wären Unsinn. Alles andere
 * (etwa eine kurze Commit-SHA) wird unverändert übernommen.
 */
export function versionLabel(release: string | undefined): string {
  const wert = release?.trim() ?? '';

  if (wert.length === 0) {
    return DEV_VERSION_LABEL;
  }

  return /^\d+\.\d+\.\d+/.test(wert) ? `v${wert}` : wert;
}

/**
 * Version des laufenden Deployments aus der Umgebung.
 *
 * Nur auf der Server-Seite aufrufen – im Browser ist `process.env` leer, und
 * genau deshalb wird der Wert von dort als Eigenschaft weitergereicht.
 */
export function releaseFromEnvironment(): string {
  return versionLabel(process.env.PALANTIR_RELEASE);
}
