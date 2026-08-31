import { describe, expect, it } from 'vitest';
import { buildServerTabs, isServerTabKey, resolveServerTab } from './serverTabs';
import { ownerPermissions, permissions } from './testFixtures';

describe('buildServerTabs', () => {
  it('gibt für den Besitzer alle Reiter frei', () => {
    const tabs = buildServerTabs(ownerPermissions());
    expect(tabs).toHaveLength(5);
    expect(tabs.every((tab) => !tab.locked)).toBe(true);
  });

  it('sperrt jeden Reiter, dessen Flag fehlt – zeigt ihn aber weiter an', () => {
    const tabs = buildServerTabs(permissions({ canView: true }));
    const locked = tabs.filter((tab) => tab.locked).map((tab) => tab.key);

    expect(locked).toEqual(['tasks', 'files', 'backups', 'settings']);
    expect(tabs).toHaveLength(5);
    for (const tab of tabs.filter((entry) => entry.locked)) {
      expect(tab.lockedReason).toBe('Für deine Rolle nicht freigegeben.');
    }
  });

  it('bindet jeden Reiter an genau sein Flag', () => {
    const cases = [
      ['files', permissions({ canManageFiles: true })],
      ['backups', permissions({ canManageBackups: true })],
      ['tasks', permissions({ canManageSchedules: true })],
    ] as const;

    for (const [key, flags] of cases) {
      const tab = buildServerTabs(flags).find((entry) => entry.key === key);
      expect(tab?.locked, `Reiter ${key}`).toBe(false);
    }
  });

  it('öffnet „Einstellungen" schon bei einem der gebündelten Rechte', () => {
    for (const flags of [
      permissions({ canManageSettings: true }),
      permissions({ canManageMembers: true }),
      permissions({ canClone: true }),
      permissions({ canDelete: true }),
    ]) {
      const tab = buildServerTabs(flags).find((entry) => entry.key === 'settings');
      expect(tab?.locked).toBe(false);
    }

    const closed = buildServerTabs(permissions({ canView: true })).find(
      (entry) => entry.key === 'settings',
    );
    expect(closed?.locked).toBe(true);
  });

  it('folgt der Reihenfolge des Mockups und kennt keinen Konsolen-Reiter', () => {
    // Die Konsole steht auf der Übersicht, nicht in einem eigenen Reiter.
    const tabs = buildServerTabs(ownerPermissions());
    expect(tabs.map((tab) => tab.key)).toEqual([
      'overview',
      'tasks',
      'files',
      'backups',
      'settings',
    ]);
  });
});

describe('resolveServerTab', () => {
  it('behält den gewünschten Reiter, wenn er offen ist', () => {
    const tabs = buildServerTabs(ownerPermissions());
    expect(resolveServerTab('backups', tabs)).toBe('backups');
  });

  it('weicht bei gesperrtem Reiter auf den ersten offenen aus', () => {
    const tabs = buildServerTabs(permissions({ canView: true, canManageBackups: true }));
    expect(resolveServerTab('tasks', tabs)).toBe('overview');
  });

  it('führt ein altes Lesezeichen auf die Konsole auf die Übersicht', () => {
    // `?tab=console` gibt es nicht mehr; die Adresse soll trotzdem irgendwo
    // ankommen statt ins Leere zu laufen.
    const tabs = buildServerTabs(ownerPermissions());
    expect(resolveServerTab('console', tabs)).toBe('overview');
  });

  it('weicht bei unbekanntem Wert aus der Adresszeile ebenfalls aus', () => {
    const tabs = buildServerTabs(ownerPermissions());
    expect(resolveServerTab('irgendwas', tabs)).toBe('overview');
    expect(resolveServerTab(null, tabs)).toBe('overview');
  });

  it('meldet null, wenn kein einziger Reiter offen ist', () => {
    const tabs = buildServerTabs(permissions());
    expect(resolveServerTab('overview', tabs)).toBeNull();
  });

  it('nimmt den ersten offenen, auch wenn „Übersicht" gesperrt ist', () => {
    const tabs = buildServerTabs(permissions({ canManageFiles: true }));
    expect(resolveServerTab(null, tabs)).toBe('files');
  });
});

describe('isServerTabKey', () => {
  it('erkennt bekannte Schlüssel', () => {
    expect(isServerTabKey('overview')).toBe(true);
    expect(isServerTabKey('settings')).toBe(true);
  });

  it('weist fremde Werte ab', () => {
    expect(isServerTabKey('console')).toBe(false);
    expect(isServerTabKey('')).toBe(false);
  });
});
