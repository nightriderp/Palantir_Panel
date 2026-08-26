import { describe, expect, it } from 'vitest';
import { INITIAL_RECONNECT_DELAY_MS, MAX_RECONNECT_DELAY_MS, reconnectDelayMs } from './backoff';

describe('reconnectDelayMs', () => {
  it('beginnt bei der Grundwartezeit und verdoppelt sich', () => {
    expect(reconnectDelayMs(0, 0)).toBe(INITIAL_RECONNECT_DELAY_MS);
    expect(reconnectDelayMs(1, 0)).toBe(INITIAL_RECONNECT_DELAY_MS * 2);
    expect(reconnectDelayMs(2, 0)).toBe(INITIAL_RECONNECT_DELAY_MS * 4);
  });

  it('bleibt bei der Obergrenze stehen', () => {
    expect(reconnectDelayMs(20, 0)).toBe(MAX_RECONNECT_DELAY_MS);
    expect(reconnectDelayMs(200, 0)).toBe(MAX_RECONNECT_DELAY_MS);
  });

  it('schlägt höchstens 20 Prozent Zufallsanteil auf', () => {
    expect(reconnectDelayMs(0, 1)).toBe(Math.round(INITIAL_RECONNECT_DELAY_MS * 1.2));
    expect(reconnectDelayMs(0, 0.5)).toBe(Math.round(INITIAL_RECONNECT_DELAY_MS * 1.1));
  });

  it('verträgt unsinnige Eingaben, ohne unter die Grundwartezeit zu fallen', () => {
    expect(reconnectDelayMs(-5, 0)).toBe(INITIAL_RECONNECT_DELAY_MS);
    expect(reconnectDelayMs(0, -1)).toBe(INITIAL_RECONNECT_DELAY_MS);
    expect(reconnectDelayMs(0, 5)).toBe(Math.round(INITIAL_RECONNECT_DELAY_MS * 1.2));
  });
});
