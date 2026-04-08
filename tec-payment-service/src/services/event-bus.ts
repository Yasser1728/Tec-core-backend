/**
 * ── Event Bus — Payment Service ──────────────────────────
 * Re-exports من @tec/shared لضمان مصدر واحد للحقيقة.
 * كل الـ imports الداخلية تستخدم هذا الملف بدون تغيير.
 */
export {
  EVENTS,
  createPublisher,
  createSubscriber,
  publishEvent,
  ensureConsumerGroup,
  subscribeStream,
} from '@tec/shared';

export type { PaymentCompletedEvent } from '@tec/shared';
