import { afterAll, describe, expect, it } from 'vitest';
import type { RouteOptions } from 'fastify';
import { RBAC_GUARD_RECHTE, istRbacGuard } from './guard.js';

/**
 * Jede Route deklariert ein Recht (Arbeitspaket HM-9).
 *
 * Rechte werden je Route von Hand gesetzt. Ein neuer Endpunkt ohne Guard steht
 * damit jedem Angemeldeten offen, und das faellt erst bei einer Pruefung auf.
 * Die Routen-Rechte-Matrix aus dem Audit
 * (`docs/analyse_10_09_2026/quer/routen-rechte-matrix.md`, Stand 2026-09-10)
 * haelt den Stand fest, ist aber ein Dokument: Sie veraltet still.
 *
 * Dieser Test stellt dieselbe Frage pruefbar. Er baut den echten Server auf,
 * sammelt ueber Fastifys `onRoute` jede registrierte Route ein und verlangt fuer
 * jede entweder einen Guard aus `guard.ts` oder einen Eintrag in {@link OHNE_GUARD}
 * mit einem der Gruende aus {@link GRUENDE}.
 *
 * **Der Test behauptet nicht, dass jede Route einen Guard traegt.** Das waere
 * falsch: Das Backend schuetzt auf vier Arten, und der `preHandler`-Guard ist
 * nur eine davon (siehe {@link GRUENDE}). Was er leistet, ist die Vollstaendigkeit
 * der Aufstellung - eine neue Route ist entweder bewacht oder jemand hat sie
 * bewusst eingeordnet. Beides faellt im Review auf, ein stilles Loch nicht.
 *
 * **Warum hier Umgebungsvariablen gesetzt werden:** Der Server soll mit allen
 * Modulen aufgebaut werden, sonst prueft der Test nur den Teil der Routen, der
 * ohne Datenbank und ohne Auth-Modul entsteht - und gerade die fehlenden waeren
 * die interessanten. Das Auth-Modul verlangt drei Geheimnisse, und in der CI
 * gibt es keine `.env` (Pflichtenheft §12.1). Die Werte unten sind Wegwerfwerte
 * fuer den Aufbau; es wird nichts signiert und nichts geprueft. Die vorherigen
 * Werte stellt `afterAll` zurueck.
 */

/** Die vier Arten, auf die eine Route ohne `preHandler`-Guard geschuetzt ist. */
const GRUENDE = {
  /**
   * Oeffentlich - es braucht kein Konto.
   *
   * Anmeldung, Registrierung und der OAuth-Ruecklauf koennen keine Sitzung
   * verlangen, sie stellen sie ja erst her. Gesundheit, oeffentliche Kennzahlen,
   * Schriften und Profilbilder sind bewusst ohne Konto lesbar.
   */
  oeffentlich: 'oeffentlich, kein Konto noetig',

  /**
   * Sitzung noetig, wirkt ausschliesslich auf das eigene Konto.
   *
   * Ein Recht aus dem Katalog gaebe es hier nicht zu pruefen: Der Handler nimmt
   * die Kennung aus der Sitzung, nicht aus dem Pfad. Wer sein eigenes Passwort
   * aendert, braucht dafuer keine Berechtigung - und koennte mit keiner fremden
   * Kennung etwas anderes treffen.
   */
  eigenesKonto: 'Sitzung noetig, wirkt nur auf das eigene Konto',

  /**
   * Sitzung noetig, kein Recht aus dem Katalog.
   *
   * `requireActor(request)` im Handler statt eines Guards - ausdruecklich auch
   * ohne Freischaltung, denn ein wartendes Konto sieht die Oberflaeche und
   * braucht dafuer die Schriften (`fonts/routes.ts`).
   */
  nurSitzung: 'Sitzung noetig, kein Recht aus dem Katalog',

  /**
   * Recht am Objekt, im Handler geprueft.
   *
   * Server und Unterhaltungen tragen Besitz und Mitgliedschaft. Was jemand darf,
   * haengt am einzelnen Objekt und nicht an einer Rolle - ein Guard koennte das
   * gar nicht entscheiden, er sieht den Pfad und nicht den Datensatz. Geprueft
   * wird beim Laden (`loadAuthorized` in `server-orchestration/routes.ts`, die
   * Mitgliedspruefung in `chat/routes.ts`), und Listen liefern nur, was der
   * Aufrufer sehen darf.
   */
  objektrecht: 'Recht am Objekt, im Handler beim Laden geprueft',

  /**
   * Eigener Kanal mit eigener Anmeldung.
   *
   * Die WebSocket-Endpunkte pruefen beim Verbindungsaufbau selbst und schliessen
   * mit einem eigenen Code (`LIVE_CLOSE_CODE_UNAUTHORIZED` und Geschwister). Der
   * Agent-Kanal haengt nicht an einer Sitzung, sondern am Node-Token.
   */
  eigenerKanal: 'eigener Kanal, Anmeldung beim Verbindungsaufbau',
} as const;

