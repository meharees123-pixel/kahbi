const { Order, Notification } = require("./models");
const { publishNotificationEvent } = require("./order-status-events");

const statusCopy = {
  ACCEPTED: ["Order accepted", "Your order has been accepted by the restaurant."],
  REJECTED: ["Order rejected", "Sorry, the restaurant has rejected your order."],
  AUTO_REJECTED: ["Order not accepted", "The restaurant did not accept your order in time."],
  PREPARING: ["Order being prepared", "Your food is being prepared."],
  READY: ["Order ready", "Your order is ready."],
  OUT_FOR_DELIVERY: ["Order on the way", "Your order is on the way."],
  DELIVERED: ["Order delivered", "Your order has been delivered."],
  CANCELLED: ["Order cancelled", "Your order has been cancelled."],
  CLOSED: ["Order completed", "Your order has been completed."]
};

function createRestaurantOrderOutboxEntry(eventKey, restaurantId) {
  return {
    eventKey,
    recipientId: restaurantId,
    recipientRole: "RESTAURANT",
    notificationType: "NEW_ORDER"
  };
}

function createOrderStatusOutboxEntry(order, previousStatus, nextStatus, user) {
  if (!order.customerId || user?.role === "CUSTOMER") return null;
  return {
    eventKey: `${order._id}:status:${previousStatus}:${nextStatus}`,
    recipientId: order.customerId,
    recipientRole: "CUSTOMER",
    notificationType: "ORDER_STATUS_CHANGED",
    status: nextStatus
  };
}

function notificationFilter(recipientRole, recipientId) {
  return { recipientRole, recipientId };
}

function notificationContent(order, event) {
  if (event.notificationType === "NEW_ORDER") {
    return {
      title: "New order received",
      message: `New order received! Order #${order.reference} has been placed.`
    };
  }
  const [title, message] = statusCopy[event.status] || [
    "Order status updated",
    `Your order status is now ${String(event.status || "").toLowerCase().replaceAll("_", " ")}.`
  ];
  return { title, message };
}

