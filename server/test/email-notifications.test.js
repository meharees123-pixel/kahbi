const test = require("node:test");
const assert = require("node:assert/strict");
const { renderEmail } = require("../src/email-templates");
const { createEmailNotificationService, emailConfiguration } = require("../src/email-notifications");
const { changedEmailFields, emailEventKey, adminNotificationEmail, RESTAURANT_FIELD_LABELS, MENU_FIELD_LABELS } = require("../src/app");

function fakeModel(currentTime) {
  const records = [];
  return {
    records,
    async updateOne(filter, update) {
      if (filter._id) {
        const record = records.find((entry) => String(entry._id) === String(filter._id) && entry.status === filter.status);
        if (!record) return { matchedCount: 0 };
        Object.assign(record, update.$set);
        return { matchedCount: 1 };
      }
      if (records.some((entry) => entry.eventKey === filter.eventKey)) return { upsertedCount: 0 };
      records.push({
        _id: `notification-${records.length + 1}`,
        createdAt: currentTime(),
        ...update.$setOnInsert
      });
      return { upsertedCount: 1 };
    },
    async findOneAndUpdate(_filter, update) {
      const current = currentTime();
      const record = records.find((entry) =>
        (entry.status === "QUEUED" && entry.nextAttemptAt <= current) ||
        (entry.status === "SENDING" && entry.lockUntil <= current)
      );
      if (!record) return null;
      Object.assign(record, update.$set);
      record.attempts += update.$inc.attempts;
      return { ...record };
    }
  };
}

const smtpEnv = {
  SMTP_HOST: "smtp.example.test",
  SMTP_PORT: "587",
  SMTP_SECURE: "false",
  SMTP_USER: "smtp-user",
  SMTP_PASS: "smtp-password",
  EMAIL_FROM: "notifications@example.test",
  EMAIL_FROM_NAME: "KABHI"
};

test("email templates escape user content and keep header values on one line", () => {
  const message = renderEmail("PARTNER_REGISTRATION_SUBMITTED", {
    restaurantName: "<img src=x>\r\nBcc: attacker@example.test",
    ownerName: "<script>alert(1)</script>",
    email: "owner@example.test",
    dashboardUrl: "https://example.test/admin?name=<script>"
  });
  assert.equal(message.subject.includes("\r"), false);
  assert.equal(message.subject.includes("\n"), false);
  assert.match(message.html, /&lt;img src=x&gt;/);
  assert.match(message.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal(message.html.includes("<script>"), false);
  assert.match(message.text, /requires review/);
});

test("approval and rejection use saved statuses, include reasons, and omit activation tokens", () => {
  const approval = renderEmail("PARTNER_REGISTRATION_APPROVED", {
    restaurantName: "Pearl Garden",
    status: "APPROVED",
    restaurantStatus: "PENDING_REVIEW"
  });
  assert.match(approval.text, /Application status: APPROVED/);
  assert.match(approval.text, /Restaurant setup status: PENDING_REVIEW/);
  assert.equal(approval.text.includes("token"), false);

  const rejection = renderEmail("PARTNER_REGISTRATION_REJECTED", {
    restaurantName: "Pearl Garden",
    status: "REJECTED",
    reason: "Please correct the business address."
  });
  assert.match(rejection.text, /Please correct the business address/);
});

test("the outbox deduplicates event keys and delivers with configured sender", async () => {
  let time = new Date("2026-10-29T10:00:00.000Z");
  const model = fakeModel(() => time);
  const sent = [];
  const service = createEmailNotificationService({
    model,
    env: smtpEnv,
    now: () => time,
    sendMail: async (message) => {
      sent.push(message);
      return { messageId: "provider-message-id" };
    },
    logger: { warn() {}, error() {} }
  });
  const notification = {
    eventKey: "registration:123",
    eventType: "PARTNER_REGISTRATION_SUBMITTED",
    recipient: "admin@example.test",
    data: { restaurantName: "Pearl Garden", status: "PENDING_VERIFICATION" }
  };
  assert.equal(await service.enqueue(notification), true);
  assert.equal(await service.enqueue(notification), false);
  await new Promise(setImmediate);
  await service.processPending();

  assert.equal(model.records.length, 1);
  assert.equal(model.records[0].status, "SENT");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "admin@example.test");
  assert.equal(sent[0].from.address, "notifications@example.test");
  assert.match(sent[0].messageId, /@kahbi/);
});

