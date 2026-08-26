import { AUTOMATIC_BACKUP_RETENTION_DAYS } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import {
  type RetentionCandidate,
  isRetentionProtected,
  newestProtectedAutomaticBackup,
  retentionCutoff,
  retentionExpiresAt,
  selectExpiredBackups,
} from './retention.js';

const JETZT = new Date('2026-08-26T12:00:00.000Z');

function vorTagen(tage: number): Date {
  return new Date(JETZT.getTime() - tage * 24 * 60 * 60 * 1000);
}

function backup(
  id: string,
  type: RetentionCandidate['type'],
  alterInTagen: number,
  status: RetentionCandidate['status'] = 'completed',
): RetentionCandidate {
  return { id, type, status, createdAt: vorTagen(alterInTagen) };
}

function ids(backups: readonly RetentionCandidate[]): string[] {
  return backups.map((b) => b.id).sort();
}

describe('Aufbewahrungsregel – die drei Sonderfälle aus Lastenheft §3.3', () => {
  it('löscht automatische Backups, die älter als sieben Tage sind', () => {
    const backups = [
      backup('neu', 'automatic', 1),
      backup('alt-8', 'automatic', 8),
      backup('alt-30', 'automatic', 30),
    ];

    expect(ids(selectExpiredBackups(backups, JETZT))).toEqual(['alt-30', 'alt-8']);
  });

  it('behält das neueste automatische Backup, auch wenn es älter als sieben Tage ist', () => {
    // Der Server wurde seit einem Monat nicht gesichert: alles liegt über der
    // Frist. Trotzdem darf nicht die letzte Sicherung verschwinden.
    const backups = [
      backup('neuestes', 'automatic', 30),
      backup('aelter', 'automatic', 45),
      backup('aeltestes', 'automatic', 60),
    ];

    expect(ids(selectExpiredBackups(backups, JETZT))).toEqual(['aelter', 'aeltestes']);
  });

  it('nimmt manuell erstellte Backups vollständig von der Löschung aus', () => {
    const backups = [
      backup('manuell-alt', 'manual', 400),
      backup('manuell-neu', 'manual', 1),
      backup('auto-neu', 'automatic', 1),
      backup('auto-alt', 'automatic', 9),
    ];

    // Nur das alte automatische Backup geht. Die manuellen müssen aktiv
    // entfernt werden, egal wie alt sie sind.
    expect(ids(selectExpiredBackups(backups, JETZT))).toEqual(['auto-alt']);
  });
});

describe('Aufbewahrungsregel – Grenzfälle der Frist', () => {
  it('behält ein Backup, das exakt sieben Tage alt ist', () => {
    // „älter als 7 Tage“ ist streng gemeint.
    const backups = [
      backup('genau-7', 'automatic', AUTOMATIC_BACKUP_RETENTION_DAYS),
      backup('juenger', 'automatic', 1),
    ];

    expect(selectExpiredBackups(backups, JETZT)).toEqual([]);
  });

  it('löscht ein Backup, das die Frist um eine Millisekunde überschreitet', () => {
    const geschuetzt = backup('juenger', 'automatic', 0);
    const knappDrueber: RetentionCandidate = {
      id: 'knapp-drueber',
      type: 'automatic',
      status: 'completed',
      createdAt: new Date(retentionCutoff(JETZT).getTime() - 1),
    };

    expect(ids(selectExpiredBackups([geschuetzt, knappDrueber], JETZT))).toEqual(['knapp-drueber']);
  });

  it('rechnet die Frist ab jetzt, nicht ab dem neuesten Backup', () => {
    expect(retentionCutoff(JETZT).toISOString()).toBe('2026-08-19T12:00:00.000Z');
  });
});

