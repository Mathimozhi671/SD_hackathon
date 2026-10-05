import { AppDatabase } from '../database/db.js';
import { InventoryService, ReserveResult } from './inventoryService.js';
import { Reservation } from '../types/index.js';

export class ReservationService {
  private db: AppDatabase;
  private inventoryService: InventoryService;
  private static instance: ReservationService | null = null;

  constructor() {
    this.db = AppDatabase.getInstance();
    this.inventoryService = InventoryService.getInstance();
  }

  public static getInstance(): ReservationService {
    if (!ReservationService.instance) {
      ReservationService.instance = new ReservationService();
    }
    return ReservationService.instance;
  }

  public async createReservation(
    productId: string,
    userId: string,
    idempotencyKey?: string,
    ttlSeconds: number = 300
  ): Promise<ReserveResult> {
    return await this.inventoryService.reserve(productId, userId, idempotencyKey, ttlSeconds);
  }

  public async getReservation(token: string): Promise<Reservation | null> {
    return await this.db.getReservationByToken(token);
  }

  public async releaseReservation(
    token: string,
    reason: 'PAYMENT_FAILED' | 'TIMED_OUT' | 'CANCELLED' = 'CANCELLED'
  ): Promise<boolean> {
    const reservation = await this.db.getReservationByToken(token);
    if (!reservation || reservation.status !== 'ACTIVE') {
      return false;
    }

    await this.inventoryService.release(
      reservation.product_id,
      reservation.user_id,
      token,
      reason
    );
    return true;
  }

  public async commitReservation(token: string): Promise<boolean> {
    const reservation = await this.db.getReservationByToken(token);
    if (!reservation || reservation.status !== 'ACTIVE') {
      return false;
    }

    await this.inventoryService.commit(
      reservation.product_id,
      reservation.user_id,
      token
    );
    return true;
  }
}
