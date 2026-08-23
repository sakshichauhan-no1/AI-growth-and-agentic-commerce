'use strict';

const { runDemoScenarios } = require('./agent');

async function main() {
  const results = await runDemoScenarios();
  console.log(JSON.stringify(results, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.audit ? JSON.stringify(error.audit, null, 2) : error.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
