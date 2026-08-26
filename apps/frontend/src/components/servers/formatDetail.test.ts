import { describe, expect, it } from 'vitest';
import { describeCron, formatBytes, formatDuration } from './formatDetail';

describe('formatBytes', () => {
  it('meldet „—" statt „0 B" bei fehlender Angabe', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(undefined)).toBe('—');
  });

  it('rechnet mit Basis 1024 und rundet auf eine Nachkommastelle', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1,5 KB');
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
    expect(formatBytes(1024 ** 3)).toBe('1 GB');
    expect(formatBytes(1024 ** 4)).toBe('1 TB');
  });

  it('bleibt bei sehr großen Werten bei TB', () => {
    expect(formatBytes(5 * 1024 ** 4)).toBe('5 TB');
  });
});

describe('formatDuration', () => {
  it('meldet „—" bei fehlender oder negativer Angabe', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(-5)).toBe('—');
  });

  it('wählt die passende Einheit', () => {
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(120)).toBe('2 min');
    expect(formatDuration(3600 * 2 + 60 * 15)).toBe('2 h 15 min');
    expect(formatDuration(86400 * 3 + 3600 * 4)).toBe('3 d 4 h');
  });
});

describe('describeCron', () => {
  it('erkennt tägliche Ausführung', () => {
    expect(describeCron('0 4 * * *')).toBe('täglich um 04:00 Uhr');
    expect(describeCron('30 22 * * *')).toBe('täglich um 22:30 Uhr');
  });

  it('erkennt einen festen Wochentag', () => {
    expect(describeCron('0 3 * * 1')).toBe('montags um 03:00 Uhr');
    expect(describeCron('15 6 * * 0')).toBe('sonntags um 06:15 Uhr');
  });

  it('erkennt stündliche und minütliche Muster', () => {
    expect(describeCron('0 * * * *')).toBe('stündlich zur Minute 0');
    expect(describeCron('*/15 * * * *')).toBe('alle 15 Minuten');
  });

  it('lässt unbekannte Muster unverändert stehen', () => {
    expect(describeCron('0 4 1,15 * *')).toBe('0 4 1,15 * *');
    expect(describeCron('unsinn')).toBe('unsinn');
    expect(describeCron('0 4 * *')).toBe('0 4 * *');
  });
});
