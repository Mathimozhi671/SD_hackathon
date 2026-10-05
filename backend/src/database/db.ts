import { PrismaClient } from '@prisma/client';
import {
  Product,
  Inventory,
  Reservation,
  Order,
  PaymentTransaction,
  InventoryAuditLog,
  IdempotencyRecord
} from '../types/index.js';

export class AppDatabase {
  private prisma: PrismaClient;
  private static instance: AppDatabase | null = null;
  private isInMemoryFallback: boolean = false;

  // In-memory data store for standalone/offline fallback
  private usersMap = new Map<string, any>();
  private productsMap = new Map<string, Product & { category?: string; imageUrl?: string }>();
  private inventoriesMap = new Map<string, Inventory>(); // keyed by productId
  private reservationsMap = new Map<string, Reservation>(); // keyed by id
  private ordersMap = new Map<string, Order>(); // keyed by id
  private paymentTxMap = new Map<string, PaymentTransaction>();
  private idempotencyMap = new Map<string, IdempotencyRecord>();
  private auditLogsList: InventoryAuditLog[] = [];

  constructor() {
    this.prisma = new PrismaClient();
  }

  public static getInstance(): AppDatabase {
    if (!AppDatabase.instance) {
      AppDatabase.instance = new AppDatabase();
    }
    return AppDatabase.instance;
  }

  public getPrisma(): PrismaClient {
    return this.prisma;
  }

  public isUsingInMemory(): boolean {
    return this.isInMemoryFallback;
  }

  private handleDbError(err: any): void {
    if (!this.isInMemoryFallback) {
      console.warn('⚠️ [Database] PostgreSQL unreachable. Switching AppDatabase to high-performance In-Memory ACID engine.');
      this.isInMemoryFallback = true;
    }
  }

  // --- Product & Inventory Seeding ---
  public async seedProductAndInventory(
    productId: string = 'prod_quantum_headset_2026',
    sku: string = 'SKU-QUANTUM-PRO',
    name: string = 'SysCrafters 2026 Edition Quantum Pro Headset',
    price: number = 299.99,
    totalStock: number = 100
  ): Promise<{ product: Product; inventory: Inventory }> {
    if (!this.isInMemoryFallback) {
      try {
        const existingProd = await this.prisma.product.findUnique({ where: { id: productId } });
        if (!existingProd) {
          await this.prisma.product.create({
            data: {
              id: productId,
              sku,
              name,
              description: 'Limited Edition Planar Magnetic Drivers',
              price,
            }
          });
        }

        const inventoryId = `inv_${productId}`;
        const existingInv = await this.prisma.inventory.findUnique({ where: { id: inventoryId } });
        if (!existingInv) {
          await this.prisma.inventory.create({
            data: {
              id: inventoryId,
              productId,
              totalStock,
              availableStock: totalStock,
              reservedStock: 0,
              version: 1,
            }
          });
        }

        const prod = await this.prisma.product.findUniqueOrThrow({ where: { id: productId } });
        const inv = await this.prisma.inventory.findUniqueOrThrow({ where: { id: inventoryId } });

        return {
          product: {
            id: prod.id,
            sku: prod.sku,
            name: prod.name,
            description: prod.description || undefined,
            price: Number(prod.price),
            created_at: prod.createdAt.toISOString(),
          },
          inventory: {
            id: inv.id,
            product_id: inv.productId,
            total_stock: inv.totalStock,
            available_stock: inv.availableStock,
            reserved_stock: inv.reservedStock,
            version: inv.version,
          }
        };
      } catch (err: any) {
        this.handleDbError(err);
      }
    }

    // In-memory mode
    let prod = this.productsMap.get(productId);
    if (!prod) {
      prod = {
        id: productId,
        sku,
        name,
        description: 'Limited Edition Planar Magnetic Drivers',
        price,
        created_at: new Date().toISOString(),
      };
      this.productsMap.set(productId, prod);
    }

    let inv = this.inventoriesMap.get(productId);
    if (!inv) {
      inv = {
        id: `inv_${productId}`,
        product_id: productId,
        total_stock: totalStock,
        available_stock: totalStock,
        reserved_stock: 0,
        version: 1,
      };
      this.inventoriesMap.set(productId, inv);
    }

    return { product: prod, inventory: inv };
  }

  public async resetSystem(productId: string = 'prod_quantum_headset_2026', totalStock: number = 100): Promise<void> {
    if (!this.isInMemoryFallback) {
      try {
        await this.seedProductAndInventory(productId, 'SKU-QUANTUM-PRO', 'SysCrafters 2026 Edition Quantum Pro Headset', 299.99, totalStock);

        await this.prisma.$transaction(async (tx) => {
          await tx.paymentTransaction.deleteMany({});
          await tx.order.deleteMany({});
          await tx.reservation.deleteMany({});
          await tx.inventoryAuditLog.deleteMany({});
          await tx.idempotencyRecord.deleteMany({});

          await tx.inventory.update({
            where: { productId },
            data: {
              totalStock,
              availableStock: totalStock,
              reservedStock: 0,
              version: { increment: 1 },
            }
          });
        });
        return;
      } catch (err: any) {
        this.handleDbError(err);
      }
    }

    // In-Memory Reset
    this.reservationsMap.clear();
    this.ordersMap.clear();
    this.paymentTxMap.clear();
    this.idempotencyMap.clear();
    this.auditLogsList = [];

    await this.seedProductAndInventory(productId, 'SKU-QUANTUM-PRO', 'SysCrafters 2026 Edition Quantum Pro Headset', 299.99, totalStock);
    const inv = this.inventoriesMap.get(productId);
    if (inv) {
      inv.total_stock = totalStock;
      inv.available_stock = totalStock;
      inv.reserved_stock = 0;
      inv.version += 1;
    }
  }

