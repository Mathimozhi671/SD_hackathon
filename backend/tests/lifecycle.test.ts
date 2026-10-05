import { LoadTester } from '../src/simulation/loadTester.js';

async function runLifecycleTest() {
  console.log('--- STARTING COMPLETE ORDER & PAYMENT LIFECYCLE RECOVERY TEST ---');
  const tester = new LoadTester();
  const result = await tester.runFullLifecycleSimulation();

  console.log('\n--- LIFECYCLE AUDIT REPORT ---');
  console.log(`Scenario: ${result.scenario}`);
  console.log(`Initial Stock: ${result.initialStock}`);
  console.log(`Paid Orders: ${result.paidOrders}`);
  console.log(`Failed Payments (Restocked): ${result.failedPayments}`);
  console.log(`Timed-out Holds (Swept & Restocked): ${result.expiredHolds}`);
  console.log(`Final Available Stock in DB: ${result.remainingStock}`);
  console.log(`Oversold Count: ${result.oversoldCount}`);
  console.log(`Invariant Check: ${result.invariantPassed ? 'PASSED 100% (Zero Oversold, Exactly 100 Sold)' : 'FAILED'}`);

  if (!result.invariantPassed) {
    console.error('CRITICAL: Lifecycle failure recovery test failed!');
    process.exit(1);
  } else {
    console.log('\nSUCCESS: Failure Recovery & Restocking Verified!');
  }
}

runLifecycleTest().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
