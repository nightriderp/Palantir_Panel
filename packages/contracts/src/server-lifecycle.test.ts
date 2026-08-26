import { describe, expect, it } from 'vitest';
import {
  FAULTED_SERVER_STATUSES,
  SERVER_STATUSES,
  SERVER_STATUS_TRANSITIONS,
  TRANSITIONAL_SERVER_STATUSES,
  allowedServerStatusTransitions,
  isAllowedServerStatusTransition,
  isFaultedServerStatus,
  isServerStatus,
  isTransitionalServerStatus,
} from './server-lifecycle.js';

describe('Server-Lifecycle-Zustände (Pflichtenheft §9)', () => {
  it('enthält genau die im Pflichtenheft genannten Zustände', () => {
    expect([...SERVER_STATUSES]).toEqual([
      'creating',
      'stopped',
      'starting',
      'running',
      'stopping',
      'error',
      'crashed',
    ]);
  });

  it('teilt die Zustände überschneidungsfrei in Zwischen- und Störungszustände', () => {
    for (const status of TRANSITIONAL_SERVER_STATUSES) {
      expect(isTransitionalServerStatus(status)).toBe(true);
      expect(isFaultedServerStatus(status)).toBe(false);
    }

    for (const status of FAULTED_SERVER_STATUSES) {
      expect(isFaultedServerStatus(status)).toBe(true);
      expect(isTransitionalServerStatus(status)).toBe(false);
    }
  });

  it('isServerStatus() erkennt unbekannte Zustände', () => {
    expect(isServerStatus('running')).toBe(true);
    expect(isServerStatus('paused')).toBe(false);
  });
});

describe('Zustandsübergänge (Pflichtenheft §9)', () => {
  it('kennt für jeden Zustand einen Eintrag', () => {
    for (const status of SERVER_STATUSES) {
      expect(SERVER_STATUS_TRANSITIONS[status]).toBeDefined();
    }
  });

  it('nennt als Ziel ausschließlich gültige Zustände und nie sich selbst', () => {
    for (const status of SERVER_STATUSES) {
      for (const target of allowedServerStatusTransitions(status)) {
        expect(isServerStatus(target)).toBe(true);
        expect(target).not.toBe(status);
      }
    }
  });

  it('bildet die Hauptfolge creating → stopped → starting → running → stopping → stopped ab', () => {
    expect(isAllowedServerStatusTransition('creating', 'stopped')).toBe(true);
    expect(isAllowedServerStatusTransition('stopped', 'starting')).toBe(true);
    expect(isAllowedServerStatusTransition('starting', 'running')).toBe(true);
    expect(isAllowedServerStatusTransition('running', 'stopping')).toBe(true);
    expect(isAllowedServerStatusTransition('stopping', 'stopped')).toBe(true);
  });

  it('verbietet den Sprung von stopped direkt nach running (Health-Check-Pflicht)', () => {
    expect(isAllowedServerStatusTransition('stopped', 'running')).toBe(false);
    expect(isAllowedServerStatusTransition('creating', 'running')).toBe(false);
    expect(isAllowedServerStatusTransition('crashed', 'running')).toBe(false);
  });

  it('erlaubt den automatischen Neustart-Versuch crashed → starting', () => {
    expect(isAllowedServerStatusTransition('crashed', 'starting')).toBe(true);
  });

  it('erlaubt crashed → error, wenn der Crash-Loop-Schutz abschaltet', () => {
    expect(isAllowedServerStatusTransition('crashed', 'error')).toBe(true);
  });

  it('lässt einen Server im Fehlerzustand erneut starten', () => {
    expect(isAllowedServerStatusTransition('error', 'starting')).toBe(true);
    expect(isAllowedServerStatusTransition('error', 'stopped')).toBe(true);
  });

  it('kennt keinen Weg zurück nach creating', () => {
    for (const status of SERVER_STATUSES) {
      expect(isAllowedServerStatusTransition(status, 'creating')).toBe(false);
    }
  });
});
