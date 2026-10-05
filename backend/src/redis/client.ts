import { LUA_RESERVE_STOCK, LUA_RELEASE_STOCK, LUA_COMMIT_STOCK } from './luaScripts.js';

export interface ReserveResult {
  status: 'RESERVED' | 'SOLD_OUT' | 'DUPLICATE_USER' | 'ERROR';
  remaining_stock?: number;
  reservation_token?: string;
  ttl?: number;
  message?: string;
}

export interface ReleaseResult {
  status: 'RELEASED' | 'ALREADY_EXPIRED_OR_ABSENT' | 'ERROR';
  restored_stock?: number;
  message?: string;
}

export interface CommitResult {
  status: 'COMMITTED' | 'ERROR';
  token?: string;
  message?: string;
}

export interface IRedisClient {
  init(saleId: string, initialStock: number): Promise<void>;
  reserveStock(saleId: string, userId: string, token: string, ttlSeconds: number): Promise<ReserveResult>;
  releaseStock(saleId: string, userId: string, token: string): Promise<ReleaseResult>;
  commitStock(saleId: string, userId: string, token: string): Promise<CommitResult>;
  getStock(saleId: string): Promise<number>;
  setStock(saleId: string, stock: number): Promise<void>;
  checkIdempotency(key: string): Promise<any | null>;
  setIdempotency(key: string, value: any, ttlSeconds: number): Promise<void>;
  reset(saleId: string, initialStock: number): Promise<void>;
  getAllActiveReservations(): Promise<Array<{ token: string; saleId: string; userId: string; expiresAt: number }>>;
}

/**
 * High-performance In-Memory Redis Engine.
 * Matches Redis single-threaded atomic execution characteristics.
 * Guarantees zero race conditions even with 10,000 simultaneous asynchronous event loops.
 */
export class InMemoryRedisEngine implements IRedisClient {
  private kv = new Map<string, string>();
  private sets = new Map<string, Set<string>>();
  private expiries = new Map<string, number>();
  private reservations = new Map<string, { saleId: string; userId: string; expiresAt: number }>();
  
  // Single-threaded critical section queue simulating Redis event loop serialization
  private lockPromise: Promise<void> = Promise.resolve();

  private async atomic<T>(action: () => T): Promise<T> {
    let release: () => void = () => {};
    const nextPromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const currentPromise = this.lockPromise;
    this.lockPromise = currentPromise.then(() => nextPromise);

    await currentPromise;
    try {
      this.purgeExpired();
      return action();
    } finally {
      release();
    }
  }

  private purgeExpired(): void {
    const now = Date.now();
    for (const [key, exp] of this.expiries.entries()) {
      if (exp <= now) {
        this.expiries.delete(key);
        this.kv.delete(key);
        if (this.reservations.has(key)) {
          this.reservations.delete(key);
        }
      }
    }
  }

  public async init(saleId: string, initialStock: number): Promise<void> {
    await this.setStock(saleId, initialStock);
  }

  public async getStock(saleId: string): Promise<number> {
    return this.atomic(() => {
      const stock = this.kv.get(`flash_sale:stock:${saleId}`);
      return stock ? parseInt(stock, 10) : 0;
    });
  }

  public async setStock(saleId: string, stock: number): Promise<void> {
    return this.atomic(() => {
      this.kv.set(`flash_sale:stock:${saleId}`, stock.toString());
    });
  }

