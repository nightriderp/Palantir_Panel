/**
 * Ablauf der Online-Räume mit Mini-Spiel „Nimm" (siehe `test-support.ts`):
 * Rechte der Aktionen, Versionskonflikt, Ergebnisse, Bot-Läufer mit
 * Fake-Timer.
 */

import { type ArcadeLiveServerFrame } from '@palantir/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createArcadeBotRunner } from './bot-runner.js';
import { type ArcadeLiveDelivery } from './live.js';
import { type RoomViewer } from './rooms.js';
import { createArcadeRoomService } from './rooms-service.js';
import { type ArcadeRoomResult } from './service.js';
import { fakeRoomRepository, miniRegistry, nimGame } from './test-support.js';

const HOST: RoomViewer = { userId: 'host', displayName: 'Ada', isAdmin: false };
const MIT: RoomViewer = { userId: 'mit', displayName: 'Grace', isAdmin: false };
const FREMD: RoomViewer = { userId: 'fremd', displayName: 'Eve', isAdmin: false };
const ADMIN: RoomViewer = { userId: 'admin', displayName: 'Root', isAdmin: true };

function aufbau(registry = miniRegistry()) {
  const repository = fakeRoomRepository({ host: 'Ada', mit: 'Grace' });
  const zugestellt: { userId: string; frame: ArcadeLiveServerFrame }[] = [];
  const live: ArcadeLiveDelivery = {
    deliver: (userId, frame) => zugestellt.push({ userId, frame }),
    isOnline: (userId) => userId === 'host',
  };
  const ergebnisse: ArcadeRoomResult[] = [];
  const geplant: string[] = [];
  let zufall = 0;
  const rooms = createArcadeRoomService({
    repository,
    registry,
    live,
    recordResults: async (results) => {
      ergebnisse.push(...results);
    },
    scheduleBot: (roomId) => geplant.push(roomId),
    randomBelow: (max) => (zufall++ * 5) % max,
    logger: { warn: vi.fn(), error: vi.fn() },
  });

  return { repository, rooms, zugestellt, ergebnisse, geplant };
}