test("SMTP failures remain queued for retry and never escape the business caller", async () => {
  let time = new Date("2026-10-29T10:00:00.000Z");
  const model = fakeModel(() => time);
  let attempts = 0;
  const logs = [];
  const service = createEmailNotificationService({
    model,
    env: smtpEnv,
    now: () => time,
    sendMail: async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("SMTP unavailable");
        error.code = "ECONNECTION";
        throw error;
      }
      return { messageId: "sent-after-retry" };
    },
    logger: { warn() {}, error: (...args) => logs.push(args) }
  });

  assert.equal(await service.enqueue({
    eventKey: "menu:456",
    eventType: "MENU_UPDATED",
    recipient: "admin@example.test",
    data: { restaurantName: "Pearl Garden", action: "Added", itemName: "Machboos" }
  }), true);
  await new Promise(setImmediate);
  assert.equal(model.records[0].status, "QUEUED");
  assert.equal(model.records[0].attempts, 1);
  assert.equal(logs.length, 1);

  time = new Date(time.getTime() + 60_000);
  await service.processPending();
  assert.equal(model.records[0].status, "SENT");
  assert.equal(model.records[0].attempts, 2);
});

test("missing recipient is logged without enqueueing an outbox record", async () => {
  const model = fakeModel(() => new Date());
  const warnings = [];
  const service = createEmailNotificationService({
    model,
    logger: { warn: (...args) => warnings.push(args), error() {} }
  });
  assert.equal(await service.enqueue({
    eventKey: "approval:789",
    eventType: "PARTNER_REGISTRATION_APPROVED",
    recipient: "",
    data: { restaurantName: "Pearl Garden" }
  }), false);
  assert.equal(model.records.length, 0);
  assert.equal(warnings.length, 1);
});

test("restaurant registration sends an admin notification to kabhioffical92@gmail.com with details and dashboard link", () => {
  const email = renderEmail("PARTNER_REGISTRATION_SUBMITTED", {
    restaurantName: "Doha Bistro",
    ownerName: "Tariq Ali",
    email: "tariq@example.test",
    date: new Date("2026-10-29T12:00:00Z"),
    status: "PENDING_VERIFICATION",
    registrationId: "KBR-2026-1234",
    dashboardUrl: "http://localhost:4200"
  });
  assert.equal(adminNotificationEmail(), "kabhioffical92@gmail.com");
  assert.match(email.subject, /\[KABHI\] Restaurant application: Doha Bistro/);
  assert.match(email.text, /A new restaurant application requires review/);
  assert.match(email.text, /Restaurant: Doha Bistro/);
  assert.match(email.text, /Owner: Tariq Ali/);
  assert.match(email.text, /Registered email: tariq@example.test/);
  assert.match(email.text, /Approval status: PENDING_VERIFICATION/);
  assert.match(email.text, /Registration ID: KBR-2026-1234/);
  assert.match(email.text, /Admin dashboard: http:\/\/localhost:4200/);
});

test("admin approval of restaurant status clearly states approval, status, date, and next steps", () => {
  const approval = renderEmail("RESTAURANT_STATUS_CHANGED", {
    restaurantName: "Doha Bistro",
    status: "APPROVED",
    previousStatus: "PENDING_REVIEW",
    date: new Date("2026-10-29T12:00:00Z")
  });
  assert.match(approval.subject, /\[KABHI\] Doha Bistro approved/);
  assert.match(approval.text, /The restaurant Doha Bistro has been approved/);
  assert.match(approval.text, /Approval status: APPROVED/);
  assert.match(approval.text, /Next steps:/);
});

test("admin rejection clearly states rejection, status, date, and instructions", () => {
  const rejection = renderEmail("RESTAURANT_STATUS_CHANGED", {
    restaurantName: "Doha Bistro",
    status: "REJECTED",
    previousStatus: "PENDING_REVIEW",
    reason: "Incomplete municipal license documents",
    date: new Date("2026-10-29T12:00:00Z")
  });
  assert.match(rejection.subject, /\[KABHI\] Doha Bistro rejected/);
  assert.match(rejection.text, /The application for Doha Bistro has been rejected/);
  assert.match(rejection.text, /Current status: REJECTED/);
  assert.match(rejection.text, /Reason: Incomplete municipal license documents/);
  assert.match(rejection.text, /Contact KABHI support/);
});

test("menu item addition, update, and deletion notify the admin with proper action and item name", () => {
  const added = renderEmail("MENU_UPDATED", {
    restaurantName: "Doha Bistro",
    actor: "Chef Omar",
    date: new Date(),
    action: "Added",
    itemName: "Biryani"
  });
  assert.match(added.subject, /\[KABHI\] Doha Bistro menu update/);
  assert.match(added.text, /Action: Added/);
  assert.match(added.text, /Menu item: Biryani/);

  const updated = renderEmail("MENU_UPDATED", {
    restaurantName: "Doha Bistro",
    actor: "Chef Omar",
    date: new Date(),
    action: "Updated",
    itemName: "Biryani",
    changes: [{ label: "Price (QAR)", previous: 45, next: 50 }]
  });
  assert.match(updated.text, /Action: Updated/);
  assert.match(updated.text, /Price \(QAR\): 45 → 50/);

  const removed = renderEmail("MENU_UPDATED", {
    restaurantName: "Doha Bistro",
    actor: "Chef Omar",
    date: new Date(),
    action: "Removed",
    itemName: "Biryani"
  });
  assert.match(removed.text, /Action: Removed/);
  assert.match(removed.text, /Menu item: Biryani/);
});

