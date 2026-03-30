import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { OrdersService } from './order.service';

@Injectable()
export class OrderConsumer implements OnModuleInit {
  private readonly logger = new Logger(OrderConsumer.name);
  private subscriber: Redis | null = null;

  constructor(private readonly ordersService: OrdersService) {}

  async onModuleInit() {
    if (!process.env.REDIS_URL) {
      this.logger.warn('REDIS_URL not set — Order Consumer disabled');
      return;
    }
    await this.startConsuming();
  }

  private async startConsuming() {
    this.subscriber = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: null,
      retryStrategy: (times) => Math.min(times * 100, 3000),
      lazyConnect: false,
    });

    const STREAM    = 'payment.completed';
    const GROUP     = 'commerce-service';
    const CONSUMER  = 'commerce-consumer-1';

    // ── Create consumer group ──────────────────────────────
    try {
      await this.subscriber.xgroup('CREATE', STREAM, GROUP, '$', 'MKSTREAM');
      this.logger.log(`Consumer group created: ${GROUP}`);
    } catch (err: any) {
      if (!err.message?.includes('BUSYGROUP')) throw err;
    }

    this.logger.log(`Order Consumer started — listening on ${STREAM}`);

    // ── Process pending messages first ─────────────────────
    await this.processPending(STREAM, GROUP, CONSUMER);

    // ── Main loop ──────────────────────────────────────────
    while (true) {
      try {
        const results = await this.subscriber.xreadgroup(
          'GROUP', GROUP, CONSUMER,
          'COUNT', 10,
          'BLOCK', 5000,
          'STREAMS', STREAM,
          '>',
        ) as any;

        if (!results) continue;

        for (const [, messages] of results) {
          for (const [messageId, fields] of messages) {
            try {
              const dataIndex = fields.indexOf('data');
              if (dataIndex === -1) continue;

              const payload = JSON.parse(fields[dataIndex + 1]);
              await this.handlePaymentCompleted(payload);
              await this.subscriber.xack(STREAM, GROUP, messageId);
              this.logger.log(`ACK: ${messageId}`);
            } catch (err) {
              this.logger.error(`Handler failed for ${messageId}: ${(err as Error).message}`);
            }
          }
        }
      } catch (err: any) {
        if (err.message?.includes('NOGROUP')) {
          await this.subscriber.xgroup('CREATE', STREAM, GROUP, '$', 'MKSTREAM');
        } else {
          this.logger.error(`Stream error: ${err.message}`);
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }
  }

  private async processPending(stream: string, group: string, consumer: string) {
    const pending = await this.subscriber!.xreadgroup(
      'GROUP', group, consumer,
      'COUNT', 100,
      'STREAMS', stream,
      '0',
    ) as any;

    if (!pending) return;

    let count = 0;
    for (const [, messages] of pending) {
      for (const [messageId, fields] of messages) {
        try {
          const dataIndex = fields.indexOf('data');
          if (dataIndex === -1) continue;
          const payload = JSON.parse(fields[dataIndex + 1]);
          await this.handlePaymentCompleted(payload);
          await this.subscriber!.xack(stream, group, messageId);
          count++;
        } catch (err) {
          this.logger.error(`Pending failed ${messageId}: ${(err as Error).message}`);
        }
      }
    }

    if (count > 0) this.logger.log(`Processed ${count} pending messages`);
  }

  private async handlePaymentCompleted(payload: {
    paymentId:    string;
    userId:       string;
    amount:       number;
    currency:     string;
    piPaymentId?: string;
    timestamp:    string;
  }) {
    this.logger.log(`payment.completed received: ${payload.paymentId}`);

    // ── Find pending order for this payment ────────────────
    const { PrismaClient } = await import('../../../prisma/client');
    const prisma = new PrismaClient();

    try {
      const order = await prisma.order.findFirst({
        where: {
          status:     'PENDING',
          buyer_id:   payload.userId,
          payment_id: payload.paymentId,
        },
      });

      if (!order) {
        this.logger.warn(`No pending order for payment: ${payload.paymentId}`);
        return;
      }

      await this.ordersService.checkout({
        order_id:      order.id,
        payment_id:    payload.paymentId,
        pi_payment_id: payload.piPaymentId,
      });

      this.logger.log(`Order ${order.id} marked as PAID`);
    } finally {
      await prisma.$disconnect();
    }
  }
}
