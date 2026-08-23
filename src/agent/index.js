'use strict';

const catalog = require('../mock/catalog.json');
const { createRazorpayClient } = require('../api/razorpayClient');
const { runSpine } = require('./spine');

function normalize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function findCatalogProduct(query, products = catalog) {
  const words = new Set(normalize(query).split(' ').filter(Boolean));
  return products
    .map((product) => ({
      product,
      score: normalize(product.name).split(' ').filter((word) => words.has(word)).length,
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)[0]?.product;
}

/** Converts a short buyer message into the safe, typed request accepted by the spine. */
function parseBuyerQuery(query, products = catalog) {
  if (typeof query !== 'string' || !query.trim()) {
    throw new Error('Please tell me which catalog item you want to buy.');
  }

  const product = findCatalogProduct(query, products);
  if (!product) throw new Error(`I could not find a catalog item matching "${query}".`);

  const normalizedQuery = normalize(query);
  const quantityMatch = normalizedQuery.match(/\b(\d+)\b/);
  const quantity = quantityMatch ? Number(quantityMatch[1]) : 1;
  const actionType = /\b(add|upsell|warranty)\b/.test(normalizedQuery) ? 'UPSELL' : 'CREATE_ORDER';

  return { productId: product.id, quantity, actionType };
}

async function checkout(query, options = {}) {
  const request = parseBuyerQuery(query, options.catalog ?? catalog);
  return runSpine(
    { ...request, customerId: options.customerId ?? 'conversational-buyer' },
    {
      catalog: options.catalog ?? catalog,
      client: options.client ?? createRazorpayClient(),
      policy: { merchantOptIn: options.merchantOptIn === true },
      auditLogPath: options.auditLogPath,
    },
  );
}

async function runDemoScenarios(options = {}) {
  const shared = {
    ...options,
    merchantOptIn: true,
    client: options.client ?? createRazorpayClient(),
  };
  const scenarios = [
    { name: 'Scenario A: standard checkout', query: 'I want to buy a wireless mouse' },
    { name: 'Scenario B: extended-warranty upsell', query: 'Add an extended warranty' },
    { name: 'Scenario C: ceiling rejection', query: 'I want to buy a premium laptop' },
  ];

  const results = [];
  for (const scenario of scenarios) {
    try {
      results.push({ ...scenario, result: await checkout(scenario.query, shared) });
    } catch (error) {
      results.push({ ...scenario, result: error.audit ?? { status: 'failed', error: error.message } });
    }
  }
  return results;
}

if (require.main === module) {
  runDemoScenarios()
    .then((results) => console.log(JSON.stringify(results, null, 2)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = { parseBuyerQuery, checkout, runDemoScenarios, findCatalogProduct };
