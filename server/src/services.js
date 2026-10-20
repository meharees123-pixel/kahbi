const { Order, Restaurant, AuditLog, MessageLog, BillingTransaction } = require("./models");
const { canTransition } = require("./rules");

async function writeAudit({ user, action, entity, entityId, details = {} }) {
  await AuditLog.create({
    userId: user ? user._id : null,
    role: user ? user.role : "SYSTEM",
    action,
    entity,
    entityId: String(entityId || ""),
    details
  });
}

async function logNotification(order, template, recipient) {
  await MessageLog.create({
    orderId: order ? order._id : null,
    recipient: recipient || "unavailable",
    template,
    status: "NOT_CONFIGURED"
  });
}

function restaurantAcceptanceSlaMs() {
  return Math.max(1, Number(process.env.RESTAURANT_ACCEPTANCE_SLA_MINUTES || 5)) * 60 * 1000;
}

async function changeOrderStatus(order, nextStatus, user, reason = "") {
  if (!canTransition(order.status, nextStatus)) {
    const error = new Error(`Order cannot transition from ${order.status} to ${nextStatus}.`);
    error.status = 409;
    throw error;
  }
  const previousStatus = order.status;
  const values = { status: nextStatus };
  if (nextStatus === "REJECTED") values.rejectionReason = reason;
  if (nextStatus === "CANCELLED") values.cancellationReason = reason;
  if (nextStatus === "CLOSED") {
    values.completedAt = new Date();
    values.commissionRate = Number(process.env.RESTAURANT_COMMISSION_PERCENT || 12);
    values.commissionAmount = Number(((order.subtotal - order.discount) * values.commissionRate / 100).toFixed(2));
  }
  const statusEvent = {
    previousStatus,
    status: nextStatus,
    changedBy: user ? user.name : "SYSTEM",
    role: user ? user.role : "SYSTEM",
    reason
  };
  const updatedOrder = await Order.findOneAndUpdate(
    { _id: order._id, status: previousStatus },
    { $set: values, $push: { statusHistory: statusEvent } },
    { new: true, runValidators: true }
  );
  if (!updatedOrder) {
    const error = new Error("The order changed before this update could be applied.");
    error.status = 409;
    throw error;
  }
  if (nextStatus === "CLOSED") {
    await BillingTransaction.findOneAndUpdate(
      { orderId: updatedOrder._id },
      {
        $setOnInsert: {
          orderId: updatedOrder._id,
          restaurantId: updatedOrder.restaurantId,
          customerId: updatedOrder.customerId,
          grossAmount: updatedOrder.subtotal,
          commissionRate: updatedOrder.commissionRate,
          commissionAmount: updatedOrder.commissionAmount,
          adminFee: updatedOrder.adminFee,
          promotionFee: 0,
          netRestaurantAmount: Number((updatedOrder.subtotal - updatedOrder.discount - updatedOrder.commissionAmount).toFixed(2)),
          currency: updatedOrder.currency
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await writeAudit({
      user,
      action: "BILLING_TRANSACTION_RECORDED",
      entity: "Order",
      entityId: updatedOrder._id,
      details: { commissionRate: updatedOrder.commissionRate, commissionAmount: updatedOrder.commissionAmount, currency: updatedOrder.currency }
    });
  }
  await writeAudit({ user, action: "ORDER_STATUS_CHANGED", entity: "Order", entityId: updatedOrder._id, details: { previousStatus, nextStatus, reason } });
  await logNotification(updatedOrder, `ORDER_${nextStatus}`, updatedOrder.guest.phone || "");
  return updatedOrder;
}

async function expirePendingOrders() {
  const cutoff = new Date(Date.now() - restaurantAcceptanceSlaMs());
  const expired = await Order.find({ status: "RESTAURANT_PENDING", createdAt: { $lt: cutoff } }).limit(100);
  for (const order of expired) {
    if (order.status !== "RESTAURANT_PENDING") continue;
    await changeOrderStatus(order, "AUTO_REJECTED", null, "RESTAURANT_TIMEOUT");
  }
  return expired.length;
}

module.exports = { writeAudit, logNotification, changeOrderStatus, expirePendingOrders, restaurantAcceptanceSlaMs };
