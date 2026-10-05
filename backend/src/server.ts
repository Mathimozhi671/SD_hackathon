import 'dotenv/config';
import http from 'http';
import { WebSocketServer } from 'ws';
import { createApp } from './app.js';
import { InventoryService } from './services/inventoryService.js';
import { ExpiryService } from './services/expiryService.js';
import { TelemetryService } from './services/telemetryService.js';
import { CatalogSeeder } from './services/catalogSeeder.js';

const PORT = process.env.PORT || 3000;

async function bootstrap() {
  const app = createApp();
  const server = http.createServer(app);

  // Initialize WebSocket Server for Live Dashboard Telemetry
  const wss = new WebSocketServer({ server });
  const telemetry = TelemetryService.getInstance();

  wss.on('connection', (ws) => {
    telemetry.registerClient(ws);
  });

  // Initialize flash-sale inventory (Quantum Headset, 100 stock)
  const inventoryService = InventoryService.getInstance();
  await inventoryService.initializeInventory('prod_quantum_headset_2026', 100);

  // Start Expiry Sweeper
  const expiryService = ExpiryService.getInstance();
  expiryService.start(2000);

  server.listen(PORT, () => {
    console.log(`================================================================`);
    console.log(`  SALESTORM High-Scale Flash Sale Engine (SysCrafters 2026)     `);
    console.log(`  Database: PostgreSQL 18 (salestorm) via Prisma Client          `);
    console.log(`  Engine: Redis Atomic Lua / In-Memory Dual Layer Architecture  `);
    console.log(`  HTTP & WebSocket Server running at: http://localhost:${PORT}  `);
    console.log(`  Live Cockpit UI: http://localhost:${PORT}/                    `);
    console.log(`  API Status: http://localhost:${PORT}/api/v1/flash-sales/sale-syscrafters-2026`);
    console.log(`================================================================`);

    // Seed or sync 1,000 catalog products into Redis on startup
    const catalogSeeder = CatalogSeeder.getInstance();
    catalogSeeder.getCatalogSummary().then(async (summary) => {
      if (summary.totalProducts < 100) {
        console.log(`[Startup] Seeding catalog with 1,000 products...`);
        try {
          const products = await catalogSeeder.seedCatalog(1000);
          console.log(`[Startup] ✓ Catalog seeded: ${products.length} products across 8 categories in PostgreSQL & Redis.`);
        } catch (err: any) {
          console.error('[Startup] Catalog seeding failed:', err.message);
        }
      } else {
        console.log(`[Startup] ✓ Catalog already has ${summary.totalProducts} products. Syncing stock into Redis...`);
        await catalogSeeder.syncAllInventoriesToRedis();
      }
    }).catch(async () => {
      try {
        await catalogSeeder.seedCatalog(1000);
      } catch (e: any) {
        console.error('[Startup] Seeding error:', e.message);
      }
    });
  });
}

bootstrap().catch((err) => {
  console.error('Fatal initialization error:', err);
  process.exit(1);
});