type Grund = (typeof GRUENDE)[keyof typeof GRUENDE];

/**
 * Jede Route ohne `preHandler`-Guard, mit ihrem Grund.
 *
 * Wer hier etwas ergaenzt, nimmt eine Route aus der Guard-Pflicht - deshalb
 * steht der Grund daneben und nicht in einer Commit-Nachricht. Stand beim
 * Anlegen: 159 Routen (ohne die von Fastify erzeugten `HEAD`), davon 76 hier.
 */
const OHNE_GUARD = new Map<string, Grund>([
  // -- oeffentlich ------------------------------------------------------------
  ['GET /health', GRUENDE.oeffentlich],
  ['GET /public/stats', GRUENDE.oeffentlich],
  ['GET /public/fonts.css', GRUENDE.oeffentlich],
  /*
   * Korrigiert: Die Route verlangt eine Sitzung (`requireUserId`), gibt dann
   * aber das Bild jedes Kontos heraus - Profilbilder stehen in Listen, in
   * Nachrichten und auf Serverkarten. Sie ist also nicht oeffentlich, sondern
   * "nur Sitzung"; als oeffentlich gefuehrt laese die Aufstellung sich so, als
   * gaebe das Panel Bilder ohne Anmeldung heraus.
   */
  ['GET /users/:userId/avatar', GRUENDE.nurSitzung],
  ['GET /auth/altcha/challenge', GRUENDE.oeffentlich],
  ['POST /auth/register', GRUENDE.oeffentlich],
  ['POST /auth/login', GRUENDE.oeffentlich],
  ['POST /auth/login/2fa', GRUENDE.oeffentlich],
  ['POST /auth/refresh', GRUENDE.oeffentlich],
  ['POST /auth/logout', GRUENDE.oeffentlich],
  ['GET /auth/:provider/start', GRUENDE.oeffentlich],
  ['GET /auth/:provider/callback', GRUENDE.oeffentlich],

  // -- eigenes Konto ----------------------------------------------------------
  ['GET /auth/session', GRUENDE.eigenesKonto],
  ['GET /auth/sessions', GRUENDE.eigenesKonto],
  ['DELETE /auth/sessions', GRUENDE.eigenesKonto],
  ['DELETE /auth/sessions/:sessionId', GRUENDE.eigenesKonto],
  ['PATCH /auth/account', GRUENDE.eigenesKonto],
  ['DELETE /auth/account', GRUENDE.eigenesKonto],
  ['DELETE /auth/methods/:type', GRUENDE.eigenesKonto],
  ['POST /auth/password/link', GRUENDE.eigenesKonto],
  ['POST /auth/password/change', GRUENDE.eigenesKonto],
  ['POST /auth/2fa/setup', GRUENDE.eigenesKonto],
  ['POST /auth/2fa/confirm', GRUENDE.eigenesKonto],
  ['POST /auth/2fa/disable', GRUENDE.eigenesKonto],
  ['POST /auth/avatar', GRUENDE.eigenesKonto],
  ['DELETE /auth/avatar', GRUENDE.eigenesKonto],
  ['GET /me/resource-quota', GRUENDE.eigenesKonto],
  ['GET /notifications', GRUENDE.eigenesKonto],
  ['POST /notifications/read', GRUENDE.eigenesKonto],
  ['DELETE /notifications/:notificationId', GRUENDE.eigenesKonto],
  ['GET /notifications/preferences', GRUENDE.eigenesKonto],
  ['PUT /notifications/preferences', GRUENDE.eigenesKonto],
  // Web-Push: Der oeffentliche Schluessel ist kein Geheimnis, verlangt aber
  // eine Sitzung - ohne Konto gibt es nichts zu abonnieren. An- und Abmelden
  // wirken ausschliesslich auf die Geraete des eigenen Kontos.
  ['GET /notifications/push/config', GRUENDE.nurSitzung],
  ['POST /notifications/push/subscriptions', GRUENDE.eigenesKonto],
  ['DELETE /notifications/push/subscriptions', GRUENDE.eigenesKonto],

  // -- nur Sitzung ------------------------------------------------------------
  ['GET /api/fonts', GRUENDE.nurSitzung],
  ['GET /api/fonts/:id/file', GRUENDE.nurSitzung],

  // -- Recht am Objekt: Server ------------------------------------------------
  ['GET /api/servers', GRUENDE.objektrecht],
  ['GET /api/servers/:id', GRUENDE.objektrecht],
  ['PATCH /api/servers/:id', GRUENDE.objektrecht],
  ['DELETE /api/servers/:id', GRUENDE.objektrecht],
  ['POST /api/servers/:id/start', GRUENDE.objektrecht],
  ['POST /api/servers/:id/stop', GRUENDE.objektrecht],
  ['POST /api/servers/:id/restart', GRUENDE.objektrecht],
  ['POST /api/servers/:id/console', GRUENDE.objektrecht],
  ['GET /api/servers/:id/logs', GRUENDE.objektrecht],
  ['GET /api/servers/:id/stats', GRUENDE.objektrecht],
  ['GET /api/servers/:id/stats/history', GRUENDE.objektrecht],
  ['GET /api/servers/:id/members', GRUENDE.objektrecht],
  ['PUT /api/servers/:id/members', GRUENDE.objektrecht],
  ['DELETE /api/servers/:id/members/:userId', GRUENDE.objektrecht],
  // Neue Image-Fassung übernehmen: `canUpdate` aus dem DTO (Pflichtenheft §9).
  ['POST /api/servers/:id/update', GRUENDE.objektrecht],
  // Besitzerwechsel: `canTransferOwnership` aus dem DTO (= server.manage.any).
  ['POST /api/servers/:id/owner', GRUENDE.objektrecht],
  ['PUT /api/servers/:id/pin', GRUENDE.objektrecht],
  ['DELETE /api/servers/:id/pin', GRUENDE.objektrecht],
  ['GET /api/servers/:id/files', GRUENDE.objektrecht],
  ['POST /api/servers/:id/files', GRUENDE.objektrecht],
  ['DELETE /api/servers/:id/files', GRUENDE.objektrecht],
  ['GET /api/servers/:id/files/content', GRUENDE.objektrecht],
  ['PUT /api/servers/:id/files/content', GRUENDE.objektrecht],
  ['GET /api/servers/:id/files/download', GRUENDE.objektrecht],
  ['GET /api/servers/:id/schedules', GRUENDE.objektrecht],
  ['POST /api/servers/:id/schedules', GRUENDE.objektrecht],
  ['PATCH /api/servers/:id/schedules/:scheduleId', GRUENDE.objektrecht],
  ['DELETE /api/servers/:id/schedules/:scheduleId', GRUENDE.objektrecht],
  ['POST /api/servers/:id/clone', GRUENDE.objektrecht],
  ['GET /api/servers/:id/clone/:jobId', GRUENDE.objektrecht],

  // -- Recht am Objekt: Unterhaltungen ----------------------------------------
  ['GET /api/chat/conversations', GRUENDE.objektrecht],
  ['GET /api/chat/conversations/:conversationId', GRUENDE.objektrecht],
  ['GET /api/chat/conversations/:conversationId/messages', GRUENDE.objektrecht],
  ['POST /api/chat/conversations/:conversationId/messages', GRUENDE.objektrecht],
  ['POST /api/chat/conversations/:conversationId/read', GRUENDE.objektrecht],
  ['POST /api/chat/conversations/direct', GRUENDE.objektrecht],
  ['GET /api/chat/servers/:serverId/conversation', GRUENDE.objektrecht],
  ['GET /api/chat/recipients', GRUENDE.objektrecht],
  ['DELETE /api/chat/messages/:messageId', GRUENDE.objektrecht],
  ['POST /api/chat/messages/:messageId/report', GRUENDE.objektrecht],

  // -- eigener Kanal ----------------------------------------------------------
  ['GET /agent', GRUENDE.eigenerKanal],
  ['GET /live', GRUENDE.eigenerKanal],
  ['GET /live/notifications', GRUENDE.eigenerKanal],
  ['GET /api/chat/live', GRUENDE.eigenerKanal],
]);

