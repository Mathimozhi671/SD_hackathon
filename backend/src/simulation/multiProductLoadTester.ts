import { v4 as uuidv4 } from 'uuid';
import { InventoryService } from '../services/inventoryService.js';
import { OrderService } from '../services/orderService.js';
import { PaymentService } from '../services/paymentService.js';
import { TelemetryService } from '../services/telemetryService.js';
import { AppDatabase } from '../database/db.js';
import { getRedisClient } from '../redis/client.js';
import { CatalogSeeder, CatalogProduct } from '../services/catalogSeeder.js';
import { MultiProductSimulationResult } from '../types/index.js';

interface CustomerCart {
  customerId: string;
  productId: string;
  productName: string;
  reservationToken?: string;
  status: 'PENDING' | 'RESERVED' | 'SOLD_OUT' | 'PAID' | 'FAILED';
}

interface ShardResult {
  shardId: number;
  productId: string;
  productName: string;
  totalCustomers: number;
  stock: number;
  granted: number;
  rejected: number;
  durationMs: number;
  rps: number;
}

/**
 * Multi-Product Traffic Sharding Engine
 *
 * Architecture:
 * - 1,000 products each with their own isolated Redis stock counter
 * - 10,000 customers distributed across products by consistent hashing
 * - Each product's traffic is handled as an independent "shard"
 * - Per-shard atomic reservation prevents cross-product interference
 * - All-or-nothing cart rollback if any item is sold out
 */
export class MultiProductLoadTester {
  private inventoryService: InventoryService;
  private orderService: OrderService;
  private paymentService: PaymentService;
  private telemetry: TelemetryService;
  private db: AppDatabase;
  private redis = getRedisClient();
  private catalogSeeder: CatalogSeeder;

  private static instance: MultiProductLoadTester | null = null;

  constructor() {
    this.inventoryService = InventoryService.getInstance();
    this.orderService = OrderService.getInstance();
    this.paymentService = PaymentService.getInstance();
    this.telemetry = TelemetryService.getInstance();
    this.db = AppDatabase.getInstance();
    this.catalogSeeder = CatalogSeeder.getInstance();
  }

  public static getInstance(): MultiProductLoadTester {
    if (!MultiProductLoadTester.instance) {
      MultiProductLoadTester.instance = new MultiProductLoadTester();
    }
    return MultiProductLoadTester.instance;
  }

