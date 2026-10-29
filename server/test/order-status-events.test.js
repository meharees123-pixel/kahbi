const test = require("node:test");
const assert = require("node:assert/strict");
const {
  publishOrderStatusEvent,
  subscribeToOrderStatus
} = require("../src/order-status-events");

test("order status events reach only their customer, restaurant, and order subscribers", () => {
  const received = { customer: [], restaurant: [], guestOrder: [], unrelated: [] };
  const unsubscribers = [
    subscribeToOrderStatus("customer", "customer-1", (event) => received.customer.push(event)),
    subscribeToOrderStatus("restaurant", "restaurant-1", (event) => received.restaurant.push(event)),
    subscribeToOrderStatus("order", "order-1", (event) => received.guestOrder.push(event)),
    subscribeToOrderStatus("customer", "customer-2", (event) => received.unrelated.push(event))
  ];

  try {
    publishOrderStatusEvent({
      _id: "order-1",
      reference: "KAB-1",
      customerId: "customer-1",
      restaurantId: "restaurant-1",
      status: "PREPARING",
      statusHistory: [{ previousStatus: "ACCEPTED", status: "PREPARING", createdAt: new Date("2026-10-29T10:00:00Z") }]
    }, "ACCEPTED");

    for (const scope of ["customer", "restaurant", "guestOrder"]) {
      assert.equal(received[scope].length, 1);
      assert.equal(received[scope][0].orderId, "order-1");
      assert.equal(received[scope][0].status, "PREPARING");
      assert.equal(received[scope][0].previousStatus, "ACCEPTED");
      assert.equal(received[scope][0].changedAt, "2026-10-29T10:00:00.000Z");
    }
    assert.deepEqual(received.unrelated, []);
  } finally {
    for (const unsubscribe of unsubscribers) unsubscribe();
  }
});

test("unsubscribing removes a status event listener", () => {
  const received = [];
  const unsubscribe = subscribeToOrderStatus("customer", "customer-unsubscribe", (event) => received.push(event));
  unsubscribe();

  publishOrderStatusEvent({
    _id: "order-unsubscribe",
    reference: "KAB-2",
    customerId: "customer-unsubscribe",
    restaurantId: "restaurant-2",
    status: "READY",
    statusHistory: []
  }, "PREPARING");

  assert.deepEqual(received, []);
});

test("publishing to one customer does not scan or notify 10,000 unrelated customer scopes", () => {
  let unrelatedNotifications = 0;
  const unsubscribers = [];
  for (let index = 0; index < 10_000; index += 1) {
    unsubscribers.push(subscribeToOrderStatus("customer", `load-test-${index}`, () => {
      unrelatedNotifications += 1;
    }));
  }
  const targetEvents = [];
  unsubscribers.push(subscribeToOrderStatus("customer", "load-test-target", (event) => targetEvents.push(event)));

  try {
    publishOrderStatusEvent({
      _id: "load-test-order",
      reference: "KAB-LOAD",
      customerId: "load-test-target",
      restaurantId: "restaurant-load",
      status: "READY",
      statusHistory: []
    }, "PREPARING");

    assert.equal(targetEvents.length, 1);
    assert.equal(unrelatedNotifications, 0);
  } finally {
    for (const unsubscribe of unsubscribers) unsubscribe();
  }
});