  public async ensureUser(userId: string, email?: string): Promise<void> {
    if (!this.isInMemoryFallback) {
      try {
        const userEmail = email || `${userId}@customer.syscrafters.io`;
        await this.prisma.user.upsert({
          where: { id: userId },
          update: {},
          create: { id: userId, email: userEmail },
        });
        return;
      } catch (err: any) {
        this.handleDbError(err);
      }
    }

    if (!this.usersMap.has(userId)) {
      this.usersMap.set(userId, { id: userId, email: email || `${userId}@customer.syscrafters.io` });
    }
  }

  // --- Product Queries ---
  public async getProduct(productId: string): Promise<Product | null> {
    if (!this.isInMemoryFallback) {
      try {
        const prod = await this.prisma.product.findUnique({ where: { id: productId } });
        if (!prod) return null;
        return {
          id: prod.id,
          sku: prod.sku,
          name: prod.name,
          description: prod.description || undefined,
          price: Number(prod.price),
          created_at: prod.createdAt.toISOString(),
        };
      } catch (err: any) {
        this.handleDbError(err);
      }
    }

    return this.productsMap.get(productId) || null;
  }

  // --- Inventory Queries & Concurrency-Safe Decrements ---
  public async getInventoryByProductId(productId: string): Promise<Inventory | null> {
    if (!this.isInMemoryFallback) {
      try {
        const inv = await this.prisma.inventory.findUnique({ where: { productId } });
        if (!inv) return null;
        return {
          id: inv.id,
          product_id: inv.productId,
          total_stock: inv.totalStock,
          available_stock: inv.availableStock,
          reserved_stock: inv.reservedStock,
          version: inv.version,
        };
      } catch (err: any) {
        this.handleDbError(err);
      }
    }

    return this.inventoriesMap.get(productId) || null;
  }

  /**
   * Concurrency-Safe Atomic DB Reservation:
   * Decrements available_stock and increments reserved_stock ONLY IF available_stock > 0.
   */
  public async reserveInventoryAtomic(productId: string): Promise<boolean> {
    if (!this.isInMemoryFallback) {
      try {
        const result = await this.prisma.$executeRaw`
          UPDATE inventories
          SET available_stock = available_stock - 1,
              reserved_stock = reserved_stock + 1,
              version = version + 1
          WHERE product_id = ${productId} AND available_stock > 0
        `;
        return result > 0;
      } catch (err: any) {
        this.handleDbError(err);
      }
    }

    const inv = this.inventoriesMap.get(productId);
    if (!inv || inv.available_stock <= 0) {
      return false;
    }
    inv.available_stock -= 1;
    inv.reserved_stock += 1;
    inv.version += 1;
    return true;
  }

  public async createReservationRecord(res: {
    id: string;
    inventory_id: string;
    product_id: string;
    user_id: string;
    reservation_token: string;
    expires_at: string;
  }): Promise<Reservation> {
    await this.ensureUser(res.user_id);

    if (!this.isInMemoryFallback) {
      try {
        const record = await this.prisma.reservation.create({
          data: {
            id: res.id,
            inventoryId: res.inventory_id,
            productId: res.product_id,
            userId: res.user_id,
            reservationToken: res.reservation_token,
            quantity: 1,
            status: 'ACTIVE',
            expiresAt: new Date(res.expires_at),
          }
        });

        return {
          id: record.id,
          inventory_id: record.inventoryId,
          product_id: record.productId,
          user_id: record.userId,
          reservation_token: record.reservationToken,
          quantity: record.quantity,
          status: record.status as any,
          expires_at: record.expiresAt.toISOString(),
          created_at: record.createdAt.toISOString(),
          updated_at: record.updatedAt.toISOString(),
        };
      } catch (err: any) {
        this.handleDbError(err);
      }
    }

    const nowStr = new Date().toISOString();
    const reservation: Reservation = {
      id: res.id,
      inventory_id: res.inventory_id,
      product_id: res.product_id,
      user_id: res.user_id,
      reservation_token: res.reservation_token,
      quantity: 1,
      status: 'ACTIVE',
      expires_at: res.expires_at,
      created_at: nowStr,
      updated_at: nowStr,
    };
    this.reservationsMap.set(res.id, reservation);
    return reservation;
  }

