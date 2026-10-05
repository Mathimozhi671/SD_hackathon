import { AppDatabase } from '../database/db.js';
import { InventoryService } from './inventoryService.js';

export class ExpiryService {
  private db: AppDatabase;
  private inventoryService: InventoryService;
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private static instance: ExpiryService | null = null;

  constructor() {
    this.db = AppDatabase.getInstance();
    this.inventoryService = InventoryService.getInstance();
  }

  public static getInstance(): ExpiryService {
    if (!ExpiryService.instance) {
      ExpiryService.instance = new ExpiryService();
    }
    return ExpiryService.instance;
  }

  public start(intervalMs: number = 2000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.timer = setInterval(async () => {
      try {
        await this.sweepExpiredReservations();
      } catch (err) {
        console.error('[ExpiryService] Error during sweep:', err);
      }
    }, intervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }

  public async sweepExpiredReservations(): Promise<number> {
    const expiredReservations = await this.db.getExpiredReservations();

    let sweptCount = 0;
    for (const res of expiredReservations) {
      try {
        await this.inventoryService.release(
          res.product_id,
          res.user_id,
          res.reservation_token,
          'TIMED_OUT'
        );
        sweptCount++;
      } catch (err) {
        console.error(`[ExpiryService] Failed to sweep token ${res.reservation_token}:`, err);
      }
    }

    return sweptCount;
  }
}
