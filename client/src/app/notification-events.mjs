export function isOrderStatusEvent(value) {
  if (typeof value !== 'object' || value === null ||
      typeof value.id !== 'string' || typeof value.type !== 'string') return false;
  if (value.type === 'NOTIFICATION_CREATED') {
    return typeof value.notificationId === 'string' &&
      (value.recipientRole === 'CUSTOMER' || value.recipientRole === 'RESTAURANT') &&
      typeof value.changedAt === 'string';
  }
  return (value.type === 'ORDER_CREATED' || value.type === 'ORDER_STATUS_CHANGED') &&
    typeof value.orderId === 'string' &&
    typeof value.reference === 'string' &&
    (typeof value.customerId === 'string' || value.customerId === null) &&
    typeof value.restaurantId === 'string' &&
    typeof value.previousStatus === 'string' &&
    typeof value.status === 'string' &&
    typeof value.changedAt === 'string';
}
