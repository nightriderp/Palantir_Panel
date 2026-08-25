/**
 * Gemeinsame Vertragspruefung fuer jede `ContainerRuntime`-Implementierung.
 *
 * Die Suite beschreibt das erwartete Verhalten der Schnittstelle, nicht das
 * einer bestimmten Implementierung. Aktuell laeuft sie gegen die
 * Fake-Implementierung (Pflichtenheft §2.5); dieselbe Suite laesst sich spaeter
 * unveraendert gegen einen echten Docker-Host haengen, um zu pruefen, ob der
 * Fake noch dasselbe Verhalten zeigt.
 *
 * Bewusst keine `.test.ts`-Datei: sie wird von den Testdateien importiert und
 * nicht selbst als Testdatei eingesammelt.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { type ContainerRuntime } from './container-runtime.js';
import { ContainerRuntimeError } from './errors.js';
import { type ContainerRuntimeEvent } from './events.js';
import { type ContainerSpec } from './types.js';

export interface ConformanceKontext {
  readonly runtime: ContainerRuntime;
  readonly spec: (ueberschreibung?: Partial<ContainerSpec>) => ContainerSpec;
}

export function runContainerRuntimeConformance(
  name: string,
  erzeugeKontext: () => Promise<ConformanceKontext>,
): void {
  describe(`ContainerRuntime-Vertrag: ${name}`, () => {
    let runtime: ContainerRuntime;
    let spec: ConformanceKontext['spec'];
    let events: ContainerRuntimeEvent[];

    beforeEach(async () => {
      const kontext = await erzeugeKontext();
      runtime = kontext.runtime;
      spec = kontext.spec;
      events = [];
      await runtime.connect();
      runtime.on((event) => events.push(event));
    });

    async function angelegt(ueberschreibung?: Partial<ContainerSpec>): Promise<string> {
      const handle = await runtime.create(spec(ueberschreibung));
      return handle.containerId;
    }

    describe('CREATE', () => {
      it('liefert eine Container-ID und den vergebenen Namen', async () => {
        const handle = await runtime.create(spec({ name: 'palantir-srv-7' }));
        expect(handle.containerId.length).toBeGreaterThan(0);
        expect(handle.name).toBe('palantir-srv-7');
      });

      it('legt den Container an, startet ihn aber nicht', async () => {
        const id = await angelegt();
        expect((await runtime.inspect(id)).status).toBe('created');
      });

      it('lehnt einen doppelten Namen ab', async () => {
        await angelegt({ name: 'palantir-doppelt' });
        await expect(runtime.create(spec({ name: 'palantir-doppelt' }))).rejects.toMatchObject({
          code: 'CONTAINER_NAME_CONFLICT',
        });
      });

      it('lehnt einen Spec ohne gueltige Ressourcen-Grenzen ab', async () => {
        await expect(
          runtime.create(spec({ resources: { memoryMb: 0, cpuCores: 0 } })),
        ).rejects.toBeInstanceOf(ContainerRuntimeError);
      });
    });

    describe('START / STOP / RESTART', () => {
      it('meldet den Wechsel nach running', async () => {
        const id = await angelegt();
        await runtime.start(id);

        expect((await runtime.inspect(id)).status).toBe('running');
        expect(events).toContainEqual(
          expect.objectContaining({ type: 'STATUS_CHANGED', containerId: id, status: 'running' }),
        );
      });

      it('behandelt ein wiederholtes START als folgenlos', async () => {
        const id = await angelegt();
        await runtime.start(id);
        const vorher = events.length;

        await runtime.start(id);

        expect((await runtime.inspect(id)).status).toBe('running');
        expect(events.length).toBe(vorher);
      });

      it('stoppt ohne CRASHED zu melden', async () => {
        const id = await angelegt();
        await runtime.start(id);
        await runtime.stop(id);

        expect((await runtime.inspect(id)).status).toBe('exited');
        expect(events.filter((e) => e.type === 'CRASHED')).toEqual([]);
      });

      it('behandelt STOP auf einen gestoppten Container als folgenlos', async () => {
        const id = await angelegt();
        await expect(runtime.stop(id)).resolves.toBeUndefined();
      });

      it('laesst den Container nach RESTART wieder laufen', async () => {
        const id = await angelegt();
        await runtime.start(id);
        await runtime.restart(id);

        expect((await runtime.inspect(id)).status).toBe('running');
        expect(events.filter((e) => e.type === 'CRASHED')).toEqual([]);
      });
    });

    describe('DELETE', () => {
      it('entfernt den Container', async () => {
        const id = await angelegt();
        await runtime.remove(id);

        await expect(runtime.inspect(id)).rejects.toMatchObject({ code: 'CONTAINER_NOT_FOUND' });
      });

      it('entfernt einen laufenden Container nur mit force', async () => {
        const id = await angelegt();
        await runtime.start(id);

        await expect(runtime.remove(id)).rejects.toBeInstanceOf(ContainerRuntimeError);
        await expect(runtime.remove(id, { force: true })).resolves.toBeUndefined();
      });
    });

    describe('Ist-Zustand', () => {
      it('listet alle verwalteten Container (Grundlage des Reconnect-Abgleichs)', async () => {
        const a = await angelegt({ name: 'palantir-a' });
        const b = await angelegt({ name: 'palantir-b' });
        await runtime.start(b);

        const zustaende = await runtime.list();
        expect(zustaende.map((z) => z.containerId).sort()).toEqual([a, b].sort());
        expect(zustaende.find((z) => z.containerId === b)?.status).toBe('running');
      });

      it('meldet einen unbekannten Container als nicht gefunden', async () => {
        await expect(runtime.inspect('gibt-es-nicht')).rejects.toMatchObject({
          code: 'CONTAINER_NOT_FOUND',
        });
      });
    });

    describe('GET_STATS', () => {
      it('liefert eine Momentaufnahme mit Container-Bezug', async () => {
        const id = await angelegt();
        const stats = await runtime.getStats(id);

        expect(stats.containerId).toBe(id);
        expect(typeof stats.cpuPercent).toBe('number');
        expect(typeof stats.memoryUsedBytes).toBe('number');
      });
    });

    describe('EXEC_CONSOLE', () => {
      it('scheitert auf einem nicht laufenden Container', async () => {
        const id = await angelegt();
        await expect(runtime.execConsole(id, ['say', 'hallo'])).rejects.toMatchObject({
          code: 'CONTAINER_NOT_RUNNING',
        });
      });

      it('lehnt einen leeren Befehl ab', async () => {
        const id = await angelegt();
        await runtime.start(id);
        await expect(runtime.execConsole(id, [])).rejects.toBeInstanceOf(ContainerRuntimeError);
      });
    });

    describe('FILE_LIST / FILE_READ / FILE_WRITE', () => {
      it('schreibt und liest eine Datei', async () => {
        const id = await angelegt();
        await runtime.writeFile(id, '/data/server.properties', Buffer.from('max-players=20'));

        const inhalt = await runtime.readFile(id, '/data/server.properties');
        expect(inhalt.toString('utf8')).toBe('max-players=20');
      });

      it('ueberschreibt eine vorhandene Datei', async () => {
        const id = await angelegt();
        await runtime.writeFile(id, '/data/a.txt', Buffer.from('alt'));
        await runtime.writeFile(id, '/data/a.txt', Buffer.from('neu'));

        expect((await runtime.readFile(id, '/data/a.txt')).toString('utf8')).toBe('neu');
      });

      it('meldet eine fehlende Datei als FILE_NOT_FOUND', async () => {
        const id = await angelegt();
        await expect(runtime.readFile(id, '/data/fehlt.txt')).rejects.toMatchObject({
          code: 'FILE_NOT_FOUND',
        });
      });

      it('listet nur die direkte Ebene eines Verzeichnisses', async () => {
        const id = await angelegt();
        await runtime.writeFile(id, '/data/server.properties', Buffer.from('x'));
        await runtime.writeFile(id, '/data/welt/level.dat', Buffer.from('y'));

        const eintraege = await runtime.listFiles(id, '/data');
        expect(eintraege.map((e) => e.name)).toEqual(['server.properties', 'welt']);
        expect(eintraege.find((e) => e.name === 'welt')?.type).toBe('directory');
        expect(eintraege.find((e) => e.name === 'server.properties')?.type).toBe('file');
      });

      it('lehnt relative Pfade ab', async () => {
        const id = await angelegt();
        await expect(runtime.readFile(id, 'data/../../etc/shadow')).rejects.toMatchObject({
          code: 'INVALID_PATH',
        });
      });
    });

    describe('Abbau', () => {
      it('stellt nach dispose() keine Events mehr zu', async () => {
        const id = await angelegt();
        await runtime.dispose();
        events.length = 0;

        await runtime.start(id).catch(() => undefined);
        expect(events).toEqual([]);
      });
    });
  });
}
