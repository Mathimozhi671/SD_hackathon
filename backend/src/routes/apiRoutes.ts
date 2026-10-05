import { Router, Request, Response } from 'express';
import { ProductService } from '../services/productService.js';
import { InventoryService } from '../services/inventoryService.js';
import { ReservationService } from '../services/reservationService.js';
import { OrderService } from '../services/orderService.js';
import { PaymentService } from '../services/paymentService.js';
import { TelemetryService } from '../services/telemetryService.js';
import { LoadTester } from '../simulation/loadTester.js';
import { MultiProductLoadTester } from '../simulation/multiProductLoadTester.js';
import { CatalogSeeder } from '../services/catalogSeeder.js';

export function createApiRouter(): Router {
  const router = Router();
  const productService = ProductService.getInstance();
  const inventoryService = InventoryService.getInstance();
  const reservationService = ReservationService.getInstance();
  const orderService = OrderService.getInstance();
  const paymentService = PaymentService.getInstance();
  const telemetryService = TelemetryService.getInstance();
  const loadTester = new LoadTester();

  // ==========================================
  // 1. PRODUCT ENDPOINTS
  // ==========================================
  router.get('/products/:id', async (req: Request, res: Response) => {
    const productId = req.params.id as string;
    const product = await productService.getProduct(productId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    return res.json({ product });
  });

  // ==========================================
  // 2. INVENTORY ENDPOINTS
  // ==========================================
  router.get('/inventory/:productId', async (req: Request, res: Response) => {
    const productId = req.params.productId as string;
    const summary = await inventoryService.getStatus(productId);
    if (!summary.inventory) {
      return res.status(404).json({ error: 'Inventory not found for product' });
    }
    return res.json({
      product: summary.product,
      inventory: summary.inventory,
      paid_orders: summary.paidOrdersCount,
      active_reservations: summary.activeReservationsCount,
      expired_reservations: summary.expiredReservationsCount,
    });
  });

  // ==========================================
  // 3. RESERVATION ENDPOINTS (Fast Path Concurrency)
  // ==========================================
  router.post('/reservations/reserve', async (req: Request, res: Response) => {
    const productId = req.body.product_id || 'prod_quantum_headset_2026';
    const userId = req.body.user_id || (req.headers['x-user-id'] as string) || `user_${Math.random().toString(36).substring(7)}`;
    const idempotencyKey = (req.headers['idempotency-key'] as string) || req.body.idempotency_key;
    const ttlSeconds = req.body.ttl_seconds ? parseInt(req.body.ttl_seconds, 10) : 300;

    const result = await reservationService.createReservation(productId, userId, idempotencyKey, ttlSeconds);

    if (result.status === 'SOLD_OUT') {
      return res.status(409).json(result);
    }
    if (result.status === 'DUPLICATE_USER') {
      return res.status(429).json(result);
    }
    if (!result.success) {
      return res.status(500).json(result);
    }

    return res.status(201).json(result);
  });

  router.get('/reservations/:token', async (req: Request, res: Response) => {
    const token = req.params.token as string;
    const reservation = await reservationService.getReservation(token);
    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    return res.json({ reservation });
  });

  router.post('/reservations/:token/release', async (req: Request, res: Response) => {
    const token = req.params.token as string;
    const released = await reservationService.releaseReservation(token, 'CANCELLED');
    if (!released) {
      return res.status(400).json({ error: 'Could not release reservation (not found or not active)' });
    }
    return res.json({ message: 'Reservation successfully released back to inventory' });
  });

  // ==========================================
  // 4. ORDER & CHECKOUT ENDPOINTS (Idempotent)
  // ==========================================
  router.post('/orders/checkout', async (req: Request, res: Response) => {
    const { reservation_token } = req.body;
    const idempotencyKey = (req.headers['idempotency-key'] as string) || req.body.idempotency_key || `idem_chk_${reservation_token}`;

    if (!reservation_token) {
      return res.status(400).json({ error: 'reservation_token is required' });
    }

    const result = await orderService.checkoutReservation(reservation_token, idempotencyKey);
    if (!result.success) {
      return res.status(result.code || 400).json({ error: result.error });
    }

    return res.status(200).json({ order: result.order });
  });

  router.get('/orders/:id', async (req: Request, res: Response) => {
    const orderId = req.params.id as string;
    const order = await orderService.getOrder(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    return res.json({ order });
  });

  // ==========================================
  // 5. PAYMENT ENDPOINTS (Idempotent 2-Phase Commit)
  // ==========================================
  router.post('/payments/process', async (req: Request, res: Response) => {
    const { order_id, simulate_mode, card_last4 } = req.body;
    const idempotencyKey = (req.headers['idempotency-key'] as string) || req.body.idempotency_key || `idem_pay_${order_id}`;

    if (!order_id) {
      return res.status(400).json({ error: 'order_id is required' });
    }

    const result = await paymentService.processPayment({
      orderId: order_id,
      idempotencyKey,
      simulateMode: simulate_mode || 'SUCCESS',
      cardLast4: card_last4 || '4242',
    });

    if (!result.success) {
      return res.status(result.code || 400).json({ error: result.error });
    }

    return res.status(200).json({
      order: result.order,
      transaction: result.transaction,
    });
  });

  // ==========================================
  // BACKWARD COMPATIBLE FLASH-SALE ALIASES (UI & Benchmark)
  // ==========================================
  router.get('/flash-sales/:id', async (req: Request, res: Response) => {
    const rawId = req.params.id as string;
    const productId = rawId === 'sale-syscrafters-2026' ? 'prod_quantum_headset_2026' : rawId;
    const summary = await inventoryService.getStatus(productId);
    if (!summary.product) {
      return res.status(404).json({ error: 'Flash sale product not found' });
    }
    return res.json({
      sale: {
        id: rawId,
        title: summary.product.name,
        total_stock: summary.inventory?.total_stock ?? 100,
        available_stock: summary.inventory?.available_stock ?? 100,
        reserved_stock: summary.inventory?.reserved_stock ?? 0,
        price: summary.product.price,
        status: 'ACTIVE',
      },
      paid_orders: summary.paidOrdersCount,
      active_reservations: summary.activeReservationsCount,
      expired_reservations: summary.expiredReservationsCount,
    });
  });

  router.post('/flash-sales/:id/reserve', async (req: Request, res: Response) => {
    const rawId = req.params.id as string;
    const productId = rawId === 'sale-syscrafters-2026' ? 'prod_quantum_headset_2026' : rawId;
    const userId = req.body.user_id || (req.headers['x-user-id'] as string) || `user_${Math.random().toString(36).substring(7)}`;
    const idempotencyKey = (req.headers['idempotency-key'] as string) || req.body.idempotency_key;
    const ttlSeconds = req.body.ttl_seconds ? parseInt(req.body.ttl_seconds, 10) : 300;

    const result = await reservationService.createReservation(productId, userId, idempotencyKey, ttlSeconds);

    if (result.status === 'SOLD_OUT') {
      return res.status(409).json(result);
    }
    if (result.status === 'DUPLICATE_USER') {
      return res.status(429).json(result);
    }
    if (!result.success) {
      return res.status(500).json(result);
    }

    return res.status(201).json(result);
  });

  // ==========================================
  // TELEMETRY, SIMULATION & AUDIT
  // ==========================================
  router.get('/telemetry', (req: Request, res: Response) => {
    return res.json(telemetryService.getMetrics());
  });

  router.post('/simulation/run-10k-burst', async (req: Request, res: Response) => {
    const totalUsers = req.body.total_users ? parseInt(req.body.total_users, 10) : 10000;
    const initialStock = req.body.initial_stock ? parseInt(req.body.initial_stock, 10) : 100;
    const result = await loadTester.run10kBurst(totalUsers, initialStock);
    return res.json(result);
  });

  router.post('/simulation/run-lifecycle', async (req: Request, res: Response) => {
    const result = await loadTester.runFullLifecycleSimulation();
    return res.json(result);
  });

  router.post('/simulation/run-idempotency', async (req: Request, res: Response) => {
    const replays = req.body.replays ? parseInt(req.body.replays, 10) : 500;
    const result = await loadTester.runIdempotencyTest(replays);
    return res.json(result);
  });

  router.post('/admin/reset', async (req: Request, res: Response) => {
    const productId = req.body.product_id || 'prod_quantum_headset_2026';
    const totalStock = req.body.total_stock ? parseInt(req.body.total_stock, 10) : 100;

    await inventoryService.reset(productId, totalStock);
    const status = await inventoryService.getStatus(productId);
    return res.json({
      message: `System reset successfully. Inventory restored to ${totalStock} units in PostgreSQL. All active holds and orders cleared.`,
      status,
    });
  });

  router.get('/audit/:id', async (req: Request, res: Response) => {
    const rawId = req.params.id as string;
    const productId = rawId === 'sale-syscrafters-2026' ? 'prod_quantum_headset_2026' : rawId;
    const summary = await inventoryService.getStatus(productId);
    const product = summary.product;
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const initialStock = summary.inventory?.total_stock ?? 100;
    const paidOrders = summary.paidOrdersCount;
    const activeHolds = summary.activeReservationsCount;
    const currentDbAvailable = summary.inventory?.available_stock ?? 0;
    const oversoldCount = Math.max(0, (paidOrders + activeHolds) - initialStock);
    const invariantZeroOversell = oversoldCount === 0;

    return res.json({
      product_id: product.id,
      product_name: product.name,
      total_initial_stock: initialStock,
      paid_orders: paidOrders,
      active_holds: activeHolds,
      expired_holds: summary.expiredReservationsCount,
      cancelled_orders: summary.cancelledOrdersCount,
      db_available_stock: currentDbAvailable,
      oversold_count: oversoldCount,
      zero_oversell_invariant_passed: invariantZeroOversell,
      audit_status: invariantZeroOversell ? 'VERIFIED_CORRECT' : 'INVARIANT_VIOLATED',
    });
  });

  // ==========================================
  // 6. MULTI-PRODUCT HIGH-SCALE CATALOG & SIMULATION
  // (10,000 Customers vs 1,000 Products Architecture)
  // ==========================================
  const catalogSeeder = CatalogSeeder.getInstance();
  const multiProductTester = MultiProductLoadTester.getInstance();

  router.get('/catalog/summary', async (req: Request, res: Response) => {
    try {
      const summary = await catalogSeeder.getCatalogSummary();
      return res.json(summary);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.get('/catalog/products', async (req: Request, res: Response) => {
    try {
      const category = req.query.category as string | undefined;
      const query = (req.query.q as string | undefined) || '';
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 48;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const offset = (page - 1) * limit;

      const result = await catalogSeeder.searchProducts(query, category, limit, offset);
      return res.json({
        products: result.products,
        total: result.total,
        page,
        limit,
        totalPages: Math.ceil(result.total / limit),
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.post('/catalog/seed', async (req: Request, res: Response) => {
    try {
      const count = req.body.count ? parseInt(req.body.count, 10) : 1000;
      const products = await catalogSeeder.seedCatalog(count);
      return res.json({
        message: `Successfully seeded ${products.length} catalog products with isolated stock counters`,
        count: products.length,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.post('/simulation/run-multi-product', async (req: Request, res: Response) => {
    try {
      const customers = req.body.customers ? parseInt(req.body.customers, 10) : 10000;
      const products = req.body.products ? parseInt(req.body.products, 10) : 1000;
      const batchSize = req.body.batch_size ? parseInt(req.body.batch_size, 10) : 250;
      const result = await multiProductTester.run10kCustomers1kProducts(customers, products, batchSize);
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.post('/simulation/run-multi-cart', async (req: Request, res: Response) => {
    try {
      const customers = req.body.customers ? parseInt(req.body.customers, 10) : 500;
      const itemsPerCart = req.body.items_per_cart ? parseInt(req.body.items_per_cart, 10) : 3;
      const result = await multiProductTester.runMultiItemCartSimulation(customers, itemsPerCart);
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.get('/simulation/architecture', (req: Request, res: Response) => {
    return res.json(multiProductTester.getShardArchitectureDiagram());
  });

  return router;
}