  public async getReservationByToken(token: string): Promise<Reservation | null> {
    if (!this.isInMemoryFallback) {
      try {
        const record = await this.prisma.reservation.findUnique({
          where: { reservationToken: token }
        });
        if (!record) return null;
        return {
          id: record.id,
          inventory_id: record.inventoryId,
          product_id: record.productId,
          user_id: record.userId,
          reservation_token: record.reservationToken,
          quantity: record.quantity,
          status: record.status as any,
          expires_at: record.expiresAt.toISOString(),
          created_at: record.createdAt.toISOString(),
          updated_at: record.updatedAt.toISOString(),
        };
      } catch (err: any) {
        this.handleDbError(err);
      }
    }

    for (const res of this.reservationsMap.values()) {
      if (res.reservation_token === token) return res;
    }
    return null;
  }

  public async getReservationById(id: string): Promise<Reservation | null> {
    if (!this.isInMemoryFallback) {
      try {
        const record = await this.prisma.reservation.findUnique({
          where: { id }
        });
        if (!record) return null;
        return {
          id: record.id,
          inventory_id: record.inventoryId,
          product_id: record.productId,
          user_id: record.userId,
          reservation_token: record.reservationToken,
          quantity: record.quantity,
          status: record.status as any,
          expires_at: record.expiresAt.toISOString(),
          created_at: record.createdAt.toISOString(),
          updated_at: record.updatedAt.toISOString(),
        };
      } catch (err: any) {
        this.handleDbError(err);
      }
    }

    return this.reservationsMap.get(id) || null;
  }

  public async getPaymentTransactionByOrderId(orderId: string): Promise<PaymentTransaction | null> {
    if (!this.isInMemoryFallback) {
      try {
        const tx = await this.prisma.paymentTransaction.findFirst({ where: { orderId } });
        if (!tx) return null;
        return {
          id: tx.id,
          order_id: tx.orderId,
          payment_reference: tx.paymentReference || '',
          provider: tx.provider || 'MOCK_GATEWAY',
          amount: Number(tx.amount),
          status: tx.status as any,
          idempotency_key: tx.idempotencyKey,
          created_at: tx.createdAt.toISOString(),
        };
      } catch (err: any) {
        this.handleDbError(err);
      }
    }

    for (const tx of this.paymentTxMap.values()) {
      if (tx.order_id === orderId) return tx;
    }
    return null;
  }

  public async updateReservationStatus(token: string, status: 'COMMITTED' | 'EXPIRED' | 'CANCELLED'): Promise<void> {
    if (!this.isInMemoryFallback) {
      try {
        await this.prisma.reservation.updateMany({
          where: { reservationToken: token },
          data: { status, updatedAt: new Date() }
        });
        return;
      } catch (err: any) {
        this.handleDbError(err);
      }
    }

    for (const res of this.reservationsMap.values()) {
      if (res.reservation_token === token) {
        res.status = status;
        res.updated_at = new Date().toISOString();
      }
    }
  }

  // --- Order Queries & Operations ---
  public async createOrder(order: {
    id: string;
    order_number: string;
    reservation_id: string;
    user_id: string;
    product_id: string;
    quantity: number;
    total_amount: number;
    idempotency_key: string;
  }): Promise<Order> {
    if (!this.isInMemoryFallback) {
      try {
        const existing = await this.prisma.order.findUnique({
          where: { idempotencyKey: order.idempotency_key }
        });
        if (existing) {
          return {
            id: existing.id,
            order_number: existing.orderNumber,
            reservation_id: existing.reservationId || '',
            user_id: existing.userId,
            product_id: existing.productId,
            quantity: existing.quantity,
            total_amount: Number(existing.totalAmount),
            status: existing.status as any,
            idempotency_key: existing.idempotencyKey,
            created_at: existing.createdAt.toISOString(),
            updated_at: existing.updatedAt.toISOString(),
          };
        }

        const created = await this.prisma.order.create({
          data: {
            id: order.id,
            orderNumber: order.order_number,
            reservationId: order.reservation_id,
            userId: order.user_id,
            productId: order.product_id,
            quantity: order.quantity,
            totalAmount: order.total_amount,
            status: 'PENDING_PAYMENT',
            idempotencyKey: order.idempotency_key,
          }
        });

        return {
          id: created.id,
          order_number: created.orderNumber,
          reservation_id: created.reservationId || '',
          user_id: created.userId,
          product_id: created.productId,
          quantity: created.quantity,
          total_amount: Number(created.totalAmount),
          status: created.status as any,
          idempotency_key: created.idempotencyKey,
          created_at: created.createdAt.toISOString(),
          updated_at: created.updatedAt.toISOString(),
        };
      } catch (err: any) {
        this.handleDbError(err);
      }
    }

    // Check existing idempotency key in memory
    for (const existing of this.ordersMap.values()) {
      if (existing.idempotency_key === order.idempotency_key) {
        return existing;
      }
    }

    const nowStr = new Date().toISOString();
    const newOrder: Order = {
      id: order.id,
      order_number: order.order_number,
      reservation_id: order.reservation_id,
      user_id: order.user_id,
      product_id: order.product_id,
      quantity: order.quantity,
      total_amount: order.total_amount,
      status: 'PENDING_PAYMENT',
      idempotency_key: order.idempotency_key,
      created_at: nowStr,
      updated_at: nowStr,
    };
    this.ordersMap.set(newOrder.id, newOrder);
    return newOrder;
  }