async function volleLobby(env: ReturnType<typeof aufbau>) {
  const room = await env.rooms.create(HOST, {
    gameId: 'vier-gewinnt',
    seatCount: 2,
    isPrivate: false,
  });
  await env.rooms.join(MIT, room.id, {});

  return room.id;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Raum anlegen', () => {
  it('setzt den Gastgeber auf Sitz 0 und lässt die übrigen frei', async () => {
    const env = aufbau();
    const room = await env.rooms.create(HOST, {
      gameId: 'vier-gewinnt',
      seatCount: 3,
      isPrivate: true,
      options: { stones: 9 },
    });

    expect(room.seats.map((seat) => seat.kind)).toEqual(['human', 'open', 'open']);
    expect(room.mySeat).toBe(0);
    expect(room.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(room.options).toEqual({ stones: 9 });
    expect(room.seats[0]).toMatchObject({ displayName: 'Ada', online: true });
  });

  it('lehnt Solo-Spiele, falsche Sitzzahl und kaputte Einstellungen ab', async () => {
    const env = aufbau();

    await expect(
      env.rooms.create(HOST, { gameId: 'kriechpfad', seatCount: 1, isPrivate: false }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      env.rooms.create(HOST, { gameId: 'vier-gewinnt', seatCount: 9, isPrivate: false }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      env.rooms.create(HOST, {
        gameId: 'vier-gewinnt',
        seatCount: 2,
        isPrivate: false,
        options: { stones: 'viele' },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('begrenzt die offenen Räume je Konto', async () => {
    const env = aufbau();

    for (let i = 0; i < 5; i += 1) {
      await env.rooms.create(HOST, { gameId: 'vier-gewinnt', seatCount: 2, isPrivate: false });
    }

    await expect(
      env.rooms.create(HOST, { gameId: 'vier-gewinnt', seatCount: 2, isPrivate: false }),
    ).rejects.toMatchObject({ code: 'ARCADE_ROOM_LIMIT' });
  });
});

describe('Sichtbarkeit', () => {
  it('zeigt private Räume per Kennung nur den Beteiligten, per Code allen', async () => {
    const env = aufbau();
    const room = await env.rooms.create(HOST, {
      gameId: 'vier-gewinnt',
      seatCount: 2,
      isPrivate: true,
    });

    await expect(env.rooms.get(FREMD, room.id)).rejects.toMatchObject({
      code: 'ARCADE_ROOM_NOT_FOUND',
    });
    await expect(env.rooms.getByCode(FREMD, room.code.toLowerCase())).resolves.toMatchObject({
      id: room.id,
    });
    expect(await env.rooms.list(FREMD, null)).toEqual([]);
    expect((await env.rooms.list(HOST, null)).map((r) => r.id)).toEqual([room.id]);
  });
});

describe('Rechte der Aktionen', () => {
  it('lässt nur den Gastgeber Sitze verwalten, starten und neu starten', async () => {
    const env = aufbau();
    const id = await volleLobby(env);

    await expect(env.rooms.setSeat(MIT, id, { seat: 0, kind: 'open' })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    await expect(env.rooms.start(MIT, id)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(env.rooms.start(FREMD, id)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(env.rooms.rematch(MIT, id)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('lässt Fremde nicht ziehen und nicht schreiben', async () => {
    const env = aufbau();
    const id = await volleLobby(env);
    const running = await env.rooms.start(HOST, id);

    await expect(
      env.rooms.move(FREMD, id, { version: running.version, move: { take: 1 } }),
    ).rejects.toMatchObject({ code: 'ARCADE_NOT_YOUR_TURN' });
    await expect(env.rooms.chat(FREMD, id, { text: 'Hallo' })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('lässt nur Gastgeber oder Admin schließen', async () => {
    const env = aufbau();
    const id = await volleLobby(env);

    await expect(env.rooms.close(MIT, id)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(env.rooms.close(FREMD, id)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(env.rooms.close(ADMIN, id)).resolves.toMatchObject({ status: 'closed' });
    await expect(env.rooms.join(FREMD, id, {})).rejects.toMatchObject({
      code: 'ARCADE_ROOM_NOT_FOUND',
    });
  });

  it('startet nicht mit freiem Platz und nimmt nach dem Start niemanden mehr auf', async () => {
    const env = aufbau();
    const room = await env.rooms.create(HOST, {
      gameId: 'vier-gewinnt',
      seatCount: 2,
      isPrivate: false,
    });

    await expect(env.rooms.start(HOST, room.id)).rejects.toMatchObject({
      code: 'ARCADE_ROOM_STATE',
    });
    await env.rooms.join(MIT, room.id, {});
    await expect(env.rooms.join(FREMD, room.id, {})).rejects.toMatchObject({
      code: 'ARCADE_ROOM_FULL',
    });
    await env.rooms.start(HOST, room.id);
    await expect(env.rooms.join(FREMD, room.id, {})).rejects.toMatchObject({
      code: 'ARCADE_ROOM_STATE',
    });
  });

  it('lässt nicht zweimal beitreten', async () => {
    const env = aufbau();
    const room = await env.rooms.create(HOST, {
      gameId: 'vier-gewinnt',
      seatCount: 3,
      isPrivate: false,
    });

    await env.rooms.join(MIT, room.id, {});
    await expect(env.rooms.join(MIT, room.id, {})).rejects.toMatchObject({
      code: 'ARCADE_ROOM_STATE',
    });
  });
});

describe('Züge', () => {
  it('wendet den Zug an, erhöht die Version und stößt alle im Raum an', async () => {
    const env = aufbau();
    const id = await volleLobby(env);
    const running = await env.rooms.start(HOST, id);
    env.zugestellt.length = 0;

    const nach = await env.rooms.move(HOST, id, { version: running.version, move: { take: 2 } });

    expect(nach.version).toBe(running.version + 1);
    expect(nach.view).toMatchObject({ stones: 5, current: 1 });
    expect(nach.permissions.canMove).toBe(false);
    expect(env.zugestellt.map((z) => z.userId).sort()).toEqual(['host', 'mit']);
    expect(env.zugestellt[0]?.frame).toMatchObject({
      kind: 'event',
      event: 'arcadeRoom.updated',
      data: { roomId: id, version: nach.version, status: 'running' },
    });
  });

  it('meldet einen Zug gegen eine veraltete Fassung als Versionskonflikt', async () => {
    const env = aufbau();
    const id = await volleLobby(env);
    const running = await env.rooms.start(HOST, id);

    await expect(
      env.rooms.move(HOST, id, { version: running.version - 1, move: { take: 1 } }),
    ).rejects.toMatchObject({ code: 'ARCADE_ROOM_VERSION_CONFLICT' });

    // Gleichzeitige Änderung zwischen Laden und Schreiben: ebenfalls Konflikt.
    env.repository.verliereSperre.naechstes = true;
    await expect(
      env.rooms.move(HOST, id, { version: running.version, move: { take: 1 } }),
    ).rejects.toMatchObject({ code: 'ARCADE_ROOM_VERSION_CONFLICT' });
  });

  it('lässt Chat die Version unverändert', async () => {
    const env = aufbau();
    const id = await volleLobby(env);
    const running = await env.rooms.start(HOST, id);

    const mitChat = await env.rooms.chat(MIT, id, { text: '  Viel Glück!  ' });

    expect(mitChat.version).toBe(running.version);
    expect(mitChat.chat).toEqual([
      expect.objectContaining({ userId: 'mit', displayName: 'Grace', text: 'Viel Glück!' }),
    ]);
    await expect(
      env.rooms.move(HOST, id, { version: running.version, move: { take: 1 } }),
    ).resolves.toBeDefined();
  });

  it('meldet Regelverstöße mit der Meldung der Regeln und den falschen Sitz', async () => {
    const env = aufbau();
    const id = await volleLobby(env);
    const running = await env.rooms.start(HOST, id);

    await expect(
      env.rooms.move(MIT, id, { version: running.version, move: { take: 1 } }),
    ).rejects.toMatchObject({ code: 'ARCADE_NOT_YOUR_TURN' });
    await expect(
      env.rooms.move(HOST, id, { version: running.version, move: { take: 5 } }),
    ).rejects.toMatchObject({
      code: 'ARCADE_MOVE_INVALID',
      message: 'Dieser Zug ist nicht lesbar.',
    });
  });

  it('beendet die Partie und trägt nur den menschlichen Sieger ein', async () => {
    const env = aufbau();
    const room = await env.rooms.create(HOST, {
      gameId: 'vier-gewinnt',
      seatCount: 2,
      isPrivate: false,
      options: { stones: 2 },
    });
    await env.rooms.join(MIT, room.id, {});
    const running = await env.rooms.start(HOST, room.id);

    const ende = await env.rooms.move(HOST, room.id, {
      version: running.version,
      move: { take: 2 },
    });

    expect(ende.status).toBe('finished');
    expect(ende.outcome).toMatchObject({ winners: [0] });
    expect(env.ergebnisse).toEqual([{ userId: 'host', gameId: 'vier-gewinnt', score: 1 }]);
    expect(ende.permissions.canRematch).toBe(true);

    const neu = await env.rooms.rematch(HOST, room.id);
    expect(neu.status).toBe('running');
    expect(neu.outcome).toBeNull();
  });

  it('trägt bei Punktespielen den Stand jedes Menschen ein', async () => {
    const env = aufbau();
    const room = await env.rooms.create(HOST, {
      gameId: 'kniffel',
      seatCount: 2,
      isPrivate: false,
      options: { stones: 3 },
    });
    await env.rooms.join(MIT, room.id, {});
    let stand = await env.rooms.start(HOST, room.id);
    stand = await env.rooms.move(HOST, room.id, { version: stand.version, move: { take: 2 } });
    stand = await env.rooms.move(MIT, room.id, { version: stand.version, move: { take: 1 } });

    expect(stand.status).toBe('finished');
    expect(env.ergebnisse).toEqual([
      { userId: 'host', gameId: 'kniffel', score: 2 },
      { userId: 'mit', gameId: 'kniffel', score: 1 },
    ]);
  });
});

describe('Verlassen', () => {
  it('reicht die Gastgeberrolle in der Lobby weiter und schließt den leeren Raum', async () => {
    const env = aufbau();
    const id = await volleLobby(env);

    const nachHost = await env.rooms.leave(HOST, id);
    expect(nachHost.hostUserId).toBe('mit');
    expect(nachHost.seats[0]?.kind).toBe('open');

    const leer = await env.rooms.leave(MIT, id);
    expect(leer.status).toBe('closed');
  });

  it('setzt im laufenden Spiel einen Computer auf den Platz', async () => {
    const env = aufbau();
    const id = await volleLobby(env);
    await env.rooms.start(HOST, id);
    env.geplant.length = 0;

    // Sitz 0 ist am Zug; verlässt er den Raum, zieht jetzt der Computer.
    const nach = await env.rooms.leave(HOST, id);

    expect(nach.seats[0]).toMatchObject({ kind: 'bot', botLevel: 'mittel' });
    expect(nach.hostUserId).toBe('mit');
    expect(env.geplant).toEqual([id]);
  });

  it('bricht ohne Computergegner die Partie ab', async () => {
    const ohneBot = nimGame('vier-gewinnt');
    delete ohneBot.bot;
    const env = aufbau(miniRegistry({ 'vier-gewinnt': ohneBot }));
    const id = await volleLobby(env);
    await env.rooms.start(HOST, id);

    const nach = await env.rooms.leave(MIT, id);

    expect(nach.status).toBe('finished');
    expect(nach.outcome).toMatchObject({ winners: [], summary: expect.stringContaining('Grace') });
    expect(env.ergebnisse).toEqual([]);
  });
});

describe('Bot-Läufer', () => {
  it('lässt den Computer nach einer Pause ziehen, bis ein Mensch dran ist', async () => {
    vi.useFakeTimers();
    const env = aufbau();
    const runner = createArcadeBotRunner({
      step: (roomId) => env.rooms.botStep(roomId),
      delayMs: 900,
    });
    const room = await env.rooms.create(HOST, {
      gameId: 'vier-gewinnt',
      seatCount: 2,
      isPrivate: false,
    });
    await env.rooms.setSeat(HOST, room.id, { seat: 1, kind: 'bot', botLevel: 'leicht' });
    let stand = await env.rooms.start(HOST, room.id);

    stand = await env.rooms.move(HOST, room.id, { version: stand.version, move: { take: 1 } });
    expect(stand.view).toMatchObject({ stones: 6, current: 1 });

    runner.schedule(room.id);
    runner.schedule(room.id); // doppelt geplant – nur ein Zug
    await vi.advanceTimersByTimeAsync(899);
    expect((await env.rooms.get(HOST, room.id)).view).toMatchObject({ stones: 6 });

    await vi.advanceTimersByTimeAsync(1);
    await vi.runOnlyPendingTimersAsync();

    const nachBot = await env.rooms.get(HOST, room.id);
    // 6 mod 3 = 0 → der Bot nimmt einen Stein, danach ist der Mensch dran.
    expect(nachBot.view).toMatchObject({ stones: 5, current: 0 });
    expect(nachBot.version).toBe(stand.version + 1);
    expect(runner.isScheduled(room.id)).toBe(false);
    runner.stop();
  });

  it('beendet die Partie, wenn der Computer einen illegalen Zug liefert', async () => {
    vi.useFakeTimers();
    const kaputt = nimGame('vier-gewinnt', { bot: () => ({ take: 2 }) });
    const env = aufbau(miniRegistry({ 'vier-gewinnt': kaputt }));
    const runner = createArcadeBotRunner({ step: (roomId) => env.rooms.botStep(roomId) });
    const room = await env.rooms.create(HOST, {
      gameId: 'vier-gewinnt',
      seatCount: 2,
      isPrivate: false,
      options: { stones: 2 },
    });
    await env.rooms.setSeat(HOST, room.id, { seat: 1, kind: 'bot' });
    const stand = await env.rooms.start(HOST, room.id);
    await env.rooms.move(HOST, room.id, { version: stand.version, move: { take: 1 } });

    runner.schedule(room.id);
    await vi.advanceTimersByTimeAsync(1000);

    const ende = await env.rooms.get(HOST, room.id);
    expect(ende.status).toBe('finished');
    expect(ende.outcome).toMatchObject({ winners: [] });
    expect(ende.log.at(-1)?.text).toMatch(/abgebrochen/);
    runner.stop();
  });

  it('setzt beim Pflegelauf Räume mit Computer am Zug fort', async () => {
    const env = aufbau();
    const room = await env.rooms.create(HOST, {
      gameId: 'vier-gewinnt',
      seatCount: 2,
      isPrivate: false,
    });
    await env.rooms.setSeat(HOST, room.id, { seat: 1, kind: 'bot' });
    const stand = await env.rooms.start(HOST, room.id);
    await env.rooms.move(HOST, room.id, { version: stand.version, move: { take: 1 } });
    env.geplant.length = 0;

    await env.rooms.maintain();

    expect(env.geplant).toEqual([room.id]);
  });
});
