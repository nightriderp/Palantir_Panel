import { NextResponse } from 'next/server';
import { releaseFromEnvironment } from '@/lib/version';

/**
 * Welche Version des Panels gerade ausgeliefert wird (`GET /fassung`).
 *
 * **Der Pfad heisst weiter `/fassung`**, obwohl das Wort sonst überall
 * „Version“ heißt (Betreiber-Wunsch 20.09.2026). Genau diese Route fragt ein
 * Browser-Tab ab, der die Seite VOR dem Ausrollen geladen hat – also der Tab,
 * dem der Hinweis gilt. Würde der Pfad mitumbenannt, bekäme er nach dem
 * nächsten Ausrollen 404 und meldete nie, dass er veraltet ist. Die Adresse
 * sieht ohnehin niemand; sie steht in keinem Menü und in keinem Link.
 *
 * Für den Hinweis „neue Version verfügbar" (`DeployBanner`): Der Browser hält
 * die Version fest, mit der seine Seite geladen wurde, und fragt hier von Zeit
 * zu Zeit nach, was der Server inzwischen ausliefert. Weichen beide ab, läuft
 * im Browser altes Frontend gegen eine neue API – genau der Zustand, der nach
 * einem Deployment zu Fehlern führt, die sich mit einem Neuladen in Luft
 * auflösen.
 *
 * **Bewusst im Frontend und nicht im Backend.** Die Version steht als
 * `PALANTIR_RELEASE` ohnehin nur im Web-Container (`deploy/vps/docker-compose.yml`),
 * und gefragt ist genau dessen Stand: Der Browser will wissen, ob *seine*
 * Seite veraltet ist. Ein Feld an `/health` hätte dafür die Variable zusätzlich
 * an das Backend gereicht und einen Vertrag erweitert, ohne etwas besser zu
 * beantworten.
 *
 * `dynamic = 'force-dynamic'`: Ohne diese Angabe backt Next die Antwort beim
 * Bauen fest ein – die Version entsteht aber erst beim Ausrollen (siehe
 * `lib/version.ts`), und die Route lieferte dann für immer „Entwicklung".
 */
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json(
    { release: releaseFromEnvironment() },
    // Kein Zwischenspeicher: Die Antwort ist genau dann interessant, wenn sie
    // sich gerade geändert hat.
    { headers: { 'cache-control': 'no-store' } },
  );
}