function createNotificationService({
  OrderModel = Order,
  NotificationModel = Notification,
  publish = publishNotificationEvent,
  logger = console
} = {}) {
  async function processOrderNotifications(orderId) {
    const orders = await OrderModel.find({
      _id: orderId,
      "notificationOutbox.processedAt": null
    }).select("+notificationOutbox").lean();
    return processOrders(orders);
  }

  async function attemptOrderNotifications(orderId) {
    try {
      return await processOrderNotifications(orderId);
    } catch (error) {
      logger.error("Unable to process in-app order notification; the outbox will retry:", error.message);
      return 0;
    }
  }

  async function processPendingNotifications(limit = 100) {
    const orders = await OrderModel.find({
      "notificationOutbox.processedAt": null
    }).select("+notificationOutbox").sort({ createdAt: 1 }).limit(limit).lean();
    return processOrders(orders);
  }

  async function getUserNotifications({ recipientRole, recipientId, page = 1, limit = 20 }) {
    const filter = notificationFilter(recipientRole, recipientId);
    const [total, unreadCount, notifications] = await Promise.all([
      NotificationModel.countDocuments(filter),
      NotificationModel.countDocuments({ ...filter, isRead: false }),
      NotificationModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean()
    ]);
    const orderIds = notifications.map((notification) => notification.orderId);
    const orderScope = recipientRole === "CUSTOMER" ? { customerId: recipientId } : { restaurantId: recipientId };
    const orders = orderIds.length
      ? await OrderModel.find({ _id: { $in: orderIds }, ...orderScope })
        .select("reference restaurantName guest.name items.name items.quantity items.lineTotal total currency status createdAt")
        .lean()
      : [];
    const ordersById = new Map(orders.map((order) => [String(order._id), order]));
    return {
      notifications: notifications.map((notification) => {
        const order = ordersById.get(String(notification.orderId));
        return {
          id: String(notification._id),
          notificationType: notification.notificationType,
          title: notification.title,
          message: notification.message,
          orderId: String(notification.orderId),
          status: notification.status,
          isRead: notification.isRead,
          createdAt: notification.createdAt,
          orderSummary: order ? {
            reference: order.reference,
            restaurantName: order.restaurantName,
            customerName: recipientRole === "RESTAURANT" ? order.guest?.name || "" : "",
            items: order.items.map((item) => ({
              name: item.name,
              quantity: item.quantity,
              lineTotal: item.lineTotal
            })),
            total: order.total,
            currency: order.currency,
            status: order.status,
            createdAt: order.createdAt
          } : null
        };
      }),
      unreadCount,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    };
  }

  function getUnreadNotificationCount(scope) {
    return NotificationModel.countDocuments({
      ...notificationFilter(scope.recipientRole, scope.recipientId),
      isRead: false
    });
  }

  function markNotificationAsRead(notificationId, scope) {
    return NotificationModel.findOneAndUpdate({
      _id: notificationId,
      ...notificationFilter(scope.recipientRole, scope.recipientId)
    }, {
      $set: { isRead: true, readAt: new Date() }
    }, {
      new: true,
      runValidators: true
    }).lean();
  }

  function markAllNotificationsAsRead(scope) {
    return NotificationModel.updateMany({
      ...notificationFilter(scope.recipientRole, scope.recipientId),
      isRead: false
    }, {
      $set: { isRead: true, readAt: new Date() }
    });
  }

  async function processOrders(orders) {
    let processed = 0;
    for (const order of orders) {
      for (const event of order.notificationOutbox || []) {
        if (event.processedAt) continue;
        try {
          const { title, message } = notificationContent(order, event);
          let notification;
          try {
            notification = await NotificationModel.create({
              eventKey: event.eventKey,
              recipientId: event.recipientId,
              recipientRole: event.recipientRole,
              notificationType: event.notificationType,
              orderId: order._id,
              status: event.status || "",
              title,
              message,
              createdAt: event.createdAt
            });
          } catch (error) {
            if (error.code !== 11000) throw error;
            notification = await NotificationModel.findOne({ eventKey: event.eventKey }).lean();
            if (!notification) throw error;
          }

          const result = await OrderModel.updateOne({
            _id: order._id,
            notificationOutbox: { $elemMatch: { _id: event._id, processedAt: null } }
          }, {
            $set: {
              "notificationOutbox.$.processedAt": new Date(),
              "notificationOutbox.$.lastError": ""
            },
            $inc: { "notificationOutbox.$.attempts": 1 }
          });
          if (!result.matchedCount) continue;
          publish({
            notificationId: String(notification._id),
            recipientId: String(event.recipientId),
            recipientRole: event.recipientRole,
            createdAt: new Date(event.createdAt || Date.now()).toISOString()
          });
          processed += 1;
        } catch (error) {
          try {
            await OrderModel.updateOne({
              _id: order._id,
              notificationOutbox: { $elemMatch: { _id: event._id, processedAt: null } }
            }, {
              $set: { "notificationOutbox.$.lastError": String(error.message || error).slice(0, 1000) },
              $inc: { "notificationOutbox.$.attempts": 1 }
            });
          } catch (recordError) {
            logger.error("Unable to record in-app notification retry state:", recordError.message);
          }
          logger.error("Unable to process in-app order notification:", error.message);
        }
      }
    }
    return processed;
  }

  return {
    getUnreadNotificationCount,
    getUserNotifications,
    markAllNotificationsAsRead,
    markNotificationAsRead,
    attemptOrderNotifications,
    processOrderNotifications,
    processPendingNotifications
  };
}

const notificationService = createNotificationService();

module.exports = {
  createNotificationService,
  createOrderStatusOutboxEntry,
  createRestaurantOrderOutboxEntry,
  notificationContent,
  notificationFilter,
  notificationService
};