describe('Aufbewahrungsregel – laufende und fehlgeschlagene Läufe', () => {
  it('fasst laufende Backups nie an', () => {
    const backups = [
      backup('laeuft', 'automatic', 30, 'running'),
      backup('wartet', 'automatic', 30, 'pending'),
      backup('fertig', 'automatic', 1),
    ];

    expect(selectExpiredBackups(backups, JETZT)).toEqual([]);
  });

  it('schützt das neueste abgeschlossene Backup, nicht einen jüngeren Fehlschlag', () => {
    // Auslegung dieser Sitzung: Ein fehlgeschlagenes Backup enthält keine
    // Daten. Würde es den Schutz beanspruchen, könnte die Regel das letzte
    // brauchbare Backup löschen – das Gegenteil des Regelzwecks.
    const fehlschlag = backup('fehlgeschlagen', 'automatic', 1, 'failed');
    const letztesGutes = backup('letztes-gutes', 'automatic', 20);
    const backups = [fehlschlag, letztesGutes, backup('aelteres-gutes', 'automatic', 25)];

    // Der Schutz hängt am neuesten abgeschlossenen Lauf, nicht am neuesten Lauf
    // überhaupt: sonst wäre hier „letztes-gutes“ ungeschützt und der Server
    // stünde nach dem Durchlauf ohne verwendbare Sicherung da.
    expect(isRetentionProtected(fehlschlag, backups)).toBe(false);
    expect(isRetentionProtected(letztesGutes, backups)).toBe(true);

    // Der Fehlschlag selbst bleibt nur deshalb liegen, weil er die Frist noch
    // nicht überschritten hat.
    expect(ids(selectExpiredBackups(backups, JETZT))).toEqual(['aelteres-gutes']);
  });

  it('löscht nichts Brauchbares, wenn es nur Fehlschläge gibt', () => {
    const backups = [backup('nur-fehler', 'automatic', 40, 'failed')];

    // Ohne abgeschlossenen Lauf greift der Schutz nicht: der Fehlschlag ist
    // älter als die Frist und darf weg.
    expect(ids(selectExpiredBackups(backups, JETZT))).toEqual(['nur-fehler']);
  });
});

describe('Auswahl des geschützten Backups', () => {
  it('entscheidet bei gleichem Zeitstempel anhand der Id, damit die Auswahl stabil bleibt', () => {
    const gleichzeitig: RetentionCandidate[] = [
      { id: 'bbb', type: 'automatic', status: 'completed', createdAt: vorTagen(10) },
      { id: 'aaa', type: 'automatic', status: 'completed', createdAt: vorTagen(10) },
    ];

    expect(newestProtectedAutomaticBackup(gleichzeitig)?.id).toBe('aaa');
    expect(newestProtectedAutomaticBackup([...gleichzeitig].reverse())?.id).toBe('aaa');
  });

  it('liefert null, wenn es kein abgeschlossenes automatisches Backup gibt', () => {
    expect(newestProtectedAutomaticBackup([backup('m', 'manual', 1)])).toBeNull();
  });
});

describe('Anzeige in der Oberfläche (BackupDto)', () => {
  const auto = backup('auto-alt', 'automatic', 9);
  const neuestes = backup('auto-neu', 'automatic', 1);
  const manuell = backup('manuell', 'manual', 400);
  const alle = [auto, neuestes, manuell];

  it('meldet manuelle Backups und das neueste automatische als geschützt', () => {
    expect(isRetentionProtected(manuell, alle)).toBe(true);
    expect(isRetentionProtected(neuestes, alle)).toBe(true);
    expect(isRetentionProtected(auto, alle)).toBe(false);
  });

  it('nennt für ungeschützte Backups den Zeitpunkt der Löschung', () => {
    expect(retentionExpiresAt(auto, alle)?.toISOString()).toBe('2026-08-24T12:00:00.000Z');
  });

  it('nennt für geschützte Backups keinen Zeitpunkt', () => {
    expect(retentionExpiresAt(manuell, alle)).toBeNull();
    expect(retentionExpiresAt(neuestes, alle)).toBeNull();
  });
});

describe('Aufbewahrungsregel gilt je Server', () => {
  it('schützt in jeder Serverliste getrennt das jeweils neueste automatische Backup', () => {
    const serverA = [backup('a-alt', 'automatic', 40), backup('a-aelter', 'automatic', 50)];
    const serverB = [backup('b-alt', 'automatic', 40)];

    expect(ids(selectExpiredBackups(serverA, JETZT))).toEqual(['a-aelter']);
    expect(selectExpiredBackups(serverB, JETZT)).toEqual([]);
  });
});
