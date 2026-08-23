#!/usr/bin/env node

/**
 * Environment preflight for every module in this project.
 *
 * Usage:
 *   node scripts/validate-env.mjs
 *
 * Values supplied by the process take precedence. Missing values are then read
 * from .env so the check also works before an application-specific env loader
 * has started. Secrets are never printed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REQUIRED_VARIABLES = [
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_MODE',
  'MOCK_MODE',
];

function readDotEnv(filePath) {
  if (!existsSync(filePath)) return {};

  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .reduce((values, line) => {
      const entry = line.trim();
      if (!entry || entry.startsWith('#')) return values;

      const separatorIndex = entry.indexOf('=');
      if (separatorIndex === -1) return values;

      const key = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();
      values[key] = value.replace(/^['\"]|['\"]$/g, '');
      return values;
    }, {});
}

const fileVariables = readDotEnv(resolve(process.cwd(), '.env'));
const missingVariables = REQUIRED_VARIABLES.filter((name) => {
  const value = process.env[name] ?? fileVariables[name];
  return !value || !value.trim();
});

if (missingVariables.length > 0) {
  console.error(`Environment validation failed. Set: ${missingVariables.join(', ')}`);
  process.exit(1);
}

console.log('Environment validation passed.');