  public async reserveStock(
    saleId: string,
    userId: string,
    token: string,
    ttlSeconds: number
  ): Promise<ReserveResult> {
    return this.atomic(() => {
      const stockKey = `flash_sale:stock:${saleId}`;
      const userSetKey = `flash_sale:users:${saleId}`;
      const reservationKey = `flash_sale:res:${token}`;

      let userSet = this.sets.get(userSetKey);
      if (!userSet) {
        userSet = new Set<string>();
        this.sets.set(userSetKey, userSet);
      }

      // 1. Anti-hoarding check: Has user already reserved or purchased?
      if (userSet.has(userId)) {
        return {
          status: 'DUPLICATE_USER',
          message: 'User has already reserved or purchased this product.',
        };
      }

      // 2. Strict inventory check
      const currentStockStr = this.kv.get(stockKey) || '0';
      const currentStock = parseInt(currentStockStr, 10);

      if (currentStock <= 0) {
        return {
          status: 'SOLD_OUT',
          message: 'Stock exhausted. No units available.',
          remaining_stock: 0,
        };
      }

      // 3. Atomic Decrement and Registration
      const newStock = currentStock - 1;
      this.kv.set(stockKey, newStock.toString());
      userSet.add(userId);

      const expiresAt = Date.now() + ttlSeconds * 1000;
      this.kv.set(reservationKey, userId);
      this.expiries.set(reservationKey, expiresAt);
      this.reservations.set(token, { saleId, userId, expiresAt });

      return {
        status: 'RESERVED',
        remaining_stock: newStock,
        reservation_token: token,
        ttl: ttlSeconds,
      };
    });
  }

  public async releaseStock(saleId: string, userId: string, token: string): Promise<ReleaseResult> {
    return this.atomic(() => {
      const stockKey = `flash_sale:stock:${saleId}`;
      const userSetKey = `flash_sale:users:${saleId}`;
      const reservationKey = `flash_sale:res:${token}`;

      this.reservations.delete(token);
      this.expiries.delete(reservationKey);
      this.kv.delete(reservationKey);

      const userSet = this.sets.get(userSetKey);
      if (userSet) {
        userSet.delete(userId);
      }

      const currentStockStr = this.kv.get(stockKey) || '0';
      const currentStock = parseInt(currentStockStr, 10);
      const newStock = currentStock + 1;
      this.kv.set(stockKey, newStock.toString());

      return {
        status: 'RELEASED',
        restored_stock: newStock,
      };
    });
  }

  public async commitStock(saleId: string, userId: string, token: string): Promise<CommitResult> {
    return this.atomic(() => {
      const reservationKey = `flash_sale:res:${token}`;
      const committedSetKey = `flash_sale:committed:${saleId}`;

      this.reservations.delete(token);
      this.expiries.delete(reservationKey);
      this.kv.delete(reservationKey);

      let committedSet = this.sets.get(committedSetKey);
      if (!committedSet) {
        committedSet = new Set<string>();
        this.sets.set(committedSetKey, committedSet);
      }
      committedSet.add(userId);

      return {
        status: 'COMMITTED',
        token,
      };
    });
  }

  public async checkIdempotency(key: string): Promise<any | null> {
    return this.atomic(() => {
      const item = this.kv.get(`idempotency:${key}`);
      if (!item) return null;
      try {
        return JSON.parse(item);
      } catch {
        return item;
      }
    });
  }

  public async setIdempotency(key: string, value: any, ttlSeconds: number): Promise<void> {
    return this.atomic(() => {
      const idKey = `idempotency:${key}`;
      this.kv.set(idKey, JSON.stringify(value));
      this.expiries.set(idKey, Date.now() + ttlSeconds * 1000);
    });
  }

  public async reset(saleId: string, initialStock: number): Promise<void> {
    return this.atomic(() => {
      this.kv.clear();
      this.sets.clear();
      this.expiries.clear();
      this.reservations.clear();
      this.kv.set(`flash_sale:stock:${saleId}`, initialStock.toString());
    });
  }

  public async getAllActiveReservations(): Promise<Array<{ token: string; saleId: string; userId: string; expiresAt: number }>> {
    return this.atomic(() => {
      const now = Date.now();
      const active: Array<{ token: string; saleId: string; userId: string; expiresAt: number }> = [];
      for (const [token, data] of this.reservations.entries()) {
        if (data.expiresAt > now) {
          active.push({ token, ...data });
        }
      }
      return active;
    });
  }
}

// Singleton provider
let redisInstance: IRedisClient | null = null;

export function getRedisClient(): IRedisClient {
  if (!redisInstance) {
    redisInstance = new InMemoryRedisEngine();
  }
  return redisInstance;
}
