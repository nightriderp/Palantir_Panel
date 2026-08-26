import { describe, expect, it } from 'vitest';
import { createRateLimiter, rateLimitKey } from './rate-limit.js';

const NOW = 1_700_000_000_000;

describe('IP-Rate-Limit (Pflichtenheft §7, §18)', () => {
  it('lässt genau so viele Versuche zu wie erlaubt', () => {
    const limiter = createRateLimiter({ windowSeconds: 60, maxAttempts: 3 });

    expect(limiter.consume('a', NOW).allowed).toBe(true);
    expect(limiter.consume('a', NOW).allowed).toBe(true);
    expect(limiter.consume('a', NOW).remaining).toBe(0);
    expect(limiter.consume('a', NOW).allowed).toBe(false);
  });

  it('nennt, wie lange bis zum nächsten Versuch gewartet werden muss', () => {
    const limiter = createRateLimiter({ windowSeconds: 60, maxAttempts: 1 });

    limiter.consume('a', NOW);

    const blocked = limiter.consume('a', NOW + 10_000);

    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(50);
  });

  it('gibt nach Ablauf des Fensters wieder frei (gleitendes Fenster)', () => {
    const limiter = createRateLimiter({ windowSeconds: 60, maxAttempts: 2 });

    limiter.consume('a', NOW);
    limiter.consume('a', NOW + 30_000);

    expect(limiter.consume('a', NOW + 40_000).allowed).toBe(false);
    // Der erste Versuch ist jetzt aus dem Fenster gefallen, der zweite noch nicht.
    expect(limiter.consume('a', NOW + 61_000).allowed).toBe(true);
  });

  it('zählt je Schlüssel getrennt', () => {
    const limiter = createRateLimiter({ windowSeconds: 60, maxAttempts: 1 });

    limiter.consume(rateLimitKey('login', '203.0.113.1'), NOW);

    expect(limiter.consume(rateLimitKey('login', '203.0.113.2'), NOW).allowed).toBe(true);
    // Anderer Vorgang, gleiche IP: eigenes Kontingent.
    expect(limiter.consume(rateLimitKey('register', '203.0.113.1'), NOW).allowed).toBe(true);
    expect(limiter.consume(rateLimitKey('login', '203.0.113.1'), NOW).allowed).toBe(false);
  });

  it('setzt einen Schlüssel auf Wunsch zurück (nach erfolgreichem Login)', () => {
    const limiter = createRateLimiter({ windowSeconds: 60, maxAttempts: 1 });

    limiter.consume('a', NOW);
    limiter.reset('a');

    expect(limiter.consume('a', NOW).allowed).toBe(true);
  });

  it('räumt abgelaufene Einträge auf', () => {
    const limiter = createRateLimiter({ windowSeconds: 60, maxAttempts: 1 });

    limiter.consume('a', NOW);
    limiter.sweep(NOW + 120_000);

    expect(limiter.consume('a', NOW + 120_000).allowed).toBe(true);
  });
});
