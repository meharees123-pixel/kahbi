const test = require("node:test");
const assert = require("node:assert/strict");
const { Order } = require("../src/models");
const {
  createNotificationService,
  createOrderStatusOutboxEntry,
  createRestaurantOrderOutboxEntry,
  notificationContent,
  notificationFilter
} = require("../src/notifications");

function fixture(overrides = {}) {
  const order = {
    _id: "order-1",
    reference: "KAB-20261106-ABC123",
    restaurantId: "restaurant-1",
    customerId: "customer-1",
    guest: { name: "Customer Name" },
    total: 72,
    currency: "QAR",
    notificationOutbox: [{
      _id: "outbox-1",
      eventKey: "order-1:NEW_ORDER",
      recipientId: "restaurant-1",
      recipientRole: "RESTAURANT",
      notificationType: "NEW_ORDER",
      status: "",
      createdAt: new Date("2026-11-06T09:00:00.000Z"),
      processedAt: null
    }]
  };
  const created = [];
  const updates = [];
  const events = [];
  const errors = [];
  const orderQuery = {
    select: () => orderQuery,
    sort: () => orderQuery,
    limit: () => orderQuery,
    lean: async () => [order]
  };
  const OrderModel = {
    find: () => orderQuery,
    updateOne: async (filter, update) => {
      updates.push({ filter, update });
      return { matchedCount: 1 };
    }
  };
  const NotificationModel = {
    create: async (notification) => {
      created.push(notification);
      return { ...notification, _id: "notification-1" };
    },
    findOne: () => ({ lean: async () => null })
  };
  const service = createNotificationService({
    OrderModel,
    NotificationModel,
    publish: (event) => events.push(event),
    logger: { error: (...args) => errors.push(args) },
    ...overrides
  });
  return { order, created, updates, events, errors, service, OrderModel, NotificationModel };
}

test("order notification outbox entries target only their intended recipient scope", () => {
  const restaurantEntry = createRestaurantOrderOutboxEntry("request-1:NEW_ORDER", "restaurant-1");
  assert.equal(restaurantEntry.recipientRole, "RESTAURANT");
  assert.equal(restaurantEntry.recipientId, "restaurant-1");
  assert.deepEqual(notificationFilter("CUSTOMER", "customer-1"), {
    recipientRole: "CUSTOMER",
    recipientId: "customer-1"
  });
  assert.equal(createOrderStatusOutboxEntry({
    _id: "order-1",
    customerId: "customer-1"
  }, "ACCEPTED", "PREPARING", { role: "CUSTOMER" }), null);
  assert.equal(Order.schema.path("notificationOutbox").options.select, false);
});

test("status notifications reuse existing order statuses and copy", () => {
  const order = { reference: "KAB-1" };
  const expectedMessages = {
    ACCEPTED: "Your order has been accepted by the restaurant.",
    REJECTED: "Sorry, the restaurant has rejected your order.",
    AUTO_REJECTED: "The restaurant did not accept your order in time.",
    PREPARING: "Your food is being prepared.",
    READY: "Your order is ready.",
    OUT_FOR_DELIVERY: "Your order is on the way.",
    DELIVERED: "Your order has been delivered.",
    CANCELLED: "Your order has been cancelled.",
    CLOSED: "Your order has been completed."
  };
  for (const [status, message] of Object.entries(expectedMessages)) {
    assert.equal(notificationContent(order, {
      notificationType: "ORDER_STATUS_CHANGED",
      status
    }).message, message);
  }
  assert.deepEqual(createOrderStatusOutboxEntry({
    _id: "order-1",
    customerId: "customer-1"
  }, "ACCEPTED", "PREPARING", { role: "RESTAURANT_OWNER" }), {
    eventKey: "order-1:status:ACCEPTED:PREPARING",
    recipientId: "customer-1",
    recipientRole: "CUSTOMER",
    notificationType: "ORDER_STATUS_CHANGED",
    status: "PREPARING"
  });
  assert.match(notificationContent(order, { notificationType: "NEW_ORDER" }).message, /KAB-1/);
});

test("processing an outbox event creates one inbox notification then publishes its ID", async () => {
  const state = fixture();
  assert.equal(await state.service.processOrderNotifications("order-1"), 1);
  assert.equal(state.created.length, 1);
  assert.equal(state.created[0].recipientRole, "RESTAURANT");
  assert.equal(state.created[0].recipientId, "restaurant-1");
  assert.equal(state.created[0].orderId, "order-1");
  assert.match(state.created[0].message, /KAB-20261106-ABC123/);
  assert.equal(state.updates.length, 1);
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].notificationId, "notification-1");
  assert.equal(state.events[0].recipientId, "restaurant-1");
  assert.equal(state.events[0].recipientRole, "RESTAURANT");
  assert.deepEqual(state.errors, []);
});