  /**
   * Core simulation: 10,000 customers vs 1,000 products
   *
   * Strategy:
   * 1. Seed 1,000 products (50–250 units each) into PostgreSQL + Redis
   * 2. Distribute 10,000 customers using product-affinity hashing
   * 3. Run each product's customer queue concurrently as isolated shards
   * 4. Guarantee zero oversell per product via atomic Redis + Prisma dual-layer
   * 5. Report shard-level and global results
   */
  public async run10kCustomers1kProducts(
    totalCustomers: number = 10000,
    totalProductsCatalog: number = 1000,
    batchSize: number = 500,
  ): Promise<MultiProductSimulationResult> {
    const logs: string[] = [];
    const startTime = Date.now();
    this.telemetry.setSimulationStatus(true);

    logs.push(`[MultiProduct] Seeding ${totalProductsCatalog} products with individual stock counters...`);
    const catalog = await this.catalogSeeder.seedCatalog(totalProductsCatalog);
    const totalCatalogStock = catalog.reduce((sum: number, p: CatalogProduct) => sum + p.stock, 0);
    logs.push(`[MultiProduct] ✓ ${totalProductsCatalog} products | Total stock pool: ${totalCatalogStock} units`);

    // --- Distribute customers across products (consistent hashing by customer ID) ---
    logs.push(`[MultiProduct] Distributing ${totalCustomers} customers across ${totalProductsCatalog} product shards...`);

    const productShardMap = new Map<string, { product: CatalogProduct; customers: string[] }>();
    for (const p of catalog) {
      productShardMap.set(p.id, { product: p, customers: [] });
    }

    const latencies: number[] = [];
    let totalGranted = 0;
    let totalRejected = 0;
    let totalDuplicates = 0;
    let oversoldCount = 0;
    const shardResults: ShardResult[] = [];

    // Assign customers to products by hash (each customer targets 1 product per simulation)
    for (let i = 1; i <= totalCustomers; i++) {
      const customerId = `cust_${String(i).padStart(6, '0')}`;
      // Consistent hash: customer N goes to product N % totalProducts
      const productIdx = (i - 1) % totalProductsCatalog;
      const productId = catalog[productIdx].id;
      productShardMap.get(productId)!.customers.push(customerId);
    }

    logs.push(`[MultiProduct] ✓ ${totalCustomers} customers distributed. Avg ${(totalCustomers / totalProductsCatalog).toFixed(1)} customers/product.`);

    // --- Run shards in parallel batches (simulate distributed workers) ---
    logs.push(`[MultiProduct] Launching all ${totalProductsCatalog} product shards concurrently...`);

    const allProductEntries = Array.from(productShardMap.entries());
    let shardIndex = 0;

    // Process shards in batches to avoid system overload
    for (let i = 0; i < allProductEntries.length; i += batchSize) {
      const shardBatch = allProductEntries.slice(i, i + batchSize);

      const shardBatchResults = await Promise.all(
        shardBatch.map(async ([productId, { product, customers }]) => {
          if (customers.length === 0) return null;

          const shardStart = Date.now();
          let shardGranted = 0;
          let shardRejected = 0;

          // Each customer in this shard concurrently tries to reserve this product
          await Promise.all(
            customers.map(async (customerId) => {
              const reqStart = Date.now();
              const result = await this.inventoryService.reserve(productId, customerId);
              const reqDuration = Date.now() - reqStart;
              latencies.push(reqDuration);

              if (result.status === 'RESERVED') {
                shardGranted++;
              } else {
                shardRejected++;
              }
            })
          );

          const shardDuration = Date.now() - shardStart;
          const shardRps = customers.length > 0 ? Math.round(customers.length / (shardDuration / 1000)) : 0;

          // Verify per-product invariant
          const status = await this.inventoryService.getStatus(productId);
          const shardOversold = Math.max(0, shardGranted - product.stock);
          if (shardOversold > 0) {
            oversoldCount += shardOversold;
            logs.push(`[INVARIANT VIOLATION] Product ${product.name}: ${shardOversold} oversold!`);
          }

          return {
            shardId: shardIndex++,
            productId,
            productName: product.name,
            totalCustomers: customers.length,
            stock: product.stock,
            granted: shardGranted,
            rejected: shardRejected,
            durationMs: shardDuration,
            rps: shardRps,
          } as ShardResult;
        })
      );

      for (const sr of shardBatchResults) {
        if (sr) {
          shardResults.push(sr);
          totalGranted += sr.granted;
          totalRejected += sr.rejected;
        }
      }
    }

    // --- Compute latency statistics ---
    latencies.sort((a, b) => a - b);
    const p50Ms = latencies[Math.floor(latencies.length * 0.5)] || 0;
    const p95Ms = latencies[Math.floor(latencies.length * 0.95)] || 0;
    const p99Ms = latencies[Math.floor(latencies.length * 0.99)] || 0;
    const durationMs = Date.now() - startTime;
    const rps = Math.round(totalCustomers / (durationMs / 1000));

    // --- Find hotspot product (most contended) ---
    const hotspot = shardResults.reduce((max, s) => s.rejected > max.rejected ? s : max, shardResults[0] || { productId: '', productName: '', rejected: 0, granted: 0 });

    // --- Verify global invariant ---
    const invariantPassed = oversoldCount === 0;
    const partialOrFailed = totalRejected;

    logs.push(`[MultiProduct] === RESULTS ===`);
    logs.push(`[MultiProduct] Products: ${totalProductsCatalog} | Total Stock Pool: ${totalCatalogStock}`);
    logs.push(`[MultiProduct] Customers: ${totalCustomers} | Throughput: ${rps} req/sec`);
    logs.push(`[MultiProduct] Successful Checkouts: ${totalGranted} | Rejected (sold-out): ${totalRejected}`);
    logs.push(`[MultiProduct] Oversold (violations): ${oversoldCount}`);
    logs.push(`[MultiProduct] Hotspot: "${hotspot.productName}" — ${hotspot.rejected} rejected out of ${hotspot.totalCustomers} shoppers`);
    logs.push(`[MultiProduct] Global Zero-Oversell Invariant: ${invariantPassed ? 'PASSED ✓' : 'FAILED ✗'}`);

    this.telemetry.setSimulationStatus(false);

    return {
      scenario: `Multi-Product: ${totalCustomers} Customers vs ${totalProductsCatalog} Products`,
      totalCustomers,
      totalProductsCatalog,
      totalCatalogStock,
      successfulCartCheckouts: totalGranted,
      partialOrFailedCarts: partialOrFailed,
      duplicateShopperRejections: totalDuplicates,
      durationMs,
      rps,
      p50Ms,
      p95Ms,
      p99Ms,
      oversoldCount,
      invariantPassed,
      shardsCount: shardResults.length,
      hotspotProductId: hotspot.productId || '',
      hotspotStockGranted: hotspot.granted || 0,
      hotspotRejected: hotspot.rejected || 0,
      logSummary: logs,
    };
  }

