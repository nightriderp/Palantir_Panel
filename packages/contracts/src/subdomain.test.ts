import { describe, expect, it } from 'vitest';
import { RESERVED_SUBDOMAINS, isReservedSubdomain } from './subdomain.js';

describe('RESERVED_SUBDOMAINS', () => {
  it('enthält die im Pflichtenheft §13 genannten Namen', () => {
    for (const name of ['www', 'api', 'admin', 'vpn', 'mail']) {
      expect(RESERVED_SUBDOMAINS).toContain(name);
    }
  });

  it('führt jeden Namen nur einmal und durchgängig klein', () => {
    expect(new Set(RESERVED_SUBDOMAINS).size).toBe(RESERVED_SUBDOMAINS.length);
    for (const name of RESERVED_SUBDOMAINS) {
      expect(name).toBe(name.toLowerCase());
    }
  });
});

describe('isReservedSubdomain', () => {
  it('erkennt reservierte Namen unabhängig von der Schreibweise', () => {
    expect(isReservedSubdomain('admin')).toBe(true);
    expect(isReservedSubdomain('ADMIN')).toBe(true);
    expect(isReservedSubdomain('Admin')).toBe(true);
  });

  it('lässt gewöhnliche Namen durch', () => {
    expect(isReservedSubdomain('survival')).toBe(false);
    expect(isReservedSubdomain('admin-welt')).toBe(false);
  });
});
