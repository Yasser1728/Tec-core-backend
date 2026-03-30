import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from './order.service';
import Redis from 'ioredis';

@Injectable()
export class OrderConsumer implements OnModuleInit {
  private readonly logger = new Logger(OrderConsumer.name);
  private subscriber: Redis | null = null;

  constructor(
    private readonly ordersService: OrdersService,
    private readonly prisma:        PrismaService,
  ) {}

  async onModuleInit() {
    if (!process.env.REDIS_URL) {
      this.logger.warn('REDIS_URL not set — Order Consumer disabled');
      return;
    }
    this.startConsuming().catch(err =>
      this.logger.error(`Consumer failed: ${(err as Error).message}`)
    );
  }

  private async startConsuming() {
    this.subscriber = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: null,
      retryStrategy: (times) => Math.min(times * 100, 3000),
    });

    const STREAM   = 'payment.completed';
    const GROUP    = 'commerce-service';
    const CONSUMER = 'commerce-consumer-1';

    try {
      await this.subscriber.xgroup('CREATE', STREAM, GROUP, '$', 'MKSTREAM');
    } catch (err: any) {
      if (!err.message?.includes('BUSYGROUP')) throw err;
    }

    this.logger.log(`Order Consumer started — listening on ${STREAM}`);
    await this.processPending(STREAM, GROUP, CONSUMER);

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
              const dataIndex = (fields as string[]).indexOf('data');
              if (dataIndex === -1) continue;
              const payload = JSON.parse((fields as string[])[dataIndex + 1]);
              await this.handlePaymentCompleted(payload);
              await this.subscriber.xack(STREAM, GROUP, messageId);
              this.logger.log(`ACK: ${messageId}`);
            } catch (err) {
              this.logger.error(`Handler failed: ${(err as Error).message}`);
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

    for (const [, messages] of pending) {
      for (const [messageId, fields] of messages) {
        try {
          const dataIndex = (fields as string[]).indexOf('data');
          if (dataIndex === -1) continue;
          const payload = JSON.parse((fields as string[])[dataIndex + 1]);
          await this.handlePaymentCompleted(payload);
          await this.subscriber!.xack(stream, group, messageId);
        } catch (err) {
          this.logger.error(`Pending failed: ${(err as Error).message}`);
        }
      }
    }
  }

  private async handlePaymentCompleted(payload: {
    paymentId:    string;
    userId:       string;
    piPaymentId?: string;
  }) {
    this.logger.log(`payment.completed: ${payload.paymentId}`);

    const order = await this.prisma.order.findFirst({
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

    this.logger.log(`Order ${order.id} → PAID`);
  }
          }