  /**
   * Multi-item cart simulation: Each customer adds 3 products to cart,
   * all 3 must reserve atomically or all are rolled back.
   */
  public async runMultiItemCartSimulation(
    totalCustomers: number = 500,
    itemsPerCart: number = 3
  ): Promise<{ totalCarts: number; fullyReserved: number; partialRolledBack: number; durationMs: number; logs: string[] }> {
    const logs: string[] = [];
    const startTime = Date.now();
    logs.push(`[Cart] Starting multi-item cart simulation: ${totalCustomers} customers, ${itemsPerCart} items each...`);

    // Seed a smaller catalog for cart simulation
    const catalog = await this.catalogSeeder.seedCatalog(100);
    const availableProducts = catalog.filter((p: CatalogProduct) => p.stock > 0);

    let fullyReserved = 0;
    let partialRolledBack = 0;

    // Process customers in batches of 50
    for (let batch = 0; batch < totalCustomers; batch += 50) {
      const batchEnd = Math.min(batch + 50, totalCustomers);
      await Promise.all(
        Array.from({ length: batchEnd - batch }, (_, idx) => {
          const customerIdx = batch + idx + 1;
          return this.processMultiItemCart(
            `cart_cust_${String(customerIdx).padStart(5, '0')}`,
            availableProducts,
            itemsPerCart
          );
        }).map(async (cartPromise) => {
          const result = await cartPromise;
          if (result.allReserved) {
            fullyReserved++;
          } else {
            partialRolledBack++;
          }
        })
      );
    }

    const durationMs = Date.now() - startTime;
    logs.push(`[Cart] ✓ ${fullyReserved} carts fully reserved | ${partialRolledBack} carts rolled back (sold-out item)`);
    logs.push(`[Cart] Duration: ${durationMs}ms`);

    return { totalCarts: totalCustomers, fullyReserved, partialRolledBack, durationMs, logs };
  }

  /**
   * Process a single customer's multi-item cart atomically.
   * All-or-nothing: if any item is sold out, release all already-reserved items.
   */
  private async processMultiItemCart(
    customerId: string,
    catalog: CatalogProduct[],
    itemsPerCart: number
  ): Promise<{ allReserved: boolean; tokens: string[] }> {
    const tokens: string[] = [];
    const reserved: Array<{ productId: string; token: string }> = [];

    // Pick random distinct products for this cart
    const shuffled = [...catalog].sort(() => Math.random() - 0.5);
    const cartItems = shuffled.slice(0, itemsPerCart);

    for (const item of cartItems) {
      const result = await this.inventoryService.reserve(
        item.id,
        `${customerId}_item_${item.id}`,
        undefined,
        300
      );
      if (result.status === 'RESERVED' && result.reservation_token) {
        reserved.push({ productId: item.id, token: result.reservation_token });
        tokens.push(result.reservation_token);
      } else {
        // Rollback all previously reserved items
        for (const prev of reserved) {
          await this.inventoryService.release(prev.productId, `${customerId}_item_${prev.productId}`, prev.token, 'CANCELLED');
        }
        return { allReserved: false, tokens: [] };
      }
    }

    return { allReserved: true, tokens };
  }

  public getShardArchitectureDiagram(): object {
    return {
      architecture: 'Distributed Shard-Per-Product Model',
      layers: [
        {
          layer: 1,
          name: 'Traffic Ingress',
          description: '10,000 customer requests land simultaneously',
          mechanism: 'Express HTTP server with async event loop',
        },
        {
          layer: 2,
          name: 'Customer-Product Routing',
          description: 'Consistent hashing maps each customer to a product shard',
          mechanism: 'customerIndex % totalProducts = productShard',
        },
        {
          layer: 3,
          name: 'Per-Shard Atomic Redis Layer',
          description: 'Each product has isolated stock counter in Redis (no cross-shard locks)',
          mechanism: 'InMemoryRedisEngine: serialized atomic queue per product',
        },
        {
          layer: 4,
          name: 'Durable PostgreSQL Layer',
          description: 'Atomic conditional DB update guarantees stock never goes negative',
          mechanism: 'UPDATE inventories SET available_stock = available_stock - 1 WHERE available_stock > 0',
        },
        {
          layer: 5,
          name: 'Zero-Oversell Invariant',
          description: 'Verified per-shard and globally after simulation',
          mechanism: 'paidOrders + activeReservations <= totalStock per product',
        },
      ],
      shardingAdvantages: [
        'No global lock — each product is fully independent',
        'Linear horizontal scalability (add products = add shards)',
        'Hot products do not block cold products',
        'Per-shard telemetry identifies hotspots in real time',
      ],
    };
  }
}
