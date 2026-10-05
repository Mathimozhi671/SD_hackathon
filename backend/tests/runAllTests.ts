import { LoadTester } from '../src/simulation/loadTester.js';
import { MultiProductLoadTester } from '../src/simulation/multiProductLoadTester.js';

async function runAll() {
  console.log('========================================================================');
  console.log('   SALESTORM SysCrafters 2026: Comprehensive System Verification Suite  ');
  console.log('========================================================================\n');

  const tester = new LoadTester();

  // Test 1: Idempotency
  console.log('▶ [TEST 1/4] IDEMPOTENCY & REPLAY ATTACK');
  const idemResult = await tester.runIdempotencyTest(500);
  console.log(`  Result: ${idemResult.passed ? 'PASSED ✓' : 'FAILED ✗'}`);
  console.log(`  ${idemResult.message}\n`);

  // Test 2: 10,000 Burst
  console.log('▶ [TEST 2/4] 10,000 CONCURRENT USERS VS 100 STOCK BURST');
  const burstResult = await tester.run10kBurst(10000, 100);
  console.log(`  Requests: ${burstResult.totalUsers} in ${burstResult.durationMs}ms (${burstResult.rps} RPS)`);
  console.log(`  Latencies: P50=${burstResult.p50Ms}ms, P95=${burstResult.p95Ms}ms, P99=${burstResult.p99Ms}ms`);
  console.log(`  Successful Reservations: ${burstResult.successfulReservations}/100`);
  console.log(`  Sold Out (409) Rejections: ${burstResult.soldOutCount}`);
  console.log(`  Oversold Count: ${burstResult.oversoldCount}`);
  console.log(`  Result: ${burstResult.invariantPassed ? 'PASSED (Zero Overselling Verified) ✓' : 'FAILED ✗'}\n`);

  // Test 3: Full Lifecycle & Failure Recovery
  console.log('▶ [TEST 3/4] FULL LIFECYCLE, PAYMENT FAILURE & TIMEOUT RESTOCK');
  const lifecycleResult = await tester.runFullLifecycleSimulation();
  console.log(`  Initial Stock: ${lifecycleResult.initialStock}`);
  console.log(`  Completed Orders: ${lifecycleResult.paidOrders}`);
  console.log(`  Failed Payments Handled: ${lifecycleResult.failedPayments}`);
  console.log(`  Expired Holds Swept: ${lifecycleResult.expiredHolds}`);
  console.log(`  Final Available Stock: ${lifecycleResult.remainingStock}`);
  console.log(`  Oversold Count: ${lifecycleResult.oversoldCount}`);
  console.log(`  Result: ${lifecycleResult.invariantPassed ? 'PASSED (Self-Healing Recovery Verified) ✓' : 'FAILED ✗'}\n`);

  // Test 4: High-Scale Multi-Product Traffic Sharding & Cart Contention
  console.log('▶ [TEST 4/4] HIGH-SCALE MULTI-PRODUCT & CART ATOMIC RESERVATION');
  const multiTester = MultiProductLoadTester.getInstance();
  const multiResult = await multiTester.run10kCustomers1kProducts(10000, 1000, 250);
  console.log(`  Shards: ${multiResult.totalProductsCatalog} products | Stock Pool: ${multiResult.totalCatalogStock} units`);
  console.log(`  Granted Checkouts: ${multiResult.successfulCartCheckouts} | Rejections: ${multiResult.partialOrFailedCarts}`);
  console.log(`  Oversold Violations: ${multiResult.oversoldCount}`);
  console.log(`  Throughput: ${multiResult.rps} RPS | Latencies: P50=${multiResult.p50Ms}ms, P95=${multiResult.p95Ms}ms, P99=${multiResult.p99Ms}ms`);
  console.log(`  Result: ${multiResult.invariantPassed ? 'PASSED (Distributed Zero-Oversell Proven) ✓' : 'FAILED ✗'}\n`);

  const cartResult = await multiTester.runMultiItemCartSimulation(500, 3);
  console.log(`  Cart Simulation: ${cartResult.totalCarts} carts (${cartResult.fullyReserved} reserved, ${cartResult.partialRolledBack} rolled back)`);

  console.log('\n========================================================================');
  const allPassed = idemResult.passed && burstResult.invariantPassed && lifecycleResult.invariantPassed && multiResult.invariantPassed;
  if (allPassed) {
    console.log('  ALL 4 VERIFICATION SUITES PASSED WITH 100% CORRECTNESS!              ');
    console.log('  Zero overselling, sharded throughput, idempotency & recovery proven. ');
  } else {
    console.error('  SOME TESTS FAILED! Check logs above.                                  ');
    process.exit(1);
  }
  console.log('========================================================================');
}

runAll().catch((err) => {
  console.error('Test suite runner encountered fatal error:', err);
  process.exit(1);
});
