import test from "node:test";
import assert from "node:assert/strict";

import { cancellationQuote, rescheduleQuote, policyTable, DEFAULT_POLICY } from "../src/policy.js";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 28, 12, 0);
const startIn = (hours) => NOW + hours * HOUR;

test("more than 48 hours out is a free cancellation", () => {
  const quote = cancellationQuote({ start: startIn(72), now: NOW, priceMinor: 24000 });
  assert.equal(quote.allowed, true);
  assert.equal(quote.feeMinor, 0);
  assert.equal(quote.refundMinor, 24000);
  assert.equal(quote.feePercent, 0);
});

test("tier boundaries are inclusive in the customer's favour", () => {
  const free = cancellationQuote({ start: startIn(48), now: NOW, priceMinor: 24000 });
  assert.equal(free.feeMinor, 0, "exactly 48 hours is still free");
  const half = cancellationQuote({ start: startIn(24), now: NOW, priceMinor: 24000 });
  assert.equal(half.feeBasisPoints, 5000);
  assert.equal(half.feeMinor, 12000);
  const full = cancellationQuote({ start: startIn(0), now: NOW, priceMinor: 24000 });
  assert.equal(full.feeBasisPoints, 10000);
  assert.equal(full.refundMinor, 0);
});

test("30 hours out is half the fee, not free", () => {
  const quote = cancellationQuote({ start: startIn(30), now: NOW, priceMinor: 24000 });
  assert.equal(quote.tier.hoursBefore, 24);
  assert.equal(quote.feePercent, 50);
  assert.equal(quote.feeMinor, 12000);
  assert.equal(quote.refundMinor, 12000);
});

test("fees round to a whole minor unit", () => {
  const quote = cancellationQuote({ start: startIn(30), now: NOW, priceMinor: 24001 });
  assert.equal(Number.isInteger(quote.feeMinor), true);
  assert.equal(quote.feeMinor, 12001);
  assert.equal(quote.feeMinor + quote.refundMinor, 24001);
});

test("a booking that has already started is not cancellable online", () => {
  const quote = cancellationQuote({ start: startIn(-2), now: NOW, priceMinor: 24000 });
  assert.equal(quote.allowed, false);
  assert.equal(quote.feeMinor, 24000);
  assert.match(quote.reason, /no-show/);
});

test("custom policies and reschedule windows are respected", () => {
  const policy = {
    currency: "EUR",
    tiers: [
      { hoursBefore: 72, feeBasisPoints: 0, label: "Free" },
      { hoursBefore: 12, feeBasisPoints: 2500, label: "Quarter fee" },
      { hoursBefore: 0, feeBasisPoints: 10000, label: "Full fee" },
    ],
    rescheduleMinHours: 6,
    noShowFeeBasisPoints: 10000,
  };
  assert.equal(cancellationQuote({ start: startIn(60), now: NOW, priceMinor: 10000, policy }).feeMinor, 2500);
  assert.equal(cancellationQuote({ start: startIn(80), now: NOW, priceMinor: 10000, policy }).feeMinor, 0);
  assert.equal(rescheduleQuote({ start: startIn(8), now: NOW, policy }).allowed, true);
  assert.equal(rescheduleQuote({ start: startIn(4), now: NOW, policy }).allowed, false);
  assert.equal(policyTable(policy).length, 3);
  assert.equal(policyTable(DEFAULT_POLICY)[0].window, "48+ hours before");
});

test("invalid prices are rejected rather than silently coerced", () => {
  assert.throws(() => cancellationQuote({ start: startIn(24), now: NOW, priceMinor: 10.5 }), RangeError);
  assert.throws(() => cancellationQuote({ start: startIn(24), now: NOW, priceMinor: -1 }), RangeError);
});