test("duplicate inbox event keys do not create duplicate records", async () => {
  const state = fixture({
    NotificationModel: {
      create: async () => {
        const error = new Error("duplicate key");
        error.code = 11000;
        throw error;
      },
      findOne: () => ({
        lean: async () => ({ _id: "existing-notification", eventKey: "order-1:NEW_ORDER" })
      })
    }
  });
  assert.equal(await state.service.processOrderNotifications("order-1"), 1);
  assert.equal(state.events[0].notificationId, "existing-notification");
});

test("notification persistence failures are logged and leave the outbox retryable", async () => {
  const state = fixture({
    NotificationModel: {
      create: async () => {
        throw new Error("Mongo unavailable");
      },
      findOne: () => ({ lean: async () => null })
    }
  });
  assert.equal(await state.service.processOrderNotifications("order-1"), 0);
  assert.equal(state.events.length, 0);
  assert.equal(state.errors.length, 1);
  assert.equal(state.updates.length, 1);
  assert.equal(state.updates[0].update.$set["notificationOutbox.$.lastError"], "Mongo unavailable");
});

test("a failed outbox lookup is logged without escaping the order operation", async () => {
  const errors = [];
  const service = createNotificationService({
    OrderModel: { find: () => { throw new Error("Mongo unavailable"); } },
    logger: { error: (...args) => errors.push(args) }
  });
  assert.equal(await service.attemptOrderNotifications("order-1"), 0);
  assert.equal(errors.length, 1);
});

test("notification history and read actions always include the authenticated recipient scope", async () => {
  const notificationFilters = [];
  const orderFilters = [];
  const readUpdates = [];
  const notificationQuery = {
    sort: () => notificationQuery,
    skip: () => notificationQuery,
    limit: () => notificationQuery,
    lean: async () => [{
      _id: "notification-1",
      notificationType: "NEW_ORDER",
      title: "New order received",
      message: "New order received! Order #KAB-1 has been placed.",
      orderId: "order-1",
      status: "",
      isRead: false,
      createdAt: new Date("2026-11-06T09:00:00.000Z")
    }]
  };
  const orderQuery = {
    select: () => orderQuery,
    lean: async () => [{
      _id: "order-1",
      customerId: "customer-1",
      reference: "KAB-1",
      restaurantName: "Restaurant",
      guest: { name: "Customer" },
      items: [],
      total: 15,
      currency: "QAR",
      status: "RESTAURANT_PENDING",
      createdAt: new Date("2026-11-06T09:00:00.000Z")
    }]
  };
  const NotificationModel = {
    countDocuments: async (filter) => {
      notificationFilters.push(filter);
      return filter.isRead === false ? 1 : 2;
    },
    find: (filter) => {
      notificationFilters.push(filter);
      return notificationQuery;
    },
    findOneAndUpdate: (filter, update) => {
      readUpdates.push({ filter, update });
      return { lean: async () => ({ _id: "notification-1", isRead: true }) };
    },
    updateMany: async (filter, update) => {
      readUpdates.push({ filter, update });
      return { modifiedCount: 2 };
    }
  };
  const OrderModel = {
    find: (filter) => {
      orderFilters.push(filter);
      return orderQuery;
    }
  };
  const service = createNotificationService({ OrderModel, NotificationModel });
  const scope = { recipientRole: "CUSTOMER", recipientId: "customer-1" };

  const result = await service.getUserNotifications({ ...scope, page: 1, limit: 10 });
  assert.equal(result.unreadCount, 1);
  assert.equal(result.notifications.length, 1);
  assert.deepEqual(notificationFilters.slice(0, 3), [
    { recipientRole: "CUSTOMER", recipientId: "customer-1" },
    { recipientRole: "CUSTOMER", recipientId: "customer-1", isRead: false },
    { recipientRole: "CUSTOMER", recipientId: "customer-1" }
  ]);
  assert.deepEqual(orderFilters[0], { _id: { $in: ["order-1"] }, customerId: "customer-1" });
  assert.equal("customerName" in result.notifications[0].orderSummary, true);
  assert.equal("phone" in result.notifications[0].orderSummary, false);

  await service.getUserNotifications({ recipientRole: "RESTAURANT", recipientId: "restaurant-1", page: 1, limit: 10 });
  assert.deepEqual(notificationFilters[3], { recipientRole: "RESTAURANT", recipientId: "restaurant-1" });
  assert.deepEqual(orderFilters[1], { _id: { $in: ["order-1"] }, restaurantId: "restaurant-1" });

  await service.markNotificationAsRead("notification-1", scope);
  await service.markAllNotificationsAsRead(scope);
  assert.equal(readUpdates.length, 2);
  assert.deepEqual(readUpdates[0].filter, { _id: "notification-1", ...scope });
  assert.deepEqual(readUpdates[1].filter, { ...scope, isRead: false });
});
