/**
 * Die Freischaltregel (Lastenheft §3.1/§3.6) – eine Auslegung für B1, B7 und B8.
 *
 * Sie lag zuvor dreifach im Code und lief auseinander: Der Chat wertete nur die
 * Rollen aus und hielt den **Owner ohne Zusatzrolle** deshalb für nicht
 * freigeschaltet – niemand konnte ihm schreiben (Audit W2-2,
 * `backend-community-06`). Genau dieser Fall steht hier fest.
 */

import { GUEST_ROLE_NAME } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { hasNonGuestRole, isApproved, isAwaitingApproval } from './approval.js';

const GAST = { name: GUEST_ROLE_NAME };
const NUTZER = { name: 'Nutzer' };

describe('hasNonGuestRole', () => {
  it('erkennt eine Rolle jenseits der Systemrolle „Gast"', () => {
    expect(hasNonGuestRole([GAST, NUTZER])).toBe(true);
  });

  it('sieht in „Gast" allein keine Freigabe – auch nicht in einer leeren Liste', () => {
    expect(hasNonGuestRole([GAST])).toBe(false);
    expect(hasNonGuestRole([])).toBe(false);
  });
});

describe('isAwaitingApproval', () => {
  it('lässt ein Konto mit ausschließlich der Gast-Rolle warten', () => {
    expect(isAwaitingApproval({ isOwner: false, hasNonGuestRole: false })).toBe(true);
  });

  it('beendet das Warten mit der ersten weiteren Rolle', () => {
    expect(isAwaitingApproval({ isOwner: false, hasNonGuestRole: true })).toBe(false);
  });

  it('lässt den Owner nie warten – er steht außerhalb des Rollensystems', () => {
    expect(isAwaitingApproval({ isOwner: true, hasNonGuestRole: false })).toBe(false);
  });
});

describe('isApproved', () => {
  it('gilt für ein freigegebenes, nicht gesperrtes Konto', () => {
    expect(isApproved({ isOwner: false, banned: false, hasNonGuestRole: true })).toBe(true);
  });

  it('gilt für den Owner auch ohne weitere Rolle (Fundstelle backend-community-06)', () => {
    expect(isApproved({ isOwner: true, banned: false, hasNonGuestRole: false })).toBe(true);
  });

  it('gilt nicht für ein wartendes Konto', () => {
    expect(isApproved({ isOwner: false, banned: false, hasNonGuestRole: false })).toBe(false);
  });

  it('gilt nicht für ein gesperrtes Konto – unabhängig von Rolle und Owner-Status', () => {
    expect(isApproved({ isOwner: false, banned: true, hasNonGuestRole: true })).toBe(false);
    expect(isApproved({ isOwner: true, banned: true, hasNonGuestRole: true })).toBe(false);
  });
});
