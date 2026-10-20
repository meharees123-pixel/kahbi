const DEFAULT_CUSTOMER_TERMS = Object.freeze({
  version: "1",
  clauses: Object.freeze([
    "Orders are subject to restaurant and menu availability. The restaurant prepares and delivers your order.",
    "Review the final order total, delivery details, and any promotion before placing your order.",
    "Payment is made directly to the restaurant using the payment method shown at checkout.",
    "Cancellation is subject to the order status and the cancellation window shown by KABHI.",
    "KABHI shares the contact and delivery details you provide with the restaurant to fulfill your order."
  ])
});

function normalizeCustomerTermsClauses(value) {
  if (!Array.isArray(value)) throw new Error("Customer terms must be provided as a list.");
  const clauses = value.map((clause) => String(clause || "").trim()).filter(Boolean);
  if (!clauses.length || clauses.length > 30) throw new Error("Provide between 1 and 30 customer terms.");
  if (clauses.some((clause) => clause.length > 1000)) throw new Error("Each customer term must be 1000 characters or fewer.");
  if (clauses.join("\n").length > 12000) throw new Error("Customer terms must be 12000 characters or fewer in total.");
  return clauses;
}

function readCustomerTerms(value) {
  if (!value) return { version: DEFAULT_CUSTOMER_TERMS.version, clauses: [...DEFAULT_CUSTOMER_TERMS.clauses] };
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed.version !== "string" || !parsed.version || !Array.isArray(parsed.clauses)) {
    throw new Error("Stored customer terms are invalid.");
  }
  return { version: parsed.version, clauses: normalizeCustomerTermsClauses(parsed.clauses) };
}

function updateCustomerTerms(current, clausesInput) {
  const clauses = normalizeCustomerTermsClauses(clausesInput);
  if (JSON.stringify(clauses) === JSON.stringify(current.clauses)) return { ...current, changed: false };
  const currentVersion = Number.parseInt(current.version, 10);
  const version = String((Number.isInteger(currentVersion) && currentVersion >= 1 ? currentVersion : 1) + 1);
  return { version, clauses, changed: true };
}

function customerNeedsTermsAcceptance(user, terms) {
  return !user || user.customerTermsVersion !== terms.version;
}

function validateOrderTermsAcknowledgement(user, body, terms) {
  if (!customerNeedsTermsAcceptance(user, terms)) {
    return user.customerTermsAcceptedAt || new Date();
  }
  if (body.customerTermsVersion !== terms.version || body.customerTermsAccepted !== true) {
    const error = new Error("Review and accept the current KABHI customer terms before placing your order.");
    error.status = 409;
    error.termsVersion = terms.version;
    throw error;
  }
  return new Date();
}

module.exports = {
  DEFAULT_CUSTOMER_TERMS,
  normalizeCustomerTermsClauses,
  readCustomerTerms,
  updateCustomerTerms,
  customerNeedsTermsAcceptance,
  validateOrderTermsAcknowledgement
};