test("delivery-radius changes produce dedicated subject and template heading", () => {
  const email = renderEmail("RESTAURANT_UPDATED", {
    restaurantName: "Al Mourjan",
    actor: "Restaurant Owner",
    date: new Date(),
    changes: [{ label: "Delivery radius (km)", previous: 10, next: 20 }]
  });
  assert.match(email.subject, /\[KABHI\] Al Mourjan delivery radius updated/);
  assert.match(email.text, /Delivery radius \(km\): 10 → 20/);

  const dedicated = renderEmail("DELIVERY_RADIUS_UPDATED", {
    restaurantName: "Al Mourjan",
    actor: "Restaurant Owner",
    date: new Date(),
    previousRadius: 10,
    radius: 20
  });
  assert.match(dedicated.subject, /\[KABHI\] Al Mourjan delivery radius updated/);
  assert.match(dedicated.text, /10 km → 20 km/);
});

test("changedEmailFields produces human-readable diffs with friendly labels and ignores unchanged values", () => {
  const before = { serviceRadiusKm: 10, minOrder: 25, cuisine: ["Qatari"] };
  const after = { serviceRadiusKm: 15, minOrder: 25, cuisine: ["Qatari", "Arabic"] };
  const changes = changedEmailFields(before, after, ["serviceRadiusKm", "minOrder", "cuisine"], RESTAURANT_FIELD_LABELS);
  assert.equal(changes.length, 2);
  assert.equal(changes[0].label, "Delivery radius (km)");
  assert.equal(changes[0].previous, 10);
  assert.equal(changes[0].next, 15);
  assert.equal(changes[1].label, "Cuisine");

  const unchanged = changedEmailFields(before, { ...before }, ["serviceRadiusKm", "minOrder", "cuisine"], RESTAURANT_FIELD_LABELS);
  assert.equal(unchanged.length, 0);
});

test("Gmail app password whitespace is stripped automatically", () => {
  const config = emailConfiguration({
    SMTP_HOST: "smtp.gmail.com",
    SMTP_PORT: "587",
    SMTP_USER: "kabhioffical92@gmail.com",
    SMTP_PASS: "qadl jvfi qapm kcxz",
    EMAIL_FROM: "kabhioffical92@gmail.com"
  });
  assert.equal(config.auth.pass, "qadljvfiqapmkcxz");
});

test("emailConfiguration falls back to SMTP_USER or ADMIN_NOTIFICATION_EMAIL if EMAIL_FROM is omitted", () => {
  const config = emailConfiguration({
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "587",
    SMTP_USER: "kabhioffical92@gmail.com",
    SMTP_PASS: "secret123"
  });
  assert.equal(config.from.address, "kabhioffical92@gmail.com");
});

test("unconfigured SMTP defers processing without burning attempts", async () => {
  const time = new Date("2026-10-29T10:00:00.000Z");
  const model = fakeModel(() => time);
  const service = createEmailNotificationService({
    model,
    env: {},
    now: () => time,
    logger: { warn() {}, error() {} }
  });
  await service.enqueue({
    eventKey: "pending:123",
    eventType: "PARTNER_REGISTRATION_SUBMITTED",
    recipient: "admin@example.test",
    data: { restaurantName: "Doha Bistro" }
  });
  assert.equal(model.records.length, 1);
  assert.equal(model.records[0].status, "QUEUED");
  assert.equal(model.records[0].attempts, 0);

  const processed = await service.processPending();
  assert.equal(processed, 0);
  assert.equal(model.records[0].status, "QUEUED");
  assert.equal(model.records[0].attempts, 0);
});

test("arbitrary or invalid recipients are rejected and not enqueued", async () => {
  const model = fakeModel(() => new Date());
  const service = createEmailNotificationService({ model, logger: { warn() {}, error() {} } });
  assert.equal(await service.enqueue({ eventKey: "bad:1", eventType: "MENU_UPDATED", recipient: "invalid-email", data: {} }), false);
  assert.equal(await service.enqueue({ eventKey: "bad:2", eventType: "MENU_UPDATED", recipient: "", data: {} }), false);
  assert.equal(await service.enqueue({ eventKey: "bad:3", eventType: "MENU_UPDATED", recipient: null, data: {} }), false);
  assert.equal(model.records.length, 0);
});

test("duplicate events with identical key and payload are idempotent", () => {
  const timestamp = new Date("2026-10-29T12:00:00Z");
  const key1 = emailEventKey("MENU_UPDATED", "item-123", timestamp, { action: "Added", name: "Biryani" });
  const key2 = emailEventKey("MENU_UPDATED", "item-123", timestamp, { action: "Added", name: "Biryani" });
  assert.equal(key1, key2);

  const keyDifferent = emailEventKey("MENU_UPDATED", "item-123", timestamp, { action: "Removed", name: "Biryani" });
  assert.notEqual(key1, keyDifferent);
});
