'use strict';

const catalog = require('./mock/catalog.json');
const { createRazorpayClient } = require('./api/razorpayClient');
const { runSpine } = require('./agent/spine');

async function main() {
  // A hello-world command must remain side-effect free outside the repository.
  const client = createRazorpayClient({ mockMode: true });
  const audit = await runSpine(
    { productId: 'sku_wireless_mouse_001', quantity: 1, customerId: 'hello-world' },
    {
      catalog,
      client,
      policy: { merchantOptedIn: true, spendingCeilingPaise: 200000 },
    },
  );
  console.log(JSON.stringify(audit, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.audit ? JSON.stringify(error.audit, null, 2) : error.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
