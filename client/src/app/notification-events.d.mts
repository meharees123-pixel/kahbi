export interface OrderStatusEvent {
  id: string;
  type: 'ORDER_CREATED' | 'ORDER_STATUS_CHANGED';
  orderId: string;
  reference: string;
  customerId: string | null;
  restaurantId: string;
  previousStatus: string;
  status: string;
  changedAt: string;
  changedBy?: string;
  role?: string;
  reason?: string;
}

export interface NotificationEvent {
  id: string;
  type: 'NOTIFICATION_CREATED';
  notificationId: string;
  recipientRole: 'CUSTOMER' | 'RESTAURANT';
  changedAt: string;
}

export function isOrderStatusEvent(value: unknown): value is OrderStatusEvent | NotificationEvent;
