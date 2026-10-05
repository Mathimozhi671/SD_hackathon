import { LoadTester } from '../src/simulation/loadTester.js';

async function runConcurrencyTest() {
  console.log('--- STARTING 10,000 CONCURRENT USERS VS 100 STOCK TEST ---');
  const tester = new LoadTester();
  const result = await tester.run10kBurst(10000, 100);

  console.log('\n--- TEST RESULTS ---');
  console.log(`Scenario: ${result.scenario}`);
  console.log(`Total Concurrent Requests: ${result.totalUsers}`);
  console.log(`Initial Inventory: ${result.initialStock}`);
  console.log(`Successful Reservations: ${result.successfulReservations}`);
  console.log(`Sold-Out (409) Rejections: ${result.soldOutCount}`);
  console.log(`Oversold Count: ${result.oversoldCount}`);
  console.log(`Throughput: ${result.rps} requests/second`);
  console.log(`P50 Latency: ${result.p50Ms} ms`);
  console.log(`P95 Latency: ${result.p95Ms} ms`);
  console.log(`P99 Latency: ${result.p99Ms} ms`);
  console.log(`Zero-Oversell Invariant: ${result.invariantPassed ? 'PASS (Strict 100 units)' : 'FAIL'}`);

  if (!result.invariantPassed) {
    console.error('CRITICAL: Concurrency test failed invariant!');
    process.exit(1);
  } else {
    console.log('\nSUCCESS: 10,000 Concurrency Test Passed Flawlessly!');
  }
}

runConcurrencyTest().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
