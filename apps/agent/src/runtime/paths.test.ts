import { describe, expect, it } from 'vitest';
import { assertAbsoluteContainerPath, assertHostPathAllowed, resolveWithinRoot } from './paths.js';
import { ContainerRuntimeError } from './errors.js';

const WURZEL = '/srv/palantir/servers/srv-1';

describe('resolveWithinRoot', () => {
  it('loest relative Angaben gegen die Wurzel auf', () => {
    expect(resolveWithinRoot(WURZEL, 'config/server.properties')).toBe(
      `${WURZEL}/config/server.properties`,
    );
  });

  it('normalisiert absolute Pfade innerhalb der Wurzel', () => {
    expect(resolveWithinRoot(WURZEL, `${WURZEL}/./welt/../config`)).toBe(`${WURZEL}/config`);
  });

  it('erlaubt die Wurzel selbst', () => {
    expect(resolveWithinRoot(WURZEL, WURZEL)).toBe(WURZEL);
  });

  it('blockiert den Ausbruch ueber ..', () => {
    expect(() => resolveWithinRoot(WURZEL, '../srv-2/geheim.txt')).toThrow(ContainerRuntimeError);
    expect(() => resolveWithinRoot(WURZEL, '/etc/shadow')).toThrow(ContainerRuntimeError);
  });

  it('blockiert Praefix-Verwechslung mit einem Nachbarverzeichnis', () => {
    // /srv/.../srv-10 faengt mit /srv/.../srv-1 an, liegt aber nicht darin.
    expect(() => resolveWithinRoot(WURZEL, '/srv/palantir/servers/srv-10/datei')).toThrow(
      ContainerRuntimeError,
    );
  });

  it('blockiert NUL-Bytes', () => {
    expect(() => resolveWithinRoot(WURZEL, 'datei\0.txt')).toThrow(ContainerRuntimeError);
  });
});

describe('assertHostPathAllowed', () => {
  const wurzeln = ['/srv/palantir/servers', '/srv/palantir/backups'];

  it('nimmt Pfade aus jeder erlaubten Wurzel an', () => {
    expect(assertHostPathAllowed(wurzeln, '/srv/palantir/servers/srv-1')).toBe(
      '/srv/palantir/servers/srv-1',
    );
    expect(assertHostPathAllowed(wurzeln, '/srv/palantir/backups/b-9')).toBe(
      '/srv/palantir/backups/b-9',
    );
  });

  it('lehnt alles andere ab', () => {
    expect(() => assertHostPathAllowed(wurzeln, '/var/run/docker.sock')).toThrow(
      ContainerRuntimeError,
    );
    expect(() => assertHostPathAllowed(wurzeln, 'relativ/pfad')).toThrow(ContainerRuntimeError);
  });

  it('lehnt ohne konfigurierte Wurzel jeden Mount ab', () => {
    expect(() => assertHostPathAllowed([], '/srv/palantir/servers/srv-1')).toThrow(
      ContainerRuntimeError,
    );
  });
});

describe('assertAbsoluteContainerPath', () => {
  it('normalisiert absolute Pfade', () => {
    expect(assertAbsoluteContainerPath('/data//welt/../config')).toBe('/data/config');
  });

  it('lehnt relative Pfade ab', () => {
    expect(() => assertAbsoluteContainerPath('data/config')).toThrow(ContainerRuntimeError);
  });
});
