import { AppDatabase } from '../database/db.js';
import { getRedisClient, IRedisClient } from '../redis/client.js';
import { IdempotencyRecord } from '../types/index.js';

export class IdempotencyService {
  private db: AppDatabase;
  private redis: IRedisClient;
  private static instance: IdempotencyService | null = null;

  constructor() {
    this.db = AppDatabase.getInstance();
    this.redis = getRedisClient();
  }

  public static getInstance(): IdempotencyService {
    if (!IdempotencyService.instance) {
      IdempotencyService.instance = new IdempotencyService();
    }
    return IdempotencyService.instance;
  }

  public async get(key: string): Promise<IdempotencyRecord | null> {
    // 1. Check Redis first
    const cached = await this.redis.checkIdempotency(key);
    if (cached) {
      return cached;
    }

    // 2. Check Database
    const dbRecord = await this.db.getIdempotencyRecord(key);
    if (dbRecord) {
      // Re-populate in Redis
      await this.redis.setIdempotency(key, dbRecord, 86400);
      return dbRecord;
    }

    return null;
  }

  public async acquireLock(key: string, scope: string, ttlSeconds: number = 60): Promise<boolean> {
    const existing = await this.get(key);
    if (existing) {
      return false; // Key already claimed
    }

    const record: IdempotencyRecord = {
      key,
      scope,
      status: 'PENDING',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };

    // Store in Redis and DB
    await this.redis.setIdempotency(key, record, ttlSeconds);
    await this.db.saveIdempotencyRecord({
      key,
      scope,
      status: 'PENDING',
      ttl_seconds: ttlSeconds,
    });

    return true;
  }

  public async resolve(
    key: string,
    scope: string,
    responseCode: number,
    responseBody: any,
    ttlSeconds: number = 86400
  ): Promise<void> {
    const record: IdempotencyRecord = {
      key,
      scope,
      status: 'RESOLVED',
      response_code: responseCode,
      response_body: responseBody,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };

    await this.redis.setIdempotency(key, record, ttlSeconds);
    await this.db.saveIdempotencyRecord({
      key,
      scope,
      status: 'RESOLVED',
      response_code: responseCode,
      response_body: responseBody,
      ttl_seconds: ttlSeconds,
    });
  }
}