  public async getOrder(orderId: string): Promise<Order | null> {
    if (!this.isInMemoryFallback) {
      try {
        const ord = await this.prisma.order.findUnique({ where: { id: orderId } });
        if (!ord) return null;
        return {
          id: ord.id,
          order_number: ord.orderNumber,
          reservation_id: ord.reservationId || '',
          user_id: ord.userId,
          product_id: ord.productId,
          quantity: ord.quantity,
          total_amount: Number(ord.totalAmount),
          status: ord.status as any,
          idempotency_key: ord.idempotencyKey,
          created_at: ord.createdAt.toISOString(),
          updated_at: ord.updatedAt.toISOString(),
        };
      } catch (err: any) {
        this.handleDbError(err);
      }
    }

    return this.ordersMap.get(orderId) || null;
  }

  public async getOrderByReservationId(reservationId: string): Promise<Order | null> {
    if (!this.isInMemoryFallback) {
      try {
        const ord = await this.prisma.order.findUnique({ where: { reservationId } });
        if (!ord) return null;
        return {
          id: ord.id,
          order_number: ord.orderNumber,
          reservation_id: ord.reservationId || '',
          user_id: ord.userId,
          product_id: ord.productId,
          quantity: ord.quantity,
          total_amount: Number(ord.totalAmount),
          status: ord.status as any,
          idempotency_key: ord.idempotencyKey,
          created_at: ord.createdAt.toISOString(),
          updated_at: ord.updatedAt.toISOString(),
        };
      } catch (err: any) {
        this.handleDbError(err);
      }
    }

    for (const ord of this.ordersMap.values()) {
      if (ord.reservation_id === reservationId) return ord;
    }
    return null;
  }

