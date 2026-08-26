import { NOTIFIABLE_EVENTS, type NotificationEvent } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { renderNotification } from './messages.js';
import { serverEvent } from './test-doubles.js';

/** Eine gültige Nutzlast je Ereignis – Grundlage der Vollständigkeitsprüfung. */
const SAMPLES: Record<string, NotificationEvent> = {
  'server.created': serverEvent('server.created'),
  'server.started': serverEvent('server.started'),
  'server.stopped': serverEvent('server.stopped'),
  'server.restarted': serverEvent('server.restarted'),
  'server.crashed': serverEvent('server.crashed'),
  'server.failed': serverEvent('server.failed'),
  'server.cloned': serverEvent('server.cloned'),
  'server.deleted': serverEvent('server.deleted'),
  'autoShutdown.triggered': {
    event: 'autoShutdown.triggered',
    payload: {
      at: '2026-08-26T12:00:00.000Z',
      actorId: null,
      serverId: 'srv',
      serverName: 'Wüstensturm',
      ownerId: 'owner',
      memberUserIds: [],
      detail: null,
      idleMinutes: 30,
    },
  },
  'backup.failed': {
    event: 'backup.failed',
    payload: {
      at: '2026-08-26T12:00:00.000Z',
      actorId: null,
      backupId: 'bkp',
      serverId: 'srv',
      serverName: 'Wüstensturm',
      ownerId: 'owner',
      failureCode: 'AGENT_NOT_CONNECTED',
      failureMessage: 'Der Agent war nicht verbunden.',
    },
  },
  'resource.low': {
    event: 'resource.low',
    payload: {
      at: '2026-08-26T12:00:00.000Z',
      actorId: null,
      scope: 'node',
      resource: 'ram',
      nodeId: 'node',
      serverId: null,
      ownerId: null,
      usedPercent: 91.25,
      thresholdPercent: 85,
    },
  },
  'user.registered': {
    event: 'user.registered',
    payload: {
      at: '2026-08-26T12:00:00.000Z',
      actorId: null,
      userId: 'usr',
      displayName: 'Neuling',
      awaitingApproval: true,
    },
  },
  'message.reported': {
    event: 'message.reported',
    payload: {
      at: '2026-08-26T12:00:00.000Z',
      actorId: null,
      reportId: 'rep',
      messageId: 'msg',
      conversationId: 'conv',
      reportedByUserId: 'usr',
      reason: 'Beleidigung',
    },
  },
  'announcement.published': {
    event: 'announcement.published',
    payload: {
      at: '2026-08-26T12:00:00.000Z',
      actorId: 'admin',
      announcementId: 'ann',
      title: 'Wartung am Sonntag',
      body: 'Ab 02:00 Uhr steht das Panel kurz still.',
      severity: 'warning',
    },
  },
};

describe('Textbildung (Pflichtenheft §14)', () => {
  /**
   * Trägt die Zusicherung aus `messages.ts`: Ein neues Ereignis kann nicht
   * still mit leerem Text zugestellt werden.
   */
  it('hat für jedes auslösende Ereignis einen Titel und einen Text', () => {
    for (const event of NOTIFIABLE_EVENTS) {
      const sample = SAMPLES[event];

      expect(sample, `Für ${event} fehlt eine Beispiel-Nutzlast im Test`).toBeDefined();

      const rendered = renderNotification(sample as NotificationEvent);

      expect(rendered.title.length, `Titel zu ${event}`).toBeGreaterThan(0);
      expect(rendered.body.length, `Text zu ${event}`).toBeGreaterThan(0);
    }
  });

  it('stuft einen Absturz als Warnung und einen Fehlerzustand als Fehler ein', () => {
    expect(renderNotification(serverEvent('server.crashed')).severity).toBe('warning');
    expect(renderNotification(serverEvent('server.failed')).severity).toBe('error');
    expect(renderNotification(serverEvent('server.started')).severity).toBe('info');
  });

  it('nennt ein fehlgeschlagenes Backup mit benanntem Fehlercode', () => {
    const rendered = renderNotification(SAMPLES['backup.failed'] as NotificationEvent);

    expect(rendered.severity).toBe('error');
    expect(rendered.title).toContain('Wüstensturm');
    expect(rendered.body).toContain('AGENT_NOT_CONNECTED');
    expect(rendered.subject).toEqual({
      type: 'backup',
      id: 'bkp',
      displayName: 'Wüstensturm',
    });
  });

  it('schreibt Prozentwerte in deutscher Schreibweise', () => {
    const rendered = renderNotification(SAMPLES['resource.low'] as NotificationEvent);

    expect(rendered.body).toContain('91,3 %');
    expect(rendered.body).toContain('85,0 %');
  });

  it('hängt den Zusatz der Quelle an, wenn es einen gibt', () => {
    const withDetail = renderNotification(
      serverEvent('server.failed', { detail: 'Port 25565 war belegt.' }),
    );

    expect(withDetail.body).toContain('Port 25565 war belegt.');
  });

  it('lässt einen leeren Zusatz weg statt ein Leerzeichen anzuhängen', () => {
    const rendered = renderNotification(serverEvent('server.started', { detail: '   ' }));

    expect(rendered.body).toBe('Der Server wurde gestartet und ist erreichbar.');
  });

  /** Der Sprung aus der Inbox ginge sonst auf eine Seite, die es nicht mehr gibt. */
  it('gibt einem gelöschten Server keinen Bezug mehr', () => {
    expect(renderNotification(serverEvent('server.deleted')).subject).toBeNull();
  });

  it('übernimmt bei einer Ankündigung Titel, Text und Dringlichkeit unverändert', () => {
    const rendered = renderNotification(SAMPLES['announcement.published'] as NotificationEvent);

    expect(rendered.title).toBe('Wartung am Sonntag');
    expect(rendered.body).toBe('Ab 02:00 Uhr steht das Panel kurz still.');
    expect(rendered.severity).toBe('warning');
  });
});
