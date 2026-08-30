/**
 * Pfadprüfung und DTO-Aufbau des Datei-Managers (Arbeitspaket P2).
 *
 * Der Schwerpunkt liegt auf der Einsperrung in den Datenordner (Gefundener
 * Punkt 100): Jeder Weg nach draußen – `..`, absoluter Fremdpfad, NUL-Byte,
 * Windows-Trenner – wird hier einzeln geprüft, weil ein Loch darin den
 * Datei-Manager zum Dateibrowser des ganzen Containers machen würde.
 */

import { type AgentFileEntry } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { isServerOrchestrationError } from './errors.js';
import {
  AGENT_FILE_CHANNEL_MAX_BYTES,
  MAX_EDITABLE_FILE_BYTES,
  isEditable,
  normalizeRelativePath,
  parentPathOf,
  toContainerPath,
  toRelativePath,
  toServerFileListDto,
} from './files.js';

const DATA_ROOT = '/data';
const SERVER_ID = '11111111-1111-4111-8111-111111111111';

function eintrag(overrides: Partial<AgentFileEntry> = {}): AgentFileEntry {
  return {
    name: 'server.properties',
    path: '/data/server.properties',
    type: 'file',
    sizeBytes: 42,
    modifiedAt: '2026-08-30T10:00:00.000Z',
    mode: '644',
    ...overrides,
  };
}

/** Fehlercode eines abgewiesenen Pfades – oder `null`, wenn er durchging. */
function fehlercode(aufruf: () => unknown): string | null {
  try {
    aufruf();

    return null;
  } catch (error: unknown) {
    return isServerOrchestrationError(error) ? error.code : 'UNERWARTET';
  }
}

describe('normalizeRelativePath()', () => {
  it('nimmt die Wurzel in beiden Schreibweisen an', () => {
    expect(normalizeRelativePath('')).toBe('');
    expect(normalizeRelativePath('.')).toBe('');
  });

  it('normalisiert Unterpfade ohne den Sinn zu ändern', () => {
    expect(normalizeRelativePath('welt/level.dat')).toBe('welt/level.dat');
    expect(normalizeRelativePath('welt/./level.dat')).toBe('welt/level.dat');
    expect(normalizeRelativePath('welt/')).toBe('welt');
    // Der Datei-Dialog des Browsers liefert unter Windows Backslashes.
    expect(normalizeRelativePath('welt\\level.dat')).toBe('welt/level.dat');
  });

  it('lehnt jeden Ausbruch aus dem Datenordner ab', () => {
    for (const pfad of [
      '..',
      '../etc/passwd',
      'welt/../../etc/passwd',
      '/etc/passwd',
      '/data/server.properties',
      'welt/\0/level.dat',
    ]) {
      expect(fehlercode(() => normalizeRelativePath(pfad))).toBe('AGENT_INVALID_PATH');
    }
  });

  it('lässt ein .. zu, das im Ordner bleibt', () => {
    expect(normalizeRelativePath('welt/../server.properties')).toBe('server.properties');
  });
});

describe('toContainerPath()', () => {
  it('setzt relative Pfade auf den Datenordner des Spiels auf', () => {
    expect(toContainerPath(DATA_ROOT, '')).toBe('/data');
    expect(toContainerPath(DATA_ROOT, 'welt/level.dat')).toBe('/data/welt/level.dat');
    expect(toContainerPath('/usr/share/nginx/html', 'index.html')).toBe(
      '/usr/share/nginx/html/index.html',
    );
  });

  it('lehnt Ausbruchspfade ab, bevor daraus ein Agent-Befehl wird', () => {
    expect(fehlercode(() => toContainerPath(DATA_ROOT, '../etc/passwd'))).toBe(
      'AGENT_INVALID_PATH',
    );
    expect(fehlercode(() => toContainerPath(DATA_ROOT, '/etc/passwd'))).toBe('AGENT_INVALID_PATH');
  });

  it('lehnt einen nicht bestimmbaren Datenordner ab, statt auf / auszuweichen', () => {
    expect(fehlercode(() => toContainerPath('relativ/ohne/wurzel', 'a.txt'))).toBe(
      'AGENT_INVALID_PATH',
    );
  });
});

describe('toRelativePath() / parentPathOf()', () => {
  it('rechnet absolute Container-Pfade auf die Sicht des Frontends zurück', () => {
    expect(toRelativePath(DATA_ROOT, '/data')).toBe('');
    expect(toRelativePath(DATA_ROOT, '/data/welt/level.dat')).toBe('welt/level.dat');
  });

  it('kennt in der Wurzel kein übergeordnetes Verzeichnis', () => {
    expect(parentPathOf('')).toBeNull();
    expect(parentPathOf('welt')).toBe('');
    expect(parentPathOf('welt/region/r.0.0.mca')).toBe('welt/region');
  });
});

describe('isEditable()', () => {
  it('öffnet Textdateien innerhalb der Größengrenze', () => {
    expect(isEditable({ type: 'file', name: 'server.properties', sizeBytes: 100 })).toBe(true);
    expect(isEditable({ type: 'file', name: 'eula', sizeBytes: 10 })).toBe(true);
  });

  it('öffnet weder Binärdateien noch Verzeichnisse noch zu große Dateien', () => {
    expect(isEditable({ type: 'file', name: 'welt.zip', sizeBytes: 100 })).toBe(false);
    expect(isEditable({ type: 'directory', name: 'welt', sizeBytes: 0 })).toBe(false);
    expect(
      isEditable({ type: 'file', name: 'riesig.log', sizeBytes: MAX_EDITABLE_FILE_BYTES + 1 }),
    ).toBe(false);
  });
});

describe('toServerFileListDto()', () => {
  it('liefert relative Pfade und die geltenden Grenzen', () => {
    const dto = toServerFileListDto(
      SERVER_ID,
      DATA_ROOT,
      'welt',
      [
        eintrag({ name: 'level.dat', path: '/data/welt/level.dat', sizeBytes: 12 }),
        eintrag({ name: 'region', path: '/data/welt/region', type: 'directory', sizeBytes: 0 }),
      ],
      { writable: true, maxUploadBytes: 1_000 },
    );

    expect(dto).toMatchObject({
      serverId: SERVER_ID,
      path: 'welt',
      parentPath: '',
      writable: true,
      maxUploadBytes: 1_000,
      maxEditableBytes: MAX_EDITABLE_FILE_BYTES,
    });
    expect(dto.entries.map((e) => e.path)).toEqual(['welt/level.dat', 'welt/region']);
    // Ein Verzeichnis ist weder bearbeitbar noch einzeln herunterladbar.
    expect(dto.entries[1]).toMatchObject({ editable: false, downloadable: false });
  });

  it('meldet nichts als bearbeitbar, wo nicht geschrieben werden darf', () => {
    const dto = toServerFileListDto(SERVER_ID, DATA_ROOT, '', [eintrag()], {
      writable: false,
      maxUploadBytes: 1_000,
    });

    expect(dto.writable).toBe(false);
    expect(dto.entries[0]).toMatchObject({ editable: false, downloadable: true });
  });
});

describe('Kanal-Grenze', () => {
  it('bleibt unter der Vorgabe der Umgebungsvariable', () => {
    // Spiegelt DEFAULT_MAX_FILE_BYTES des Agents; größere Dateien lehnt er ab.
    expect(AGENT_FILE_CHANNEL_MAX_BYTES).toBe(64 * 1024 * 1024);
  });
});
