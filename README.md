# Agentic Checkout

## Project pitch

Agentic Checkout is a safe, conversational commerce prototype for merchants who want automation without a black box. A buyer asks for a product in natural language; the agent creates a typed action, explains it, evaluates payment controls, executes only an approved action, and records the result.

```
Buyer query
    |
Propose -> Explain -> Gate -> Execute -> Audit
                         |          |
                      reject      order
                         \-----------> human-readable record
```

## Value proposition

Agentic Checkout makes AI commerce auditable and safe by design. Instead of letting a model directly create a payment, every request crosses a visible spine: propose, explain, gate, execute, and audit. The gate enforces merchant opt-in, approved action types, and a ₹10,000 ceiling before the payment boundary can run. Buyers get a natural conversational experience, while merchants get immediate proof of what the agent intended, why it was approved or rejected, and the resulting audit record. Razorpay test-mode integration is supported with a resilient local mock fallback, so demonstrations and checkout flows remain available when credentials or network connectivity are unavailable.

## Demo script

1. Install dependencies: `npm install`
2. Start the app: `npm start`
3. Open `http://localhost:3000`.
4. Submit **“I want to buy a wireless mouse”** and observe every green spine stage.
5. Submit **“Add an extended warranty”** to show an approved `UPSELL` action.
6. Submit **“Buy a premium laptop”** to show the red ₹10,000 ceiling rejection.
7. Inspect the Live Audit Log panel; every outcome is retained.

## Development checks

Run `npm test` to syntax-check the server, frontend entry modules, and agent architecture.
