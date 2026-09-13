import { NextResponse } from 'next/server';
import { releaseFromEnvironment } from '@/lib/version';

/**
 * Welche Fassung des Panels gerade ausgeliefert wird (`GET /fassung`).
 *
 * Für den Hinweis „neue Fassung verfügbar" (`DeployBanner`): Der Browser hält
 * die Fassung fest, mit der seine Seite geladen wurde, und fragt hier von Zeit
 * zu Zeit nach, was der Server inzwischen ausliefert. Weichen beide ab, läuft
 * im Browser altes Frontend gegen eine neue API – genau der Zustand, der nach
 * einem Deployment zu Fehlern führt, die sich mit einem Neuladen in Luft
 * auflösen.
 *
 * **Bewusst im Frontend und nicht im Backend.** Die Fassung steht als
 * `PALANTIR_RELEASE` ohnehin nur im Web-Container (`deploy/vps/docker-compose.yml`),
 * und gefragt ist genau dessen Stand: Der Browser will wissen, ob *seine*
 * Seite veraltet ist. Ein Feld an `/health` hätte dafür die Variable zusätzlich
 * an das Backend gereicht und einen Vertrag erweitert, ohne etwas besser zu
 * beantworten.
 *
 * `dynamic = 'force-dynamic'`: Ohne diese Angabe backt Next die Antwort beim
 * Bauen fest ein – die Fassung entsteht aber erst beim Ausrollen (siehe
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
