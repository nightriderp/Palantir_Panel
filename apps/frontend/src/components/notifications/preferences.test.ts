import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  parsePreferences,
  serializePreferences,
  shouldToast,
  withGroup,
} from './preferences';

describe('parsePreferences', () => {
  it('liefert die Vorgabe bei leerem oder beschädigtem Eintrag', () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    expect(parsePreferences('')).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    expect(parsePreferences('{kaputt')).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    expect(parsePreferences('42')).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it('übernimmt bekannte Felder und ergänzt fehlende aus der Vorgabe', () => {
    const parsed = parsePreferences(
      JSON.stringify({ toastGroups: { backup: false }, startOnUnread: true }),
    );

    expect(parsed.toastGroups.backup).toBe(false);
    expect(parsed.toastGroups.server).toBe(true);
    expect(parsed.startOnUnread).toBe(true);
    expect(parsed.desktopEnabled).toBe(false);
  });

  it('verwirft unbekannte Gruppen und Werte falschen Typs', () => {
    const parsed = parsePreferences(
      JSON.stringify({ toastGroups: { erfunden: false, backup: 'nein' }, desktopEnabled: 1 }),
    );

    expect('erfunden' in parsed.toastGroups).toBe(false);
    expect(parsed.toastGroups.backup).toBe(true);
    expect(parsed.desktopEnabled).toBe(false);
  });

  it('übersteht einen vollständigen Umlauf durch die Serialisierung', () => {
    const changed = withGroup(DEFAULT_NOTIFICATION_PREFERENCES, 'resource', false);
    expect(parsePreferences(serializePreferences(changed))).toEqual(changed);
  });
});

describe('withGroup', () => {
  it('schaltet nur die genannte Gruppe um', () => {
    const next = withGroup(DEFAULT_NOTIFICATION_PREFERENCES, 'server', false);

    expect(next.toastGroups.server).toBe(false);
    expect(next.toastGroups.backup).toBe(true);
    expect(DEFAULT_NOTIFICATION_PREFERENCES.toastGroups.server).toBe(true);
  });
});

describe('shouldToast', () => {
  it('folgt der Einstellung der Gruppe des Ereignisses', () => {
    const off = withGroup(DEFAULT_NOTIFICATION_PREFERENCES, 'backup', false);

    expect(shouldToast(off, 'backup.failed')).toBe(false);
    expect(shouldToast(off, 'server.started')).toBe(true);
  });
});
