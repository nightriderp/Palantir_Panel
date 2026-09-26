import { type SeatController } from '@palantir/arcade';
import { describe, expect, it } from 'vitest';
import {
  activeHumanSeats,
  botDelayMs,
  chooseViewSeat,
  humanSeats,
  needsCurtain,
  rankingDecision,
} from './hostLogic';

const H: SeatController = { type: 'human' };
const B: SeatController = { type: 'bot', level: 'mittel' };

describe('chooseViewSeat', () => {
  it('zeigt den einen aktiven Menschen', () => {
    expect(
      chooseViewSeat({ seats: [H, H], activeSeats: [1], lastHumanSeat: 0, selectedSeat: null }),
    ).toBe(1);
  });

  it('behält den letzten Menschen, während ein Bot denkt', () => {
    expect(
      chooseViewSeat({ seats: [B, H, B], activeSeats: [2], lastHumanSeat: 1, selectedSeat: null }),
    ).toBe(1);
  });

  it('nimmt ohne Vorgeschichte den ersten Menschen', () => {
    expect(
      chooseViewSeat({ seats: [B, H], activeSeats: [0], lastHumanSeat: null, selectedSeat: null }),
    ).toBe(1);
  });

  it('folgt bei mehreren aktiven Menschen der Auswahl', () => {
    const seats = [H, H, H, H];
    expect(chooseViewSeat({ seats, activeSeats: [1, 3], lastHumanSeat: 0, selectedSeat: 3 })).toBe(
      3,
    );
    // Eine Auswahl, die gerade nicht dran ist, zählt nicht.
    expect(chooseViewSeat({ seats, activeSeats: [1, 3], lastHumanSeat: 0, selectedSeat: 2 })).toBe(
      1,
    );
  });

  it('bleibt bei mehreren aktiven Menschen beim zuletzt ziehenden', () => {
    const seats = [H, H, H];
    expect(
      chooseViewSeat({ seats, activeSeats: [0, 1, 2], lastHumanSeat: 2, selectedSeat: null }),
    ).toBe(2);
    // Die bewusste Auswahl geht vor.
    expect(
      chooseViewSeat({ seats, activeSeats: [0, 1, 2], lastHumanSeat: 2, selectedSeat: 1 }),
    ).toBe(1);
  });

  it('ignoriert aktive Bots neben einem aktiven Menschen', () => {
    expect(
      chooseViewSeat({
        seats: [B, H],
        activeSeats: [0, 1],
        lastHumanSeat: null,
        selectedSeat: null,
      }),
    ).toBe(1);
    expect(activeHumanSeats([B, H], [0, 1])).toEqual([1]);
  });
});

describe('needsCurtain', () => {
  const basis = {
    hiddenInformation: true,
    seats: [H, H],
    revealedSeat: 0,
    viewSeat: 1,
    finished: false,
  };

  it('verdeckt beim Wechsel zwischen zwei Menschen', () => {
    expect(needsCurtain(basis)).toBe(true);
  });

  it('verdeckt auch vor dem allerersten Aufdecken', () => {
    expect(needsCurtain({ ...basis, revealedSeat: null, viewSeat: 0 })).toBe(true);
  });

  it('nicht, wenn der Sitz schon aufgedeckt ist', () => {
    expect(needsCurtain({ ...basis, revealedSeat: 1 })).toBe(false);
  });

  it('nicht bei offenen Spielen', () => {
    expect(needsCurtain({ ...basis, hiddenInformation: false })).toBe(false);
  });

  it('nicht bei einem Menschen gegen Bots', () => {
    expect(needsCurtain({ ...basis, seats: [H, B], revealedSeat: null, viewSeat: 0 })).toBe(false);
  });

  it('nicht nach dem Ende', () => {
    expect(needsCurtain({ ...basis, finished: true })).toBe(false);
  });
});

describe('rankingDecision', () => {
  const sieg = { winners: [0], summary: '' };

  it('wertet einen Sieg des einzigen Menschen', () => {
    expect(
      rankingDecision({ seats: [H, B], metric: 'wins', outcome: sieg, hasSeed: true }),
    ).toEqual({
      submit: true,
      humanSeat: 0,
    });
  });

  it('reicht Niederlagen bei Siegwertung nicht ein', () => {
    expect(
      rankingDecision({ seats: [B, H], metric: 'wins', outcome: sieg, hasSeed: true }),
    ).toEqual({
      submit: false,
      reason: 'nicht-gewonnen',
    });
  });

  it('wertet bei Punkten jede beendete Partie', () => {
    expect(
      rankingDecision({
        seats: [H],
        metric: 'score',
        outcome: { winners: [], summary: '' },
        hasSeed: true,
      }),
    ).toEqual({
      submit: true,
      humanSeat: 0,
    });
  });

  it('wertet nichts mit mehreren Menschen', () => {
    expect(
      rankingDecision({ seats: [H, H], metric: 'wins', outcome: sieg, hasSeed: true }),
    ).toEqual({
      submit: false,
      reason: 'mehrere-menschen',
    });
  });

  it('wertet nichts ohne Startwert', () => {
    expect(
      rankingDecision({ seats: [H, B], metric: 'wins', outcome: sieg, hasSeed: false }),
    ).toEqual({
      submit: false,
      reason: 'kein-startwert',
    });
  });
});

describe('Hilfen', () => {
  it('findet die Menschen', () => {
    expect(humanSeats([B, H, B, H])).toEqual([1, 3]);
  });

  it('wartet 600–900 ms je Bot-Zug', () => {
    expect(botDelayMs(0)).toBe(600);
    expect(botDelayMs(1)).toBe(900);
    expect(botDelayMs(5)).toBe(900);
  });
});
