'use strict';

const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const DEFAULT_AUDIT_LOG_PATH = resolve(__dirname, '..', 'mock', 'audit_log.json');

function requirePositiveInteger(value, field) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer.`);
  }
}

function proposeAction({ productId, quantity = 1, customerId = 'hello-world' }, catalog) {
  if (!Array.isArray(catalog)) throw new Error('catalog must be an array.');
  requirePositiveInteger(quantity, 'quantity');

  const product = catalog.find((item) => item.id === productId);
  if (!product) throw new Error(`Unknown product: ${productId}`);
  if (product.stock < quantity) throw new Error(`Insufficient stock for: ${productId}`);

  return {
    id: `action_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    type: 'CREATE_ORDER',
    customerId,
    product: { id: product.id, name: product.name },
    quantity,
    amountPaise: product.price * quantity,
    currency: 'INR',
    proposedAt: new Date().toISOString(),
  };
}

function explain(action) {
  return {
    ...action,
    explanation: `Create an INR order for ${action.quantity} × ${action.product.name} totalling ${action.amountPaise} paise.`,
    explainedAt: new Date().toISOString(),
  };
}

function gate(explainedAction, policy = {}) {
  const merchantOptedIn = policy.merchantOptedIn ?? true;
  const spendingCeilingPaise = policy.spendingCeilingPaise ?? Number.MAX_SAFE_INTEGER;
  const reasons = [];

  if (!merchantOptedIn) reasons.push('Merchant has not opted in to order creation.');
  if (explainedAction.amountPaise > spendingCeilingPaise) {
    reasons.push(`Order exceeds the ${spendingCeilingPaise}-paise spending ceiling.`);
  }

  return {
    ...explainedAction,
    gate: {
      approved: reasons.length === 0,
      reasons,
      decidedAt: new Date().toISOString(),
    },
  };
}

function readAuditLog(auditLogPath) {
  if (!existsSync(auditLogPath)) return [];
  const content = readFileSync(auditLogPath, 'utf8').trim();
  return content ? JSON.parse(content) : [];
}

function audit(entry, auditLogPath = DEFAULT_AUDIT_LOG_PATH) {
  const log = readAuditLog(auditLogPath);
  log.push(entry);
  writeFileSync(auditLogPath, `${JSON.stringify(log, null, 2)}\n`, 'utf8');
  return entry;
}

/**
 * Execution accepts only a decision returned by gate(). Every invocation is
 * auditable, including rejected gates and downstream payment failures.
 */
async function execute(gatedAction, { client, auditLogPath = DEFAULT_AUDIT_LOG_PATH } = {}) {
  const baseAudit = {
    actionId: gatedAction?.id ?? null,
    actionType: gatedAction?.type ?? null,
    executedAt: new Date().toISOString(),
    gate: gatedAction?.gate ?? null,
  };

  try {
    if (!gatedAction?.gate || typeof gatedAction.gate.approved !== 'boolean') {
      throw new Error('execute() requires an action returned by gate().');
    }
    if (!gatedAction.gate.approved) {
      const error = new Error(`Action rejected by gate: ${gatedAction.gate.reasons.join(' ')}`);
      error.code = 'GATE_REJECTED';
      throw error;
    }
    if (!client || typeof client.createOrder !== 'function') {
      throw new Error('A payment client with createOrder() is required.');
    }

    const order = await client.createOrder({
      amount: gatedAction.amountPaise,
      currency: gatedAction.currency,
      receipt: gatedAction.id,
      notes: { actionId: gatedAction.id, productId: gatedAction.product.id },
    });
    return audit({ ...baseAudit, status: 'executed', order }, auditLogPath);
  } catch (error) {
    const entry = audit({ ...baseAudit, status: 'failed', error: error.message }, auditLogPath);
    error.audit = entry;
    throw error;
  }
}

async function runSpine(orderRequest, { catalog, client, policy, auditLogPath } = {}) {
  const proposed = proposeAction(orderRequest, catalog);
  const explained = explain(proposed);
  const gated = gate(explained, policy);
  return execute(gated, { client, auditLogPath });
}

module.exports = { proposeAction, explain, gate, execute, audit, runSpine, DEFAULT_AUDIT_LOG_PATH };