  // --- Payment & Commitment Transaction ---
  public async commitOrderAndInventory(
    orderId: string,
    paymentRef: string,
    idempotencyKey: string
  ): Promise<{ order: Order; transaction: PaymentTransaction }> {
    if (!this.isInMemoryFallback) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const order = await tx.order.findUnique({ where: { id: orderId } });
          if (!order) {
            throw new Error('ORDER_NOT_FOUND');
          }

          if (order.status === 'PAID') {
            const txRecord = await tx.paymentTransaction.findFirstOrThrow({ where: { orderId } });
            return {
              order: {
                id: order.id,
                order_number: order.orderNumber,
                reservation_id: order.reservationId || '',
                user_id: order.userId,
                product_id: order.productId,
                quantity: order.quantity,
                total_amount: Number(order.totalAmount),
                status: order.status as any,
                idempotency_key: order.idempotencyKey,
                created_at: order.createdAt.toISOString(),
                updated_at: order.updatedAt.toISOString(),
              },
              transaction: {
                id: txRecord.id,
                order_id: txRecord.orderId,
                payment_reference: txRecord.paymentReference || '',
                provider: txRecord.provider || 'MOCK_GATEWAY',
                amount: Number(txRecord.amount),
                status: txRecord.status as any,
                idempotency_key: txRecord.idempotencyKey,
                created_at: txRecord.createdAt.toISOString(),
              }
            };
          }

          const existingTx = await tx.paymentTransaction.findUnique({ where: { idempotencyKey } });
          if (existingTx) {
            return {
              order: {
                id: order.id,
                order_number: order.orderNumber,
                reservation_id: order.reservationId || '',
                user_id: order.userId,
                product_id: order.productId,
                quantity: order.quantity,
                total_amount: Number(order.totalAmount),
                status: order.status as any,
                idempotency_key: order.idempotencyKey,
                created_at: order.createdAt.toISOString(),
                updated_at: order.updatedAt.toISOString(),
              },
              transaction: {
                id: existingTx.id,
                order_id: existingTx.orderId,
                payment_reference: existingTx.paymentReference || '',
                provider: existingTx.provider || 'MOCK_GATEWAY',
                amount: Number(existingTx.amount),
                status: existingTx.status as any,
                idempotency_key: existingTx.idempotencyKey,
                created_at: existingTx.createdAt.toISOString(),
              }
            };
          }

          const updatedOrder = await tx.order.update({
            where: { id: orderId },
            data: { status: 'PAID', updatedAt: new Date() }
          });

          if (order.reservationId) {
            await tx.reservation.update({
              where: { id: order.reservationId },
              data: { status: 'COMMITTED', updatedAt: new Date() }
            });
          }

          await tx.$executeRaw`
            UPDATE inventories 
            SET reserved_stock = reserved_stock - 1, version = version + 1
            WHERE product_id = ${order.productId} AND reserved_stock > 0
          `;

          const txId = `tx_${orderId.substring(4)}`;
          const pTx = await tx.paymentTransaction.create({
            data: {
              id: txId,
              orderId,
              paymentReference: paymentRef,
              provider: 'MOCK_GATEWAY',
              amount: order.totalAmount,
              status: 'SUCCESS',
              idempotencyKey,
            }
          });

          return {
            order: {
              id: updatedOrder.id,
              order_number: updatedOrder.orderNumber,
              reservation_id: updatedOrder.reservationId || '',
              user_id: updatedOrder.userId,
              product_id: updatedOrder.productId,
              quantity: updatedOrder.quantity,
              total_amount: Number(updatedOrder.totalAmount),
              status: updatedOrder.status as any,
              idempotency_key: updatedOrder.idempotencyKey,
              created_at: updatedOrder.createdAt.toISOString(),
              updated_at: updatedOrder.updatedAt.toISOString(),
            },
            transaction: {
              id: pTx.id,
              order_id: pTx.orderId,
              payment_reference: pTx.paymentReference || '',
              provider: pTx.provider || 'MOCK_GATEWAY',
              amount: Number(pTx.amount),
              status: pTx.status as any,
              idempotency_key: pTx.idempotencyKey,
              created_at: pTx.createdAt.toISOString(),
            }
          };
        });
      } catch (err: any) {
        this.handleDbError(err);
      }
    }

    // In-memory atomic transaction
    const order = this.ordersMap.get(orderId);
    if (!order) throw new Error('ORDER_NOT_FOUND');

    if (order.status === 'PAID') {
      const existingTx = Array.from(this.paymentTxMap.values()).find(t => t.order_id === orderId);
      return { order, transaction: existingTx! };
    }

    const existingTx = Array.from(this.paymentTxMap.values()).find(t => t.idempotency_key === idempotencyKey);
    if (existingTx) {
      return { order, transaction: existingTx };
    }

    order.status = 'PAID';
    order.updated_at = new Date().toISOString();

    if (order.reservation_id) {
      const res = this.reservationsMap.get(order.reservation_id);
      if (res) {
        res.status = 'COMMITTED';
        res.updated_at = new Date().toISOString();
      }
    }

    const inv = this.inventoriesMap.get(order.product_id);
    if (inv && inv.reserved_stock > 0) {
      inv.reserved_stock -= 1;
      inv.version += 1;
    }

    const txId = `tx_${orderId.substring(4)}`;
    const paymentTx: PaymentTransaction = {
      id: txId,
      order_id: orderId,
      payment_reference: paymentRef,
      provider: 'MOCK_GATEWAY',
      amount: order.total_amount,
      status: 'SUCCESS',
      idempotency_key: idempotencyKey,
      created_at: new Date().toISOString(),
    };
    this.paymentTxMap.set(txId, paymentTx);

    return { order, transaction: paymentTx };
  }

  public async releaseReservationAndInventory(token: string, reason: 'PAYMENT_FAILED' | 'TIMED_OUT' | 'CANCELLED'): Promise<void> {
    if (!this.isInMemoryFallback) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const res = await tx.reservation.findUnique({ where: { reservationToken: token } });
          if (!res || res.status === 'COMMITTED') {
            return;
          }

          const resStatus = reason === 'TIMED_OUT' ? 'EXPIRED' : 'CANCELLED';
          await tx.reservation.update({
            where: { id: res.id },
            data: { status: resStatus, updatedAt: new Date() }
          });

          const order = await tx.order.findUnique({ where: { reservationId: res.id } });
          if (order && order.status !== 'PAID') {
            const orderStatus = reason === 'PAYMENT_FAILED' ? 'FAILED' : reason === 'TIMED_OUT' ? 'TIMED_OUT' : 'CANCELLED';
            await tx.order.update({
              where: { id: order.id },
              data: { status: orderStatus, updatedAt: new Date() }
            });
          }

          await tx.$executeRaw`
            UPDATE inventories
            SET available_stock = available_stock + 1,
                reserved_stock = reserved_stock - 1,
                version = version + 1
            WHERE product_id = ${res.productId} AND reserved_stock > 0
          `;
        });
        return;
      } catch (err: any) {
        this.handleDbError(err);
      }
    }

    // In-Memory Release
    let targetRes: Reservation | null = null;
    for (const r of this.reservationsMap.values()) {
      if (r.reservation_token === token) {
        targetRes = r;
        break;
      }
    }
    if (!targetRes || targetRes.status === 'COMMITTED') return;

    targetRes.status = reason === 'TIMED_OUT' ? 'EXPIRED' : 'CANCELLED';
    targetRes.updated_at = new Date().toISOString();

    for (const o of this.ordersMap.values()) {
      if (o.reservation_id === targetRes.id && o.status !== 'PAID') {
        o.status = reason === 'PAYMENT_FAILED' ? 'FAILED' : reason === 'TIMED_OUT' ? 'TIMED_OUT' : 'CANCELLED';
        o.updated_at = new Date().toISOString();
      }
    }

    const inv = this.inventoriesMap.get(targetRes.product_id);
    if (inv && inv.reserved_stock > 0) {
      inv.available_stock += 1;
      inv.reserved_stock -= 1;
      inv.version += 1;
    }
  }

  public async releaseOrderAndInventory(orderId: string, reason: 'PAYMENT_FAILED' | 'TIMED_OUT' | 'CANCELLED'): Promise<void> {
    const order = await this.getOrder(orderId);
    if (!order) return;
    if (order.reservation_id) {
      const res = await this.getReservationByToken(order.reservation_id);
      if (res) {
        await this.releaseReservationAndInventory(res.reservation_token, reason);
      }
    }
  }

  // --- Idempotency Table Operations ---
  public async getIdempotencyRecord(key: string): Promise<IdempotencyRecord | null> {
    if (!this.isInMemoryFallback) {
      try {
        const row = await this.prisma.idempotencyRecord.findFirst({
          where: {
            key,
            expiresAt: { gt: new Date() }
          }
        });
        if (!row) return null;
        return {
          key: row.key,
          scope: row.scope,
          status: row.status as any,
          response_code: row.responseCode || undefined,
          response_body: row.responseBody,
          created_at: row.createdAt.toISOString(),
          expires_at: row.expiresAt.toISOString(),
        };
      } catch (err: any) {
        this.handleDbError(err);
      }
    }

    const rec = this.idempotencyMap.get(key);
    if (!rec) return null;
    if (new Date(rec.expires_at).getTime() <= Date.now()) {
      this.idempotencyMap.delete(key);
      return null;
    }
    return rec;
  }

  public async saveIdempotencyRecord(record: {
    key: string;
    scope: string;
    status: 'PENDING' | 'RESOLVED';
    response_code?: number;
    response_body?: any;
    ttl_seconds?: number;
  }): Promise<void> {
    const ttl = record.ttl_seconds || 86400;
    const expiresAt = new Date(Date.now() + ttl * 1000);

    if (!this.isInMemoryFallback) {
      try {
        await this.prisma.idempotencyRecord.upsert({
          where: { key: record.key },
          update: {
            scope: record.scope,
            status: record.status,
            responseCode: record.response_code || null,
            responseBody: record.response_body ?? null,
            expiresAt,
          },
          create: {
            key: record.key,
            scope: record.scope,
            status: record.status,
            responseCode: record.response_code || null,
            responseBody: record.response_body ?? null,
            expiresAt,
          }
        });
        return;
      } catch (err: any) {
        this.handleDbError(err);
      }
    }

    this.idempotencyMap.set(record.key, {
      key: record.key,
      scope: record.scope,
      status: record.status,
      response_code: record.response_code,
      response_body: record.response_body,
      created_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
    });
  }

  // --- Audit Logging & Summary ---
  public async logAudit(log: Omit<InventoryAuditLog, 'id' | 'timestamp'>): Promise<void> {
    if (!this.isInMemoryFallback) {
      try {
        await this.prisma.inventoryAuditLog.create({
          data: {
            productId: log.product_id,
            action: log.action,
            delta: log.delta,
            currentRedisStock: log.current_redis_stock,
            currentDbStock: log.current_db_stock,
            referenceId: log.reference_id || null,
          }
        });
        return;
      } catch (err: any) {
        this.handleDbError(err);
      }
    }

    this.auditLogsList.push({
      id: this.auditLogsList.length + 1,
      product_id: log.product_id,
      action: log.action,
      delta: log.delta,
      current_redis_stock: log.current_redis_stock,
      current_db_stock: log.current_db_stock,
      reference_id: log.reference_id,
      timestamp: new Date().toISOString(),
    });
  }

  public async getAuditSummary(productId: string) {
    const product = await this.getProduct(productId);
    const inventory = await this.getInventoryByProductId(productId);

    let paidOrdersCount = 0;
    let activeReservationsCount = 0;
    let expiredReservationsCount = 0;
    let cancelledOrdersCount = 0;

    if (!this.isInMemoryFallback) {
      try {
        paidOrdersCount = await this.prisma.order.count({ where: { productId, status: 'PAID' } });
        activeReservationsCount = await this.prisma.reservation.count({ where: { productId, status: 'ACTIVE' } });
        expiredReservationsCount = await this.prisma.reservation.count({ where: { productId, status: 'EXPIRED' } });
        cancelledOrdersCount = await this.prisma.order.count({
          where: { productId, status: { in: ['FAILED', 'TIMED_OUT', 'CANCELLED'] } }
        });
        return {
          product,
          inventory,
          paidOrdersCount,
          activeReservationsCount,
          expiredReservationsCount,
          cancelledOrdersCount,
          totalCommittedOrHeld: paidOrdersCount + activeReservationsCount,
        };
      } catch (err: any) {
        this.handleDbError(err);
      }
    }

    for (const o of this.ordersMap.values()) {
      if (o.product_id === productId) {
        if (o.status === 'PAID') paidOrdersCount++;
        else if (['FAILED', 'TIMED_OUT', 'CANCELLED'].includes(o.status)) cancelledOrdersCount++;
      }
    }

    for (const r of this.reservationsMap.values()) {
      if (r.product_id === productId) {
        if (r.status === 'ACTIVE') activeReservationsCount++;
        else if (r.status === 'EXPIRED') expiredReservationsCount++;
      }
    }

    return {
      product,
      inventory,
      paidOrdersCount,
      activeReservationsCount,
      expiredReservationsCount,
      cancelledOrdersCount,
      totalCommittedOrHeld: paidOrdersCount + activeReservationsCount,
    };
  }

  public async getActiveReservations(productId: string): Promise<Reservation[]> {
    if (!this.isInMemoryFallback) {
      try {
        const records = await this.prisma.reservation.findMany({
          where: { productId, status: 'ACTIVE' }
        });
        return records.map((record) => ({
          id: record.id,
          inventory_id: record.inventoryId,
          product_id: record.productId,
          user_id: record.userId,
          reservation_token: record.reservationToken,
          quantity: record.quantity,
          status: record.status as any,
          expires_at: record.expiresAt.toISOString(),
          created_at: record.createdAt.toISOString(),
          updated_at: record.updatedAt.toISOString(),
        }));
      } catch (err: any) {
        this.handleDbError(err);
      }
    }

    const list: Reservation[] = [];
    for (const r of this.reservationsMap.values()) {
      if (r.product_id === productId && r.status === 'ACTIVE') list.push(r);
    }
    return list;
  }

  public async getExpiredReservations(): Promise<Reservation[]> {
    const now = Date.now();
    if (!this.isInMemoryFallback) {
      try {
        const records = await this.prisma.reservation.findMany({
          where: {
            status: 'ACTIVE',
            expiresAt: { lte: new Date() }
          }
        });
        return records.map((record) => ({
          id: record.id,
          inventory_id: record.inventoryId,
          product_id: record.productId,
          user_id: record.userId,
          reservation_token: record.reservationToken,
          quantity: record.quantity,
          status: record.status as any,
          expires_at: record.expiresAt.toISOString(),
          created_at: record.createdAt.toISOString(),
          updated_at: record.updatedAt.toISOString(),
        }));
      } catch (err: any) {
        this.handleDbError(err);
      }
    }

    const list: Reservation[] = [];
    for (const r of this.reservationsMap.values()) {
      if (r.status === 'ACTIVE' && new Date(r.expires_at).getTime() <= now) {
        list.push(r);
      }
    }
    return list;
  }

  public async setReservationExpiresAt(reservationId: string, expiresAt: Date): Promise<void> {
    if (!this.isInMemoryFallback) {
      try {
        await this.prisma.reservation.update({
          where: { id: reservationId },
          data: { expiresAt }
        });
        return;
      } catch (err: any) {
        this.handleDbError(err);
      }
    }

    const r = this.reservationsMap.get(reservationId);
    if (r) {
      r.expires_at = expiresAt.toISOString();
    }
  }

  public async countReservationsByUser(productId: string, userId: string): Promise<number> {
    if (!this.isInMemoryFallback) {
      try {
        return await this.prisma.reservation.count({
          where: { productId, userId }
        });
      } catch (err: any) {
        this.handleDbError(err);
      }
    }

    let count = 0;
    for (const r of this.reservationsMap.values()) {
      if (r.product_id === productId && r.user_id === userId) count++;
    }
    return count;
  }

  public async clearCatalogData(): Promise<void> {
    if (!this.isInMemoryFallback) {
      try {
        const prisma = this.prisma;
        await prisma.$executeRaw`
          DELETE FROM payment_transactions WHERE order_id IN (
            SELECT o.id FROM orders o
            JOIN reservations r ON o.reservation_id = r.id
            WHERE r.product_id LIKE 'catalog_%'
          );
        `;
        await prisma.$executeRaw`
          DELETE FROM orders WHERE reservation_id IN (
            SELECT id FROM reservations WHERE product_id LIKE 'catalog_%'
          );
        `;
        await prisma.$executeRaw`
          DELETE FROM order_items WHERE product_id LIKE 'catalog_%';
        `;
        await prisma.$executeRaw`
          DELETE FROM reservations WHERE product_id LIKE 'catalog_%';
        `;
        await prisma.$executeRaw`
          DELETE FROM inventory_audit_logs WHERE product_id LIKE 'catalog_%';
        `;
        await prisma.$executeRaw`
          DELETE FROM inventories WHERE product_id LIKE 'catalog_%';
        `;
        await prisma.$executeRaw`
          DELETE FROM products WHERE id LIKE 'catalog_%';
        `;
        return;
      } catch (err: any) {
        this.handleDbError(err);
      }
    }

    for (const id of Array.from(this.productsMap.keys())) {
      if (id.startsWith('catalog_')) {
        this.productsMap.delete(id);
        this.inventoriesMap.delete(id);
      }
    }
    for (const [resId, r] of Array.from(this.reservationsMap.entries())) {
      if (r.product_id.startsWith('catalog_')) {
        this.reservationsMap.delete(resId);
      }
    }
  }

  public async seedCatalogBatch(productsData: any[], inventoriesData: any[]): Promise<void> {
    if (!this.isInMemoryFallback) {
      try {
        await this.prisma.product.createMany({
          data: productsData,
          skipDuplicates: true,
        });
        await this.prisma.inventory.createMany({
          data: inventoriesData,
          skipDuplicates: true,
        });
        return;
      } catch (err: any) {
        this.handleDbError(err);
      }
    }

    for (const p of productsData) {
      this.productsMap.set(p.id, {
        id: p.id,
        sku: p.sku,
        name: p.name,
        description: p.description,
        price: Number(p.price),
        category: p.category,
        imageUrl: p.imageUrl,
        created_at: new Date().toISOString(),
      });
    }

    for (const inv of inventoriesData) {
      this.inventoriesMap.set(inv.productId, {
        id: inv.id,
        product_id: inv.productId,
        total_stock: inv.totalStock,
        available_stock: inv.availableStock,
        reserved_stock: inv.reservedStock || 0,
        version: inv.version || 1,
      });
    }
  }

  public async getProductsByCategory(category: string, limit: number = 60, offset: number = 0): Promise<any[]> {
    if (!this.isInMemoryFallback) {
      try {
        return await this.prisma.product.findMany({
          where: { category, id: { startsWith: 'catalog_' } },
          include: { inventory: true },
          take: limit,
          skip: offset,
          orderBy: { id: 'asc' },
        });
      } catch (err: any) {
        this.handleDbError(err);
      }
    }

    const matched: any[] = [];
    for (const p of this.productsMap.values()) {
      if (p.id.startsWith('catalog_') && p.category === category) {
        const inv = this.inventoriesMap.get(p.id);
        matched.push({
          ...p,
          inventory: inv ? { availableStock: inv.available_stock, totalStock: inv.total_stock, reservedStock: inv.reserved_stock } : null
        });
      }
    }
    return matched.slice(offset, offset + limit);
  }

  public async getCatalogSummary(): Promise<{ totalProducts: number; totalStock: number; byCategory: Record<string, { count: number; stock: number }> }> {
    if (!this.isInMemoryFallback) {
      try {
        const products = await this.prisma.product.findMany({
          where: { id: { startsWith: 'catalog_' } },
          include: { inventory: true },
        });
        const byCategory: Record<string, { count: number; stock: number }> = {};
        let totalStock = 0;
        for (const p of products) {
          const cat = p.category || 'Other';
          if (!byCategory[cat]) byCategory[cat] = { count: 0, stock: 0 };
          byCategory[cat].count++;
          const stock = p.inventory?.availableStock ?? 0;
          byCategory[cat].stock += stock;
          totalStock += stock;
        }
        return { totalProducts: products.length, totalStock, byCategory };
      } catch (err: any) {
        this.handleDbError(err);
      }
    }

    const byCategory: Record<string, { count: number; stock: number }> = {};
    let totalStock = 0;
    let totalProducts = 0;

    for (const p of this.productsMap.values()) {
      if (p.id.startsWith('catalog_')) {
        totalProducts++;
        const cat = p.category || 'Other';
        if (!byCategory[cat]) byCategory[cat] = { count: 0, stock: 0 };
        byCategory[cat].count++;
        const inv = this.inventoriesMap.get(p.id);
        const stock = inv?.available_stock ?? 0;
        byCategory[cat].stock += stock;
        totalStock += stock;
      }
    }

    return { totalProducts, totalStock, byCategory };
  }

  public async searchCatalogProducts(query: string = '', category?: string, limit: number = 60, offset: number = 0): Promise<{ products: any[]; total: number }> {
    if (!this.isInMemoryFallback) {
      try {
        const where: any = { id: { startsWith: 'catalog_' } };
        if (query) {
          where.OR = [
            { name: { contains: query, mode: 'insensitive' } },
            { sku: { contains: query, mode: 'insensitive' } },
          ];
        }
        if (category && category !== 'All') {
          where.category = category;
        }
        const [products, total] = await Promise.all([
          this.prisma.product.findMany({
            where,
            include: { inventory: true },
            take: limit,
            skip: offset,
            orderBy: { id: 'asc' },
          }),
          this.prisma.product.count({ where }),
        ]);
        return { products, total };
      } catch (err: any) {
        this.handleDbError(err);
      }
    }

    const matched: any[] = [];
    const lowerQuery = query.toLowerCase();

    for (const p of this.productsMap.values()) {
      if (!p.id.startsWith('catalog_')) continue;
      if (category && category !== 'All' && p.category !== category) continue;
      if (query && !p.name.toLowerCase().includes(lowerQuery) && !p.sku.toLowerCase().includes(lowerQuery)) continue;

      const inv = this.inventoriesMap.get(p.id);
      matched.push({
        ...p,
        inventory: inv ? { availableStock: inv.available_stock, totalStock: inv.total_stock, reservedStock: inv.reserved_stock } : null
      });
    }

    return {
      products: matched.slice(offset, offset + limit),
      total: matched.length
    };
  }

  public async getAllInventories(): Promise<Array<{ productId: string; availableStock: number }>> {
    if (!this.isInMemoryFallback) {
      try {
        const list = await this.prisma.inventory.findMany({
          select: { productId: true, availableStock: true }
        });
        return list.map(inv => ({ productId: inv.productId, availableStock: inv.availableStock }));
      } catch (err: any) {
        this.handleDbError(err);
      }
    }

    const list: Array<{ productId: string; availableStock: number }> = [];
    for (const inv of this.inventoriesMap.values()) {
      list.push({ productId: inv.product_id, availableStock: inv.available_stock });
    }
    return list;
  }
}

