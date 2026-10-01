import { describe, expect, it } from 'vitest';

import { evaluateBudget } from './budget';

describe('budget guardrails', () => {
  it('permits a request exactly at the monthly cap', () => {
    expect(
      evaluateBudget({
        monthlySpend: 9,
        activeReservations: 0,
        requestedCost: 1,
        monthlyCap: 10,
        perRunCap: null,
      }),
    ).toMatchObject({ allowed: true, reason: 'reserved' });
  });

  it('blocks the smallest amount above the monthly cap', () => {
    expect(
      evaluateBudget({
        monthlySpend: 9.9999,
        activeReservations: 0,
        requestedCost: 0.0001,
        monthlyCap: 10,
        perRunCap: null,
      }),
    ).toMatchObject({ allowed: true });
    expect(
      evaluateBudget({
        monthlySpend: 9.9999,
        activeReservations: 0,
        requestedCost: 0.0002,
        monthlyCap: 10,
        perRunCap: null,
      }),
    ).toMatchObject({ allowed: false, reason: 'monthly_cap_exceeded' });
  });

  it('counts active reservations before permitting another request', () => {
    expect(
      evaluateBudget({
        monthlySpend: 5,
        activeReservations: 4,
        requestedCost: 2,
        monthlyCap: 10,
        perRunCap: null,
      }),
    ).toMatchObject({ allowed: false, reason: 'monthly_cap_exceeded' });
  });
});
