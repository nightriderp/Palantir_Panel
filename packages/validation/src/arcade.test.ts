import { describe, expect, it } from 'vitest';
import {
  arcadeRoomChatInputSchema,
  arcadeRoomCodeSchema,
  arcadeRoomMoveInputSchema,
  createArcadeRoomInputSchema,
  submitArcadeRunInputSchema,
} from './arcade.js';

const SEED_ID = '6f1c2a4e-8d3b-4c7a-9e21-5b0f3d6a7c88';

describe('submitArcadeRunInputSchema', () => {
  it('nimmt ein Echtzeit-Band an', () => {
    const result = submitArcadeRunInputSchema.safeParse({
      gameId: 'kriechpfad',
      seedId: SEED_ID,
      replay: 'AQoA',
    });
    expect(result.success).toBe(true);
  });

  it('nimmt eine Partie gegen den Computer an', () => {
    const result = submitArcadeRunInputSchema.safeParse({
      gameId: 'schach',
      seedId: SEED_ID,
      match: {
        options: {},
        seats: [{ type: 'human' }, { type: 'bot', level: 'mittel' }],
        moves: [{ seat: 0, move: { from: 12, to: 28 } }],
      },
    });
    expect(result.success).toBe(true);
  });

  it('verlangt genau eines von Band und Partie', () => {
    expect(
      submitArcadeRunInputSchema.safeParse({ gameId: 'kriechpfad', seedId: SEED_ID }).success,
    ).toBe(false);
    expect(
      submitArcadeRunInputSchema.safeParse({
        gameId: 'kriechpfad',
        seedId: SEED_ID,
        replay: 'AQoA',
        match: { options: {}, seats: [{ type: 'human' }], moves: [] },
      }).success,
    ).toBe(false);
  });

  it('nimmt den alten Rumpf mit nacktem Punktestand nicht mehr an', () => {
    expect(submitArcadeRunInputSchema.safeParse({ gameId: 'kriechpfad', score: 42 }).success).toBe(
      false,
    );
  });

  it('weist unbekannte Spiele und Bot-Stufen ab', () => {
    expect(
      submitArcadeRunInputSchema.safeParse({ gameId: 'tetris', seedId: SEED_ID, replay: 'AQoA' })
        .success,
    ).toBe(false);
    expect(
      submitArcadeRunInputSchema.safeParse({
        gameId: 'schach',
        seedId: SEED_ID,
        match: { options: {}, seats: [{ type: 'bot', level: 'gott' }], moves: [] },
      }).success,
    ).toBe(false);
  });
});

describe('Raum-Schemas', () => {
  it('begrenzt die Sitzzahl', () => {
    expect(
      createArcadeRoomInputSchema.safeParse({ gameId: 'uno', seatCount: 4, isPrivate: false })
        .success,
    ).toBe(true);
    expect(
      createArcadeRoomInputSchema.safeParse({ gameId: 'uno', seatCount: 11, isPrivate: false })
        .success,
    ).toBe(false);
  });

  it('weist übergroße Züge ab', () => {
    const riesig = { text: 'x'.repeat(10_000) };
    expect(arcadeRoomMoveInputSchema.safeParse({ version: 1, move: riesig }).success).toBe(false);
    expect(arcadeRoomMoveInputSchema.safeParse({ version: 1, move: { a: 1 } }).success).toBe(true);
  });

  it('prüft Chat-Länge und Raumcode', () => {
    expect(arcadeRoomChatInputSchema.safeParse({ text: '   ' }).success).toBe(false);
    expect(arcadeRoomCodeSchema.safeParse('k7qx2m').success).toBe(true);
    expect(arcadeRoomCodeSchema.safeParse('K7QX2O').success).toBe(false);
  });
});
