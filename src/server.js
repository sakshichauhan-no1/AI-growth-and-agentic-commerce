'use strict';

const express = require('express');
const { join } = require('node:path');
const catalog = require('./mock/catalog.json');
const { createRazorpayClient } = require('./api/razorpayClient');
const { parseBuyerQuery } = require('./agent');
const { proposeAction, explain, gate, execute, readAuditLog } = require('./agent/spine');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, '..', 'public')));

app.post('/api/agent/chat', async (request, response) => {
  try {
    const parsedRequest = parseBuyerQuery(request.body?.query, catalog);
    const proposed = proposeAction({ ...parsedRequest, customerId: 'web-checkout' }, catalog);
    const explained = explain(proposed);
    const gated = gate(explained, { merchantOptIn: true });
    let audit;
    try {
      audit = await execute(gated, { client: createRazorpayClient() });
    } catch (error) {
      audit = error.audit ?? { status: 'failed', error: error.message };
    }
    response.json({ query: request.body.query, request: parsedRequest, proposed, explained, gate: gated.gate, execution: audit, audit });
  } catch (error) {
    response.status(400).json({ error: error.message || 'The checkout request could not be processed.' });
  }
});

app.get('/api/audit', (_request, response) => {
  try { response.json(readAuditLog()); }
  catch (error) { response.status(500).json({ error: 'Unable to read audit history.', details: error.message }); }
});

app.use((_request, response) => response.sendFile(join(__dirname, '..', 'public', 'index.html')));

if (require.main === module) app.listen(PORT, () => console.log(`Agentic Commerce UI listening on http://localhost:${PORT}`));

module.exports = { app };
