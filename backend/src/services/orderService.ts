import { v4 as uuidv4 } from 'uuid';
import { AppDatabase } from '../database/db.js';
import { InventoryService } from './inventoryService.js';
import { ProductService } from './productService.js';
import { IdempotencyService } from './idempotencyService.js';
import { Order } from '../types/index.js';

export interface CheckoutResult {
  success: boolean;
  order?: Order;
  error?: string;
  code?: number;
}

export class OrderService {
  private db: AppDatabase;
  private inventoryService: InventoryService;
  private productService: ProductService;
  private idempotency: IdempotencyService;
  private static instance: OrderService | null = null;

  constructor() {
    this.db = AppDatabase.getInstance();
    this.inventoryService = InventoryService.getInstance();
    this.productService = ProductService.getInstance();
    this.idempotency = IdempotencyService.getInstance();
  }

  public static getInstance(): OrderService {
    if (!OrderService.instance) {
      OrderService.instance = new OrderService();
    }
    return OrderService.instance;
  }

  public async checkoutReservation(
    reservationToken: string,
    idempotencyKey: string
  ): Promise<CheckoutResult> {
    // 1. Idempotency Check
    if (idempotencyKey) {
      const existingIdem = await this.idempotency.get(idempotencyKey);
      if (existingIdem && existingIdem.status === 'RESOLVED') {
        return existingIdem.response_body;
      }
    }

    // 2. Fetch reservation
    const reservation = await this.db.getReservationByToken(reservationToken);
    if (!reservation) {
      return { success: false, error: 'RESERVATION_NOT_FOUND', code: 404 };
    }

    if (reservation.status !== 'ACTIVE') {
      return { success: false, error: `RESERVATION_IS_${reservation.status}`, code: 400 };
    }

    // 3. Expiration Check
    const now = Date.now();
    const expiryTime = new Date(reservation.expires_at).getTime();
    if (now > expiryTime) {
      await this.inventoryService.release(
        reservation.product_id,
        reservation.user_id,
        reservationToken,
        'TIMED_OUT'
      );
      return { success: false, error: 'RESERVATION_EXPIRED', code: 410 };
    }

    // 4. Check if order already exists for this reservation
    const existingOrder = await this.db.getOrderByReservationId(reservation.id);
    if (existingOrder) {
      const res: CheckoutResult = { success: true, order: existingOrder };
      if (idempotencyKey) {
        await this.idempotency.resolve(idempotencyKey, 'checkout', 200, res);
      }
      return res;
    }

    // 5. Fetch Product
    const product = await this.productService.getProduct(reservation.product_id);
    if (!product) {
      return { success: false, error: 'PRODUCT_NOT_FOUND', code: 404 };
    }

    // 6. Create Order
    const orderId = `ord_${uuidv4().replace(/-/g, '')}`;
    const orderNumber = `ORD-2026-${Math.floor(100000 + Math.random() * 900000)}`;

    const order = await this.db.createOrder({
      id: orderId,
      order_number: orderNumber,
      reservation_id: reservation.id,
      user_id: reservation.user_id,
      product_id: reservation.product_id,
      quantity: reservation.quantity,
      total_amount: product.price * reservation.quantity,
      idempotency_key: idempotencyKey,
    });

    const result: CheckoutResult = { success: true, order };
    if (idempotencyKey) {
      await this.idempotency.resolve(idempotencyKey, 'checkout', 200, result);
    }

    return result;
  }

  public async getOrder(orderId: string): Promise<Order | null> {
    return await this.db.getOrder(orderId);
  }
}