/** Eine Route, wie der Test sie sieht. */
interface Route {
  readonly methode: string;
  readonly pfad: string;
  readonly bewacht: boolean;
  /** Die Rechte der Guards an dieser Route, in ihrer Reihenfolge. */
  readonly rechte: readonly string[];
}

/** Wegwerfwerte, nur damit der Aufbau durchlaeuft - siehe Kopf. */
const AUFBAU_UMGEBUNG: Record<string, string> = {
  JWT_SECRET: 'testaufbau-jwt-geheimnis-nur-fuer-den-routenabgleich-0001',
  CSRF_SECRET: 'testaufbau-csrf-geheimnis-nur-fuer-den-routenabgleich-0002',
  ALTCHA_HMAC_KEY: 'testaufbau-altcha-geheimnis-nur-fuer-den-routenabgleich-003',
  // Ohne Adresse haengt `buildServer` die datenbankgestuetzten Module gar nicht
  // erst ein. Verbunden wird beim Aufbau nicht - die Module bauen ihren Zugriff
  // traege auf, und der Server wird nie angefragt.
  DATABASE_URL: 'postgresql://routenabgleich:routenabgleich@127.0.0.1:5432/routenabgleich',
};

const vorherigeWerte = new Map<string, string | undefined>();

function schluessel(route: Route): string {
  return `${route.methode} ${route.pfad}`;
}

