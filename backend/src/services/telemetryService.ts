import { WebSocket } from 'ws';
import { TelemetryMetrics } from '../types/index.js';

export class TelemetryService {
  private static instance: TelemetryService | null = null;
  private wsClients = new Set<WebSocket>();

  private metrics: TelemetryMetrics = {
    totalRequests: 0,
    activeRequests: 0,
    successfulReservations: 0,
    soldOutRejections: 0,
    duplicateRejections: 0,
    paidOrders: 0,
    failedPayments: 0,
    expiredHolds: 0,
    currentRedisStock: 100,
    currentDbAvailableStock: 100,
    currentDbReservedStock: 0,
    rps: 0,
    p50LatencyMs: 0,
    p95LatencyMs: 0,
    p99LatencyMs: 0,
    oversoldCount: 0,
    isSimulating: false,
  };

  private latencies: number[] = [];
  private requestCountInWindow = 0;
  private rpsInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startRpsWindow();
  }

  public static getInstance(): TelemetryService {
    if (!TelemetryService.instance) {
      TelemetryService.instance = new TelemetryService();
    }
    return TelemetryService.instance;
  }

  public registerClient(ws: WebSocket): void {
    this.wsClients.add(ws);
    // Send immediate snapshot
    ws.send(JSON.stringify({ type: 'SNAPSHOT', data: this.metrics }));

    ws.on('close', () => {
      this.wsClients.delete(ws);
    });
  }

  private startRpsWindow(): void {
    this.rpsInterval = setInterval(() => {
      this.metrics.rps = this.requestCountInWindow;
      this.requestCountInWindow = 0;

      // Compute latencies
      if (this.latencies.length > 0) {
        this.latencies.sort((a, b) => a - b);
        const p50Idx = Math.floor(this.latencies.length * 0.50);
        const p95Idx = Math.floor(this.latencies.length * 0.95);
        const p99Idx = Math.floor(this.latencies.length * 0.99);

        this.metrics.p50LatencyMs = Math.round(this.latencies[p50Idx] || 0);
        this.metrics.p95LatencyMs = Math.round(this.latencies[p95Idx] || 0);
        this.metrics.p99LatencyMs = Math.round(this.latencies[p99Idx] || 0);

        // Keep at most last 1000 items
        if (this.latencies.length > 1000) {
          this.latencies = this.latencies.slice(-500);
        }
      }

      this.broadcast();
    }, 1000);
  }

  public recordRequest(latencyMs: number): void {
    this.metrics.totalRequests++;
    this.requestCountInWindow++;
    this.latencies.push(latencyMs);
  }

  public recordReservationSuccess(): void {
    this.metrics.successfulReservations++;
  }

  public recordSoldOut(): void {
    this.metrics.soldOutRejections++;
  }

  public recordDuplicate(): void {
    this.metrics.duplicateRejections++;
  }

  public recordPaymentSuccess(): void {
    this.metrics.paidOrders++;
  }

  public recordPaymentFailure(): void {
    this.metrics.failedPayments++;
  }

  public recordExpiry(): void {
    this.metrics.expiredHolds++;
  }

  public setStockLevels(redisStock: number, dbAvailable: number, dbReserved: number): void {
    this.metrics.currentRedisStock = redisStock;
    this.metrics.currentDbAvailableStock = dbAvailable;
    this.metrics.currentDbReservedStock = dbReserved;

    // Check oversell invariant
    const totalCommittedOrHeld = this.metrics.paidOrders + dbReserved;
    if (totalCommittedOrHeld > 100) {
      this.metrics.oversoldCount = totalCommittedOrHeld - 100;
    } else {
      this.metrics.oversoldCount = 0;
    }
  }

  public setSimulationStatus(isSimulating: boolean): void {
    this.metrics.isSimulating = isSimulating;
    this.broadcast();
  }

  public getMetrics(): TelemetryMetrics {
    return { ...this.metrics };
  }

  public reset(initialStock: number = 100): void {
    this.metrics = {
      totalRequests: 0,
      activeRequests: 0,
      successfulReservations: 0,
      soldOutRejections: 0,
      duplicateRejections: 0,
      paidOrders: 0,
      failedPayments: 0,
      expiredHolds: 0,
      currentRedisStock: initialStock,
      currentDbAvailableStock: initialStock,
      currentDbReservedStock: 0,
      rps: 0,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      p99LatencyMs: 0,
      oversoldCount: 0,
      isSimulating: false,
    };
    this.latencies = [];
    this.requestCountInWindow = 0;
    this.broadcast();
  }

  public broadcast(extraPayload?: Record<string, any>): void {
    const payload = JSON.stringify({
      type: 'METRICS_UPDATE',
      data: this.metrics,
      timestamp: new Date().toISOString(),
      ...extraPayload,
    });

    for (const ws of this.wsClients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }
}
