import { testCases } from "../lib/testing/aiQuestionTestCases";
import { runTests, MockOutputProvider } from "../lib/testing/runner";

async function main() {
  console.log("=========================================");
  console.log("  AI Question Generation Test Harness    ");
  console.log("=========================================\n");

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    console.error("❌ ERROR: CLAUDE_API_KEY is not set in .env.local");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  let testsToRun = testCases;

  if (args.length > 0) {
    const selectedIds = args;
    testsToRun = testCases.filter(t => selectedIds.includes(t.id));
    if (testsToRun.length === 0) {
      console.error(`❌ No tests found matching IDs: ${selectedIds.join(", ")}`);
      console.log(`Available IDs: ${testCases.map(t => t.id).join(", ")}`);
      process.exit(1);
    }
  }

  console.log(`Running ${testsToRun.length} test(s)...\n`);

  const provider = new MockOutputProvider(); // Swap with RealGenerationOutputProvider later

  const results = await runTests(apiKey, testsToRun, provider, (index, total, name) => {
    console.log(`[${index + 1}/${total}] Running: ${name}`);
  });

  console.log("\n=========================================");
  console.log("                RESULTS                  ");
  console.log("=========================================\n");

  let passedCount = 0;

  for (const res of results) {
    const status = res.success ? "✅ PASS" : "❌ FAIL";
    console.log(`${status} | ${res.testName} (${res.testId})`);
    
    if (res.error) {
      console.log(`   Error: ${res.error}\n`);
      continue;
    }

    if (res.evaluation) {
      console.log(`   Score: ${res.evaluation.score}/100`);
      console.log(`   Summary: ${res.evaluation.summary}`);
      
      if (res.evaluation.failedRequirements.length > 0) {
        console.log(`   Failed Requirements:`);
        for (const req of res.evaluation.failedRequirements) {
          console.log(`     - ${req}`);
        }
      }

      if (res.evaluation.concerns.length > 0) {
        console.log(`   Concerns:`);
        for (const c of res.evaluation.concerns) {
          console.log(`     - ${c}`);
        }
      }

      if (res.evaluation.suggestedFixes.length > 0) {
        console.log(`   Suggested Fixes:`);
        for (const f of res.evaluation.suggestedFixes) {
          console.log(`     - ${f}`);
        }
      }
    }
    console.log("");

    if (res.success) {
      passedCount++;
    }
  }

  console.log("=========================================");
  console.log(`Total: ${testsToRun.length} | Passed: ${passedCount} | Failed: ${testsToRun.length - passedCount}`);
  console.log("=========================================\n");

  if (passedCount < testsToRun.length) {
    process.exit(1);
  }
}

main().catch(error => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