/** `preHandler` ist entweder nichts, eine Funktion oder eine Liste davon. */
function hookListe(hook: unknown): unknown[] {
  if (hook === undefined || hook === null) return [];

  return Array.isArray(hook) ? hook : [hook];
}

let gebaut: Promise<{ alle: Route[]; schliessen: () => Promise<void> }> | null = null;

/**
 * Baut den Server genau einmal und haelt die eingesammelten Routen.
 *
 * `buildServer` kommt per dynamischem Import: `config/env.js` liest die Umgebung
 * beim Laden des Moduls, und die Werte oben muessen vorher stehen. Der Aufbau
 * haengt die Module ein, oeffnet aber keinen Port.
 */
function serverAufbauen(): Promise<{ alle: Route[]; schliessen: () => Promise<void> }> {
  gebaut ??= (async () => {
    for (const [name, wert] of Object.entries(AUFBAU_UMGEBUNG)) {
      vorherigeWerte.set(name, process.env[name]);
      process.env[name] ??= wert;
    }

    const { buildServer } = await import('../../server.js');

    const gesammelt: RouteOptions[] = [];
    const app = await buildServer({ onRoute: (route) => gesammelt.push(route) });

    const alle = gesammelt.map((route) => {
      const guards = hookListe(route.preHandler).filter(istRbacGuard);

      return {
        methode: Array.isArray(route.method) ? route.method.join('|') : route.method,
        pfad: route.url,
        bewacht: guards.length > 0,
        rechte: guards.flatMap((guard) => [...guard[RBAC_GUARD_RECHTE]]),
      };
    });

    return { alle, schliessen: () => app.close() };
  })();

  return gebaut;
}

