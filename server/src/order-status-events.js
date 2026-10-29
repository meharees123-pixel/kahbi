const { randomUUID } = require("node:crypto");

const channel = "kahbi:order-status";
const connections = {
  customer: new Map(),
  restaurant: new Map(),
  order: new Map()
};
const allListeners = new Set();
let publisher = null;
let subscriber = null;
let redisWarningLogged = false;
let publisherWasReady = false;
let subscriberWasReady = false;

function notifyListener(listener, event) {
  try {
    listener(event);
  } catch (error) {
    console.error("Unable to deliver order status event to a client:", error.message);
  }
}

function emitToScope(scope, id, event) {
  if (!id) return;
  const listeners = connections[scope].get(String(id));
  if (!listeners) return;
  for (const listener of listeners) notifyListener(listener, event);
}

function dispatch(event) {
  emitToScope("customer", event.customerId, event);
  emitToScope("restaurant", event.restaurantId, event);
  emitToScope("order", event.orderId, event);
}

function subscribeToOrderStatus(scope, id, listener) {
  if (!connections[scope] || !id) throw new Error("A valid order status subscription scope is required.");
  const key = String(id);
  const listeners = connections[scope].get(key) || new Set();
  listeners.add(listener);
  connections[scope].set(key, listeners);
  allListeners.add(listener);
  return () => {
    listeners.delete(listener);
    allListeners.delete(listener);
    if (!listeners.size) connections[scope].delete(key);
  };
}

function notifyListenersToResync() {
  for (const listener of allListeners) notifyListener(listener, { type: "SYNC_REQUIRED" });
}

async function initializeOrderStatusEvents({ required = false } = {}) {
  const url = process.env.REDIS_URL;
  if (!url) {
    if (required) throw new Error("REDIS_URL is required in production to distribute order updates across API instances.");
    return false;
  }

  const { createClient } = require("redis");
  publisher = createClient({ url });
  subscriber = publisher.duplicate();
  publisher.on("error", (error) => console.error("Order status Redis publisher error:", error.message));
  subscriber.on("error", (error) => console.error("Order status Redis subscriber error:", error.message));
  publisher.on("ready", () => {
    if (publisherWasReady) notifyListenersToResync();
    publisherWasReady = true;
  });
  subscriber.on("ready", () => {
    if (subscriberWasReady) notifyListenersToResync();
    subscriberWasReady = true;
  });
  await Promise.all([publisher.connect(), subscriber.connect()]);
  await subscriber.subscribe(channel, (message) => {
    try {
      dispatch(JSON.parse(message));
    } catch (error) {
      console.error("Unable to process Redis order status event:", error.message);
    }
  });
  return true;
}

function publishOrderStatusEvent(order, previousStatus, eventType = "ORDER_STATUS_CHANGED") {
  const history = order.statusHistory || [];
  const latestHistory = history.length ? history[history.length - 1].toObject?.() || history[history.length - 1] : null;
  const event = {
    id: randomUUID(),
    type: eventType,
    orderId: String(order._id),
    reference: order.reference,
    customerId: order.customerId ? String(order.customerId) : null,
    restaurantId: String(order.restaurantId),
    previousStatus,
    status: order.status,
    changedBy: latestHistory?.changedBy || "SYSTEM",
    role: latestHistory?.role || "SYSTEM",
    reason: latestHistory?.reason || "",
    changedAt: latestHistory?.createdAt
      ? new Date(latestHistory.createdAt).toISOString()
      : new Date(order.updatedAt || Date.now()).toISOString()
  };

  if (!publisher || !publisher.isReady) {
    if (publisher && !redisWarningLogged) {
      redisWarningLogged = true;
      console.error("Order status Redis publisher is unavailable; broadcasting only within this API instance.");
    }
    dispatch(event);
    return;
  }

  publisher.publish(channel, JSON.stringify(event)).catch((error) => {
    console.error("Unable to publish order status event:", error.message);
    dispatch(event);
  });
}

module.exports = {
  initializeOrderStatusEvents,
  publishOrderStatusEvent,
  subscribeToOrderStatus
};
