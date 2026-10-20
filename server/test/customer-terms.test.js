const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_CUSTOMER_TERMS,
  normalizeCustomerTermsClauses,
  readCustomerTerms,
  updateCustomerTerms,
  customerNeedsTermsAcceptance,
  validateOrderTermsAcknowledgement
} = require("../src/customer-terms");

test("customer terms updates increment only when the clauses change", () => {
  const current = readCustomerTerms("");
  assert.deepEqual(updateCustomerTerms(current, current.clauses), { ...current, changed: false });
  assert.deepEqual(updateCustomerTerms(current, ["New clause"]), { version: "2", clauses: ["New clause"], changed: true });
});

test("customer terms validation enforces a bounded non-empty list", () => {
  assert.throws(() => normalizeCustomerTermsClauses([]), /between 1 and 30/i);
  assert.throws(() => normalizeCustomerTermsClauses(["x".repeat(1001)]), /1000 characters/i);
  assert.equal(readCustomerTerms("").clauses.length, DEFAULT_CUSTOMER_TERMS.clauses.length);
});

test("customers acknowledge a terms version once and must re-acknowledge after an update", () => {
  const user = { customerTermsVersion: "1", customerTermsAcceptedAt: new Date("2026-10-01T00:00:00Z") };
  const initialTerms = { version: "1", clauses: ["First"] };
  const updatedTerms = { version: "2", clauses: ["Changed"] };

  assert.equal(customerNeedsTermsAcceptance(user, initialTerms), false);
  assert.equal(validateOrderTermsAcknowledgement(user, {}, initialTerms), user.customerTermsAcceptedAt);
  assert.equal(customerNeedsTermsAcceptance(user, updatedTerms), true);
  assert.throws(() => validateOrderTermsAcknowledgement(user, {}, updatedTerms), { status: 409 });
  assert.ok(validateOrderTermsAcknowledgement(user, { customerTermsVersion: "2", customerTermsAccepted: true }, updatedTerms) instanceof Date);
});