// State-machine spec. Pure functions, no I/O.
//
// Spec §6.4 #6: `draft → issued → paid` and `draft|issued → cancelled`.
// No other transitions. The DB trigger enforces the same matrix; this
// module mirrors it so the Nest service layer rejects illegal transitions
// before issuing the UPDATE statement (Plan Task 7 Step 3).

import { canTransitionInvoice, ALLOWED_TRANSITIONS } from './invoice-state';

describe('invoice-state', () => {
  describe('canTransitionInvoice — legal transitions', () => {
    it('draft → issued is legal', () => {
      expect(canTransitionInvoice('draft', 'issued')).toBe(true);
    });
    it('draft → cancelled is legal', () => {
      expect(canTransitionInvoice('draft', 'cancelled')).toBe(true);
    });
    it('issued → paid is legal', () => {
      expect(canTransitionInvoice('issued', 'paid')).toBe(true);
    });
    it('issued → cancelled is legal', () => {
      expect(canTransitionInvoice('issued', 'cancelled')).toBe(true);
    });
  });

  describe('canTransitionInvoice — illegal transitions (must be rejected)', () => {
    it('paid → cancelled is illegal', () => {
      expect(canTransitionInvoice('paid', 'cancelled')).toBe(false);
    });
    it('issued → draft is illegal (no backward transitions)', () => {
      expect(canTransitionInvoice('issued', 'draft')).toBe(false);
    });
    it('paid → draft is illegal', () => {
      expect(canTransitionInvoice('paid', 'draft')).toBe(false);
    });
    it('paid → issued is illegal', () => {
      expect(canTransitionInvoice('paid', 'issued')).toBe(false);
    });
    it('cancelled → issued is illegal (cancelled is terminal)', () => {
      expect(canTransitionInvoice('cancelled', 'issued')).toBe(false);
    });
    it('cancelled → paid is illegal', () => {
      expect(canTransitionInvoice('cancelled', 'paid')).toBe(false);
    });
    it('cancelled → draft is illegal', () => {
      expect(canTransitionInvoice('cancelled', 'draft')).toBe(false);
    });
    it('draft → paid is illegal (must go through issued)', () => {
      expect(canTransitionInvoice('draft', 'paid')).toBe(false);
    });
  });

  describe('ALLOWED_TRANSITIONS matrix mirrors the DB trigger', () => {
    it('paid has no outgoing transitions', () => {
      expect(ALLOWED_TRANSITIONS.paid).toEqual([]);
    });
    it('cancelled has no outgoing transitions', () => {
      expect(ALLOWED_TRANSITIONS.cancelled).toEqual([]);
    });
    it('draft allows issued and cancelled only', () => {
      expect([...ALLOWED_TRANSITIONS.draft].sort()).toEqual(['cancelled', 'issued']);
    });
    it('issued allows paid and cancelled only', () => {
      expect([...ALLOWED_TRANSITIONS.issued].sort()).toEqual(['cancelled', 'paid']);
    });
  });
});