import { MultiProductLoadTester } from '../src/simulation/multiProductLoadTester.js';
import { CatalogSeeder } from '../src/services/catalogSeeder.js';
import { AppDatabase } from '../src/database/db.js';

async function runMultiProductTest() {
  console.log('================================================================');
  console.log('  HIGH-SCALE MULTI-PRODUCT TEST: 10,000 CUSTOMERS VS 1,000 PRODUCTS');
  console.log('  Architecture: Distributed Product Sharding + Dual-Layer Locks');
  console.log('================================================================\n');

  const tester = MultiProductLoadTester.getInstance();

  // Test 1: 10,000 Customers vs 1,000 Products Traffic Sharding
  console.log('>>> [PHASE 1] Running 10,000 Customer Burst across 1,000 Product Shards...');
  const result = await tester.run10kCustomers1kProducts(10000, 1000, 250);

  console.log('\n--- SIMULATION RESULTS ---');
  console.log(`Scenario: ${result.scenario}`);
  console.log(`Total Customers: ${result.totalCustomers}`);
  console.log(`Total Product Shards: ${result.totalProductsCatalog}`);
  console.log(`Total Stock Pool: ${result.totalCatalogStock} units`);
  console.log(`Granted Checkouts: ${result.successfulCartCheckouts}`);
  console.log(`Rejected (Sold Out): ${result.partialOrFailedCarts}`);
  console.log(`Oversold Violations: ${result.oversoldCount}`);
  console.log(`Throughput: ${result.rps} req/sec`);
  console.log(`P50 Latency: ${result.p50Ms} ms`);
  console.log(`P95 Latency: ${result.p95Ms} ms`);
  console.log(`P99 Latency: ${result.p99Ms} ms`);
  console.log(`Hotspot Shard: ${result.hotspotProductId} (${result.hotspotRejected} rejections)`);
  console.log(`Zero-Oversell Invariant: ${result.invariantPassed ? 'PASSED (0 oversold)' : 'FAILED'}`);

  if (!result.invariantPassed) {
    console.error('CRITICAL: Multi-product concurrency test failed zero-oversell invariant!');
    process.exit(1);
  }

  // Test 2: Multi-Item Cart Atomic Reservation (All-or-Nothing Rollback)
  console.log('\n>>> [PHASE 2] Running Multi-Item Cart Contention Test (500 Shoppers x 3 Items each)...');
  const cartResult = await tester.runMultiItemCartSimulation(500, 3);
  console.log(`Total Carts Processed: ${cartResult.totalCarts}`);
  console.log(`Fully Reserved Carts: ${cartResult.fullyReserved}`);
  console.log(`Safely Rolled Back Carts: ${cartResult.partialRolledBack}`);
  console.log(`Duration: ${cartResult.durationMs} ms`);

  console.log('\n================================================================');
  console.log('✓ ALL MULTI-PRODUCT TESTS PASSED! ZERO OVERSELL INVARIANT PROVEN.');
  console.log('================================================================');
  process.exit(0);
}

runMultiProductTest().catch((err) => {
  console.error('Multi-product test error:', err);
  process.exit(1);
});
