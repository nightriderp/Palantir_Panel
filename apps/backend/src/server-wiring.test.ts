/**
 * Verdrahtung der Module in `buildServer()` (R2).
 *
 * Der bestehende Test des Grundgerüsts (`server.test.ts`) baut den Server
 * bewusst **ohne** `DATABASE_URL` – dort werden die fachlichen Module gar nicht
 * erst registriert. Genau deshalb fiel nicht auf, dass die Backup-Routen
 * mangels `ServerDirectory` und `BackupAgentGateway` nirgends eingehängt waren
 * (Gefundener Punkt 33).
 *
 * Dieser Test schließt die Lücke: Mit gesetzter `DATABASE_URL` müssen die
 * Routen aller Module registriert sein. Verbunden wird dabei nichts – Pool und
 * Drizzle-Instanz entstehen erst beim ersten Zugriff (`db/client.ts`), und
 * Routen-Registrierung ist kein Zugriff.
 *
 * `DATABASE_URL` wird vor dem Import gesetzt, weil `config/env.ts` die Umgebung
 * beim Laden des Moduls einliest. Vitest lädt jede Testdatei mit eigener
 * Modul-Registry, die Änderung bleibt also in dieser Datei.
 */

import type { HTTPMethods } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.DATABASE_URL = 'postgres://palantir:palantir@127.0.0.1:5432/palantir';
process.env.LOG_LEVEL = 'error';

const { buildServer } = await import('./server.js');
const { closeDb } = await import('./db/client.js');

let vorhanden: (method: HTTPMethods, url: string) => boolean = () => false;

beforeAll(async () => {
  // Ohne Auth-Modul: Es verlangt Geheimnisse aus der zentralen `.env`, und die
  // Registrierung der übrigen Module hängt nicht daran.
  const app = await buildServer({ auth: false });

  await app.ready();

  // `hasRoute` prüft gegen die **deklarierten** Pfade inklusive Platzhaltern –
  // genauer als ein Textvergleich auf dem gedruckten Routenbaum, der gemeinsame
  // Präfixe zusammenfasst.
  vorhanden = (method, url): boolean => app.hasRoute({ method, url });

  await app.close();
});

afterAll(async () => {
  await closeDb();
});

describe('buildServer() mit Datenbank', () => {
  it('registriert die Backup-Routen aus B5 (Gefundener Punkt 33)', () => {
    const routen: [HTTPMethods, string][] = [
      ['GET', '/servers/:serverId/backups'],
      ['POST', '/servers/:serverId/backups'],
      ['POST', '/servers/:serverId/export'],
      ['GET', '/servers/:serverId/backup-schedule'],
      ['PUT', '/servers/:serverId/backup-schedule'],
      ['GET', '/backups/:backupId'],
      ['DELETE', '/backups/:backupId'],
      ['POST', '/backups/:backupId/restore'],
      ['GET', '/backups/:backupId/download'],
      ['GET', '/users/:userId/backups'],
      ['GET', '/admin/backups'],
    ];

    expect(routen.filter(([method, url]) => !vorhanden(method, url))).toEqual([]);
  });

  it('registriert weiterhin die Routen der Server-Orchestrierung und der Admin-Funktionen', () => {
    const routen: [HTTPMethods, string][] = [
      ['GET', '/api/servers'],
      ['GET', '/api/game-types'],
      ['GET', '/admin/nodes'],
      ['GET', '/admin/storage/:nodeId'],
    ];

    expect(routen.filter(([method, url]) => !vorhanden(method, url))).toEqual([]);
  });
});
