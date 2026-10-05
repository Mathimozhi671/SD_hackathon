import { LoadTester } from '../src/simulation/loadTester.js';

async function runIdempotencyTest() {
  console.log('--- STARTING IDEMPOTENCY & REPLAY ATTACK TEST ---');
  const tester = new LoadTester();
  const result = await tester.runIdempotencyTest(500);

  console.log(`Status: ${result.passed ? 'PASSED ✓' : 'FAILED ✗'}`);
  console.log(`Details: ${result.message}`);

  if (!result.passed) {
    console.error('CRITICAL: Idempotency test failed!');
    process.exit(1);
  } else {
    console.log('\nSUCCESS: Exactly-Once Processing Verified!');
  }
}

runIdempotencyTest().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
