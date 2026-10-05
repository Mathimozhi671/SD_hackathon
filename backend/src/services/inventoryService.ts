import { v4 as uuidv4 } from 'uuid';
import { AppDatabase } from '../database/db.js';
import { getRedisClient, IRedisClient } from '../redis/client.js';
import { TelemetryService } from './telemetryService.js';
import { IdempotencyService } from './idempotencyService.js';
import { Inventory } from '../types/index.js';

export interface ReserveResult {
  success: boolean;
  status: 'RESERVED' | 'SOLD_OUT' | 'DUPLICATE_USER' | 'ERROR';
  reservation_token?: string;
  product_id: string;
  user_id: string;
  expires_at?: string;
  ttl_seconds?: number;
  remaining_stock?: number;
  message?: string;
}

export class InventoryService {
  private db: AppDatabase;
  private redis: IRedisClient;
  private telemetry: TelemetryService;
  private idempotency: IdempotencyService;
  private static instance: InventoryService | null = null;

  constructor() {
    this.db = AppDatabase.getInstance();
    this.redis = getRedisClient();
    this.telemetry = TelemetryService.getInstance();
    this.idempotency = IdempotencyService.getInstance();
  }

  public static getInstance(): InventoryService {
    if (!InventoryService.instance) {
      InventoryService.instance = new InventoryService();
    }
    return InventoryService.instance;
  }

  public async initializeInventory(productId: string = 'prod_quantum_headset_2026', totalStock: number = 100): Promise<void> {
    const { inventory } = await this.db.seedProductAndInventory(productId, 'SKU-QUANTUM-PRO', 'SysCrafters 2026 Edition Quantum Pro Headset', 299.99, totalStock);
    await this.redis.init(productId, inventory.available_stock);
    this.telemetry.setStockLevels(inventory.available_stock, inventory.available_stock, inventory.reserved_stock);
  }

  /**
   * Concurrency-safe atomic reservation:
   * 1. Check idempotency for duplicate requests
   * 2. Atomic Redis check-and-decrement (no lock contention, sub-millisecond)
   * 3. Concurrency-safe relational DB update (UPDATE ... WHERE available_stock > 0)
   * 4. Enforce strict invariant: committed + reserved <= 100
   */
  public async reserve(
    productId: string,
    userId: string,
    idempotencyKey?: string,
    ttlSeconds: number = 300
  ): Promise<ReserveResult> {
    const startTime = Date.now();

    // 1. Idempotency Check
    if (idempotencyKey) {
      const existing = await this.idempotency.get(idempotencyKey);
      if (existing && existing.status === 'RESOLVED') {
        return existing.response_body;
      }
    }

    const token = `res_${uuidv4().replace(/-/g, '')}`;

    // 2. Fast Path: Ensure Redis is hydrated with PostgreSQL inventory for this product
    const initialRedisStock = await this.redis.getStock(productId);
    if (initialRedisStock === 0) {
      const dbInv = await this.db.getInventoryByProductId(productId);
      if (dbInv && dbInv.available_stock > 0) {
        await this.redis.setStock(productId, dbInv.available_stock);
      }
    }

    const redisResult = await this.redis.reserveStock(productId, userId, token, ttlSeconds);
    const latency = Date.now() - startTime;
    this.telemetry.recordRequest(latency);

    if (redisResult.status === 'DUPLICATE_USER') {
      this.telemetry.recordDuplicate();
      const res: ReserveResult = {
        success: false,
        status: 'DUPLICATE_USER',
        product_id: productId,
        user_id: userId,
        message: 'Account has already participated in this flash sale event.',
      };
      if (idempotencyKey) {
        await this.idempotency.resolve(idempotencyKey, 'reserve', 429, res, 60);
      }
      return res;
    }

    if (redisResult.status === 'SOLD_OUT') {
      this.telemetry.recordSoldOut();
      const res: ReserveResult = {
        success: false,
        status: 'SOLD_OUT',
        product_id: productId,
        user_id: userId,
        remaining_stock: 0,
        message: 'All units for this product have been reserved or sold out.',
      };
      if (idempotencyKey) {
        await this.idempotency.resolve(idempotencyKey, 'reserve', 409, res, 60);
      }
      return res;
    }

    // 3. Concurrency-Safe Database Update
    const dbReserved = await this.db.reserveInventoryAtomic(productId);
    if (!dbReserved) {
      // Rollback Redis if DB rejects (e.g. strict DB check constraint)
      await this.redis.releaseStock(productId, userId, token);
      this.telemetry.recordSoldOut();
      return {
        success: false,
        status: 'SOLD_OUT',
        product_id: productId,
        user_id: userId,
        remaining_stock: 0,
        message: 'Inventory exhausted at database layer.',
      };
    }

    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const inventory = await this.db.getInventoryByProductId(productId);
    const reservationRecord = await this.db.createReservationRecord({
      id: uuidv4(),
      inventory_id: inventory!.id,
      product_id: productId,
      user_id: userId,
      reservation_token: token,
      expires_at: expiresAt,
    });

    const currentRedisStock = redisResult.remaining_stock ?? 0;
    const currentDbAvailable = inventory?.available_stock ?? 0;
    const currentDbReserved = inventory?.reserved_stock ?? 0;

    this.telemetry.recordReservationSuccess();
    this.telemetry.setStockLevels(currentRedisStock, currentDbAvailable, currentDbReserved);

    // Immutable Audit Log
    await this.db.logAudit({
      product_id: productId,
      action: 'RESERVE',
      delta: -1,
      current_redis_stock: currentRedisStock,
      current_db_stock: currentDbAvailable,
      reference_id: reservationRecord.id,
    });

    const response: ReserveResult = {
      success: true,
      status: 'RESERVED',
      reservation_token: token,
      product_id: productId,
      user_id: userId,
      expires_at: expiresAt,
      ttl_seconds: ttlSeconds,
      remaining_stock: currentRedisStock,
      message: 'Product reserved successfully. Complete payment before expiration.',
    };

    if (idempotencyKey) {
      await this.idempotency.resolve(idempotencyKey, 'reserve', 201, response, ttlSeconds);
    }

    return response;
  }

