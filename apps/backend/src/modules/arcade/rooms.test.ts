/**
 * Rechte im Online-Raum (Pflichtenheft §5.2) als Tabelle:
 * Gastgeber / Mitspieler / Fremder / Admin × Status × Aktion.
 *
 * `roomPermissions` ist die eine Stelle, aus der DTO und Dienst lesen – ist
 * die Tabelle hier richtig, stimmen Oberfläche und Prüfung überein.
 */

import { type ArcadeRoomPermissions, type ArcadeRoomStatus } from '@palantir/contracts';
import { createMatch } from '@palantir/arcade';
import { describe, expect, it } from 'vitest';
import {
  ARCADE_ROOM_CODE_ALPHABET,
  type ArcadeRoom,
  type RoomViewer,
  generateRoomCode,
  roomPermissions,
  toRoomDto,
} from './rooms.js';
import { nimGame } from './test-support.js';

const HOST = 'host';
const MIT = 'mitspieler';
const FREMD = 'fremder';
const game = nimGame('vier-gewinnt');

function raum(status: ArcadeRoomStatus, offenerSitz = false): ArcadeRoom {
  const seats: ArcadeRoom['seats'] = [
    { kind: 'human', userId: HOST, botLevel: null },
    offenerSitz
      ? { kind: 'open', userId: null, botLevel: null }
      : { kind: 'human', userId: MIT, botLevel: null },
  ];
  const match =
    status === 'lobby'
      ? null
      : createMatch(game, 1, { stones: status === 'finished' ? 0 : 7 }, [
          { type: 'human' },
          { type: 'human' },
        ]);

  return {
    id: 'r1',
    code: 'ABCDEF',
    gameId: 'vier-gewinnt',
    hostUserId: HOST,
    status,
    isPrivate: false,
    seats,
    options: { stones: 7 },
    match: status === 'finished' && match ? { ...match, aborted: { summary: 'x' } } : match,
    version: 3,
    chat: [],
    createdAt: new Date(0),
    updatedAt: new Date(0),
    finishedAt: null,
  };
}

function viewer(userId: string, isAdmin = false): RoomViewer {
  return { userId, displayName: userId, isAdmin };
}

type Flag = keyof ArcadeRoomPermissions;
const FLAGS: Flag[] = [
  'canJoin',
  'canLeave',
  'canStart',
  'canManageSeats',
  'canMove',
  'canChat',
  'canClose',
  'canRematch',
];

/** Erwartete wahre Rechte je Rolle und Status (alle anderen falsch). */
const TABELLE: [string, RoomViewer, ArcadeRoomStatus, boolean, Flag[]][] = [
  // Lobby, alle Plätze belegt
  [
    'Gastgeber',
    viewer(HOST),
    'lobby',
    false,
    ['canLeave', 'canStart', 'canManageSeats', 'canChat', 'canClose'],
  ],
  ['Mitspieler', viewer(MIT), 'lobby', false, ['canLeave', 'canChat']],
  ['Fremder', viewer(FREMD), 'lobby', false, []],
  ['Admin', viewer(FREMD, true), 'lobby', false, ['canClose']],
  // Lobby mit freiem Platz: Fremde dürfen beitreten, Start geht nicht
  ['Gastgeber', viewer(HOST), 'lobby', true, ['canLeave', 'canManageSeats', 'canChat', 'canClose']],
  ['Fremder', viewer(FREMD), 'lobby', true, ['canJoin']],
  // Laufend: Sitz 0 (Gastgeber) ist am Zug
  ['Gastgeber', viewer(HOST), 'running', false, ['canLeave', 'canMove', 'canChat', 'canClose']],
  ['Mitspieler', viewer(MIT), 'running', false, ['canLeave', 'canChat']],
  ['Fremder', viewer(FREMD), 'running', false, []],
  // Beendet
  ['Gastgeber', viewer(HOST), 'finished', false, ['canChat', 'canClose', 'canRematch']],
  ['Mitspieler', viewer(MIT), 'finished', false, ['canChat']],
  ['Fremder', viewer(FREMD), 'finished', false, []],
  ['Admin', viewer(FREMD, true), 'finished', false, ['canClose']],
  // Geschlossen: niemand darf etwas
  ['Gastgeber', viewer(HOST), 'closed', false, []],
];

describe('Rechte im Raum', () => {
  it.each(TABELLE)('%s im Status %s (freier Platz: %s)', (_rolle, wer, status, offen, erwartet) => {
    const rechte = roomPermissions(raum(status, offen), wer, game);

    for (const flag of FLAGS) {
      expect({ flag, wert: rechte[flag] }).toEqual({ flag, wert: erwartet.includes(flag) });
    }
  });
});

describe('Raum-DTO', () => {
  it('zeigt jedem nur die Sicht seines Sitzes und Zuschauern die Zuschauersicht', () => {
    const room = raum('running');
    const ctx = { game, profiles: new Map(), isOnline: () => false };

    expect(toRoomDto(room, { ...ctx, viewer: viewer(MIT) }).view).toMatchObject({ seat: 1 });
    expect(toRoomDto(room, { ...ctx, viewer: viewer(FREMD) }).view).toMatchObject({ seat: null });
    expect(toRoomDto(room, { ...ctx, viewer: viewer(MIT) }).mySeat).toBe(1);
  });

  it('nennt Computergegner mit Stufe', () => {
    const room = raum('lobby');
    room.seats[1] = { kind: 'bot', userId: null, botLevel: 'schwer' };

    const dto = toRoomDto(room, {
      game,
      viewer: viewer(HOST),
      profiles: new Map(),
      isOnline: () => true,
    });

    expect(dto.seats[1]).toMatchObject({
      kind: 'bot',
      displayName: 'Computer (Schwer)',
      online: false,
    });
    expect(dto.seats[0]).toMatchObject({ kind: 'human', isCurrentUser: true, online: true });
  });
});

describe('Beitrittscode', () => {
  it('hat sechs Zeichen aus dem Alphabet ohne Verwechsler', () => {
    let i = 0;
    const code = generateRoomCode((max) => (i++ * 7) % max);

    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(ARCADE_ROOM_CODE_ALPHABET).not.toMatch(/[01IO]/);
  });
});