/**
 * Die Routen, um die es geht.
 *
 * Ohne die von Fastify erzeugten `HEAD` (sie spiegeln ihr `GET` samt Hooks, was
 * der Test unten eigens nachweist) und ohne das `OPTIONS *` des CORS-Plugins -
 * das beantwortet den Vorabflug und erreicht keinen Handler.
 */
async function routen(): Promise<Route[]> {
  const { alle } = await serverAufbauen();

  return alle.filter((route) => route.methode !== 'HEAD' && route.methode !== 'OPTIONS');
}

afterAll(async () => {
  if (gebaut) {
    const { schliessen } = await gebaut;
    await schliessen();
  }

  for (const [name, wert] of vorherigeWerte) {
    if (wert === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = wert;
    }
  }
});

describe('Jede Route deklariert ein Recht (HM-9)', () => {
  it('sammelt ueberhaupt Routen ein', async () => {
    // Absicherung gegen einen stillen Fehlschlag: Griffe das Einsammeln daneben,
    // liefen die Pruefungen darunter ueber eine leere Liste und waeren gruen,
    // ohne irgendetwas geprueft zu haben.
    expect((await routen()).length).toBeGreaterThan(100);
  });

  it('jedes HEAD spiegelt sein GET - erst deshalb darf der Test sie weglassen', async () => {
    const { alle } = await serverAufbauen();
    const getSchutz = new Map(
      alle.filter((route) => route.methode === 'GET').map((route) => [route.pfad, route.bewacht]),
    );

    const abweichend = alle
      .filter((route) => route.methode === 'HEAD')
      .filter((route) => getSchutz.get(route.pfad) !== route.bewacht)
      .map(schluessel);

    expect(abweichend).toEqual([]);
  });

  it('erkennt einen echten Guard und liest sein Recht', async () => {
    // Die andere Haelfte der Gegenprobe: Eine kaputte Marke liesse jede Route
    // als unbewacht durchgehen - die Pruefung unten waere dann zwar rot, aber
    // aus dem falschen Grund, und mit genug Eintraegen in der Liste wieder gruen.
    const { alle } = await serverAufbauen();
    const route = alle.find((eintrag) => schluessel(eintrag) === 'DELETE /admin/nodes/:nodeId');

    expect(route?.bewacht).toBe(true);
    expect(route?.rechte).toEqual(['node.manage']);
  });

  it('bewacht jede Route oder nennt ihren Grund', async () => {
    const ungedeckt = (await routen())
      .filter((route) => !route.bewacht)
      .filter((route) => !OHNE_GUARD.has(schluessel(route)))
      .map(schluessel)
      .sort();

    expect(ungedeckt).toEqual([]);
  });

  it('kennt keine Eintraege zu Routen, die es nicht mehr gibt', async () => {
    // Sonst waechst die Liste still weiter und deckt irgendwann eine Route,
    // deren Pfad sich nur geaendert hat.
    const vorhanden = new Set((await routen()).map(schluessel));
    const verwaist = [...OHNE_GUARD.keys()].filter((eintrag) => !vorhanden.has(eintrag)).sort();

    expect(verwaist).toEqual([]);
  });

  it('erkennt eine neue Route ohne Guard', async () => {
    // Die Gegenprobe: Ohne sie koennte die Pruefung oben gruen sein, weil sie
    // gar nichts erkennt.
    const erfunden: Route = {
      methode: 'GET',
      pfad: '/api/neu-und-ungeschuetzt',
      bewacht: false,
      rechte: [],
    };

    const ungedeckt = [...(await routen()), erfunden]
      .filter((route) => !route.bewacht)
      .filter((route) => !OHNE_GUARD.has(schluessel(route)))
      .map(schluessel);

    expect(ungedeckt).toEqual(['GET /api/neu-und-ungeschuetzt']);
  });
});