  public async release(productId: string, userId: string, token: string, reason: 'PAYMENT_FAILED' | 'TIMED_OUT' | 'CANCELLED'): Promise<void> {
    const redisResult = await this.redis.releaseStock(productId, userId, token);

    await this.db.releaseReservationAndInventory(token, reason);

    const inventory = await this.db.getInventoryByProductId(productId);
    const redisStock = redisResult.restored_stock ?? (await this.redis.getStock(productId));
    const dbAvailable = inventory?.available_stock ?? 0;
    const dbReserved = inventory?.reserved_stock ?? 0;

    this.telemetry.setStockLevels(redisStock, dbAvailable, dbReserved);

    if (reason === 'TIMED_OUT') {
      this.telemetry.recordExpiry();
    }

    const reservation = await this.db.getReservationByToken(token);
    await this.db.logAudit({
      product_id: productId,
      action: reason === 'TIMED_OUT' ? 'EXPIRE' : 'RELEASE',
      delta: 1,
      current_redis_stock: redisStock,
      current_db_stock: dbAvailable,
      reference_id: reservation?.id,
    });
  }

  public async commit(productId: string, userId: string, token: string): Promise<void> {
    await this.redis.commitStock(productId, userId, token);
    await this.db.updateReservationStatus(token, 'COMMITTED');

    const inventory = await this.db.getInventoryByProductId(productId);
    const redisStock = await this.redis.getStock(productId);
    const dbAvailable = inventory?.available_stock ?? 0;
    const dbReserved = inventory?.reserved_stock ?? 0;

    this.telemetry.setStockLevels(redisStock, dbAvailable, dbReserved);
  }

  public async reset(productId: string = 'prod_quantum_headset_2026', totalStock: number = 100): Promise<void> {
    await this.db.resetSystem(productId, totalStock);
    await this.redis.reset(productId, totalStock);
    this.telemetry.reset(totalStock);
  }

  public async getStatus(productId: string = 'prod_quantum_headset_2026') {
    return await this.db.getAuditSummary(productId);
  }
}
