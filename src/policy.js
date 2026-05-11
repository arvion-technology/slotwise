/**
 * Cancellation and reschedule policy.
 *
 * The policy is a list of tiers ordered by hours before the appointment. The
 * tier with the largest threshold the booking still clears applies, which is
 * the opposite of the usual "first match wins" bug: a booking 72 hours out must
 * find the free tier even though a 24-hour tier also matches.
 *
 * Money is integer minor units. The percentage is basis points, so 50% is 5000
 * and no float ever touches the refund.
 */

import { MINUTE } from "./timezone.js";

export const DEFAULT_POLICY = Object.freeze({
  currency: "USD",
  tiers: [
    { hoursBefore: 48, feeBasisPoints: 0, label: "Free cancellation" },
    { hoursBefore: 24, feeBasisPoints: 5000, label: "Half the fee" },
    { hoursBefore: 0, feeBasisPoints: 10000, label: "Full fee" },
  ],
  rescheduleMinHours: 24,
  noShowFeeBasisPoints: 10000,
});

function roundBasisPoints(amountMinor, basisPoints) {
  return Math.round((amountMinor * basisPoints) / 10_000);
}

function tierFor(hoursUntilStart, policy) {
  const tiers = [...policy.tiers].sort((a, b) => b.hoursBefore - a.hoursBefore);
  return tiers.find((tier) => hoursUntilStart >= tier.hoursBefore) || tiers[tiers.length - 1];
}

/** Tier table in display order, derived from the policy. */
export function policyTable(policy = DEFAULT_POLICY) {
  return [...policy.tiers]
    .sort((a, b) => b.hoursBefore - a.hoursBefore)
    .map((tier) => ({
      ...tier,
      feePercent: tier.feeBasisPoints / 100,
      window: tier.hoursBefore === 0 ? "Less than 24 hours" : `${tier.hoursBefore}+ hours before`,
    }));
}

/**
 * Quote a cancellation against the clock.
 * @returns {{allowed:boolean, tier:object|null, hoursUntilStart:number,
 *            feeBasisPoints:number, feePercent:number, feeMinor:number,
 *            refundMinor:number, priceMinor:number, reason:string}}
 */
export function cancellationQuote({ start, now = Date.now(), priceMinor, policy = DEFAULT_POLICY }) {
  if (!Number.isInteger(priceMinor) || priceMinor < 0) throw new RangeError("priceMinor must be a non-negative integer");
  const hoursUntilStart = (start - now) / (60 * MINUTE);
  if (hoursUntilStart < 0) {
    return {
      allowed: false,
      tier: null,
      hoursUntilStart,
      feeBasisPoints: policy.noShowFeeBasisPoints,
      feePercent: policy.noShowFeeBasisPoints / 100,
      feeMinor: priceMinor,
      refundMinor: 0,
      priceMinor,
      reason: "This booking has already started. Contact the studio to discuss a no-show.",
    };
  }
  const tier = tierFor(hoursUntilStart, policy);
  const feeMinor = roundBasisPoints(priceMinor, tier.feeBasisPoints);
  return {
    allowed: true,
    tier,
    hoursUntilStart,
    feeBasisPoints: tier.feeBasisPoints,
    feePercent: tier.feeBasisPoints / 100,
    feeMinor,
    refundMinor: priceMinor - feeMinor,
    priceMinor,
    reason: tier.label,
  };
}

/** Rescheduling is a separate window with its own minimum notice. */
export function rescheduleQuote({ start, now = Date.now(), policy = DEFAULT_POLICY }) {
  const hoursUntilStart = (start - now) / (60 * MINUTE);
  const allowed = hoursUntilStart >= policy.rescheduleMinHours;
  return {
    allowed,
    hoursUntilStart,
    minHours: policy.rescheduleMinHours,
    reason: allowed
      ? "You can move this booking to another available slot."
      : `Reschedules need at least ${policy.rescheduleMinHours} hours of notice.`,
  };
}
