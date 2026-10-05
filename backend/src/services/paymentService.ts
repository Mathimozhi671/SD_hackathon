import { v4 as uuidv4 } from 'uuid';
import { AppDatabase } from '../database/db.js';
import { InventoryService } from './inventoryService.js';
import { TelemetryService } from './telemetryService.js';
import { IdempotencyService } from './idempotencyService.js';
import { Order, PaymentTransaction } from '../types/index.js';

export interface ProcessPaymentOptions {
  orderId: string;
  idempotencyKey: string;
  simulateMode?: 'SUCCESS' | 'DECLINE' | 'TIMEOUT';
  cardLast4?: string;
}

export interface PaymentResult {
  success: boolean;
  order?: Order;
  transaction?: PaymentTransaction;
  error?: string;
  code?: number;
}

export class PaymentService {
  private db: AppDatabase;
  private inventoryService: InventoryService;
  private telemetry: TelemetryService;
  private idempotency: IdempotencyService;
  private static instance: PaymentService | null = null;

  constructor() {
    this.db = AppDatabase.getInstance();
    this.inventoryService = InventoryService.getInstance();
    this.telemetry = TelemetryService.getInstance();
    this.idempotency = IdempotencyService.getInstance();
  }

  public static getInstance(): PaymentService {
    if (!PaymentService.instance) {
      PaymentService.instance = new PaymentService();
    }
    return PaymentService.instance;
  }

  public async processPayment(options: ProcessPaymentOptions): Promise<PaymentResult> {
    const { orderId, idempotencyKey, simulateMode = 'SUCCESS' } = options;

    // 1. Idempotency Check
    if (idempotencyKey) {
      const existingIdem = await this.idempotency.get(idempotencyKey);
      if (existingIdem && existingIdem.status === 'RESOLVED') {
        return existingIdem.response_body;
      }
    }

    // 2. Fetch Order
    const order = await this.db.getOrder(orderId);
    if (!order) {
      return { success: false, error: 'ORDER_NOT_FOUND', code: 404 };
    }

    // If order already paid, return idempotent response
    if (order.status === 'PAID') {
      const tx = await this.db.getPaymentTransactionByOrderId(orderId);
      const res: PaymentResult = {
        success: true,
        order,
        transaction: tx || undefined,
      };
      if (idempotencyKey) {
        await this.idempotency.resolve(idempotencyKey, 'payment', 200, res);
      }
      return res;
    }

    if (order.status !== 'PENDING_PAYMENT') {
      return {
        success: false,
        error: `CANNOT_PAY_ORDER_IN_${order.status}_STATE`,
        code: 400,
      };
    }

    // 3. Check reservation
    const reservation = order.reservation_id ? await this.db.getReservationById(order.reservation_id) : null;
    if (!reservation || reservation.status !== 'ACTIVE') {
      return {
        success: false,
        error: 'RESERVATION_IS_NO_LONGER_ACTIVE',
        code: 410,
      };
    }

    // Check expiration
    const now = Date.now();
    const expiryTime = new Date(reservation.expires_at).getTime();
    if (now > expiryTime) {
      await this.inventoryService.release(order.product_id, order.user_id, reservation.reservation_token, 'TIMED_OUT');
      return {
        success: false,
        error: 'RESERVATION_EXPIRED_DURING_CHECKOUT',
        code: 410,
      };
    }

    // 4. Simulated Failure Modes
    if (simulateMode === 'DECLINE') {
      this.telemetry.recordPaymentFailure();
      await this.inventoryService.release(order.product_id, order.user_id, reservation.reservation_token, 'PAYMENT_FAILED');
      const failRes: PaymentResult = {
        success: false,
        error: 'PAYMENT_DECLINED_INSUFFICIENT_FUNDS',
        code: 402,
      };
      if (idempotencyKey) {
        await this.idempotency.resolve(idempotencyKey, 'payment', 402, failRes);
      }
      return failRes;
    }

    if (simulateMode === 'TIMEOUT') {
      this.telemetry.recordPaymentFailure();
      await this.inventoryService.release(order.product_id, order.user_id, reservation.reservation_token, 'TIMED_OUT');
      const timeoutRes: PaymentResult = {
        success: false,
        error: 'PAYMENT_GATEWAY_TIMEOUT',
        code: 504,
      };
      if (idempotencyKey) {
        await this.idempotency.resolve(idempotencyKey, 'payment', 504, timeoutRes);
      }
      return timeoutRes;
    }

    // 5. Successful Payment
    const paymentRef = `pay_ref_${uuidv4().replace(/-/g, '')}`;

    // Atomically commit in Redis first
    await this.inventoryService.commit(order.product_id, order.user_id, reservation.reservation_token);

    // Atomically commit in DB
    const { order: updatedOrder, transaction } = await this.db.commitOrderAndInventory(
      orderId,
      paymentRef,
      idempotencyKey
    );

    this.telemetry.recordPaymentSuccess();

    // Audit log
    const inventory = await this.db.getInventoryByProductId(order.product_id);
    await this.db.logAudit({
      product_id: order.product_id,
      action: 'COMMIT',
      delta: 0,
      current_redis_stock: inventory?.available_stock ?? 0,
      current_db_stock: inventory?.available_stock ?? 0,
      reference_id: updatedOrder.id,
    });

    const successRes: PaymentResult = {
      success: true,
      order: updatedOrder,
      transaction,
    };

    if (idempotencyKey) {
      await this.idempotency.resolve(idempotencyKey, 'payment', 200, successRes);
    }

    return successRes;
  }
}
