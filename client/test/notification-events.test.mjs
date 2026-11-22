import test from 'node:test';
import assert from 'node:assert/strict';
import { isOrderStatusEvent } from '../src/app/notification-events.mjs';

test('accepts existing order status events', () => {
  assert.equal(isOrderStatusEvent({
    id: 'event-1',
    type: 'ORDER_STATUS_CHANGED',
    orderId: 'order-1',
    reference: 'KAB-1',
    customerId: 'customer-1',
    restaurantId: 'restaurant-1',
    previousStatus: 'ACCEPTED',
    status: 'PREPARING',
    changedAt: '2026-11-06T09:00:00.000Z'
  }), true);
});

test('accepts scoped notification events without requiring order details in the event', () => {
  assert.equal(isOrderStatusEvent({
    id: 'event-2',
    type: 'NOTIFICATION_CREATED',
    notificationId: 'notification-1',
    recipientRole: 'RESTAURANT',
    changedAt: '2026-11-06T09:00:00.000Z'
  }), true);
});

test('rejects malformed notification events and unknown event types', () => {
  assert.equal(isOrderStatusEvent({
    id: 'event-3',
    type: 'NOTIFICATION_CREATED',
    notificationId: 'notification-1',
    recipientRole: 'ADMIN',
    changedAt: '2026-11-06T09:00:00.000Z'
  }), false);
  assert.equal(isOrderStatusEvent({ id: 'event-4', type: 'UNKNOWN' }), false);
});
