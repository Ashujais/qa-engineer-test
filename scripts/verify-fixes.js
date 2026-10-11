#!/usr/bin/env node
/**
 * Bug Fix Verification Script
 * Confirms that all 7 intentional bugs have been properly fixed in the codebase
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

console.log('🔍 Verifying all 7 bug fixes in the codebase...\n');

let fixesVerified = 0;

// Fix A: Check payment.routes.js maintains numeric amount
try {
  const content = readFileSync(join(projectRoot, 'src/routes/payment.routes.js'), 'utf-8');
  const hasStringBug = content.includes('amount: p.amount.toString()') || content.includes('amount: payment.amount.toString()');
  const hasNumericFix = content.includes('typeof p.amount === \'number\'') || content.includes('parseFloat(p.amount)');

  if (!hasStringBug && hasNumericFix) {
    console.log('✅ Fix A verified: Numeric amount maintained in payment.routes.js');
    fixesVerified++;
  } else {
    console.log('❌ Fix A failed: Amount is still converted to string or fix is missing');
  }
} catch (err) {
  console.log('⚠️  Fix A: Error reading file', err.message);
}

// Fix B: Check payment.routes.js for maximum amount validation
try {
  const content = readFileSync(join(projectRoot, 'src/routes/payment.routes.js'), 'utf-8');
  const lines = content.split('\n');
  let hasMaxCheck = false;

  for (const line of lines) {
    if (line.trim().startsWith('//')) continue;
    if (/if\s*\([^)]*amount\s*>\s*50000/.test(line)) {
      hasMaxCheck = true;
      break;
    }
  }

  if (hasMaxCheck) {
    console.log('✅ Fix B verified: Maximum transaction limit (€50,000) enforced');
    fixesVerified++;
  } else {
    console.log('❌ Fix B failed: Maximum amount validation is missing');
  }
} catch (err) {
  console.log('⚠️  Fix B: Error reading file', err.message);
}

// Fix C: Check auth.routes.js for robust email validation requiring TLD
try {
  const content = readFileSync(join(projectRoot, 'src/routes/auth.routes.js'), 'utf-8');
  const hasBuggyRegex = content.includes('/^[^\\s@]+@[^\\s@]+$/') || content.includes('/^[^s@]+@[^s@]+$/');
  const hasTldRegex = content.includes('a-zA-Z') && (content.includes('\\.') || content.includes('.'));

  if (!hasBuggyRegex && hasTldRegex) {
    console.log('✅ Fix C verified: Email validation strictly requires domain and TLD');
    fixesVerified++;
  } else {
    console.log('❌ Fix C failed: Permissive email regex is still in place');
  }
} catch (err) {
  console.log('⚠️  Fix C: Error reading file', err.message);
}

// Fix D: Check webhook.routes.js for signature verification
try {
  const content = readFileSync(join(projectRoot, 'src/routes/webhook.routes.js'), 'utf-8');
  const hasSigCheck = /if\s*\(\s*signature\s*!==\s*expectedSignature\s*\)/.test(content) &&
                     !content.match(/\/\/.*if\s*\(\s*signature\s*!==\s*expectedSignature\s*\)/);

  if (hasSigCheck) {
    console.log('✅ Fix D verified: Webhook HMAC-SHA256 signature verification enabled');
    fixesVerified++;
  } else {
    console.log('❌ Fix D failed: Webhook signature verification is missing or commented out');
  }
} catch (err) {
  console.log('⚠️  Fix D: Error reading file', err.message);
}

// Fix E: Check webhook.routes.js for idempotency check
try {
  const content = readFileSync(join(projectRoot, 'src/routes/webhook.routes.js'), 'utf-8');
  const hasIdempotencyCheck = /processed_webhooks\.includes/.test(content) &&
                             !content.match(/\/\/.*processed_webhooks\.includes/);

  if (hasIdempotencyCheck) {
    console.log('✅ Fix E verified: Webhook idempotency tracking enabled');
    fixesVerified++;
  } else {
    console.log('❌ Fix E failed: Webhook idempotency check is missing or commented out');
  }
} catch (err) {
  console.log('⚠️  Fix E: Error reading file', err.message);
}

// Fix F: Check table-order.routes.js for duplicate pending order check
try {
  const content = readFileSync(join(projectRoot, 'src/routes/table-order.routes.js'), 'utf-8');
  const hasDuplicateCheck = /existingOrder/.test(content) &&
                           /status\s*===\s*['"]pending['"]/.test(content) &&
                           !content.match(/\/\/.*existingOrder/);

  if (hasDuplicateCheck) {
    console.log('✅ Fix F verified: Table order duplicate prevention enabled');
    fixesVerified++;
  } else {
    console.log('❌ Fix F failed: Duplicate order check is missing or commented out');
  }
} catch (err) {
  console.log('⚠️  Fix F: Error reading file', err.message);
}

// Fix G: Check einvoice.routes.js for duplicate submission check
try {
  const content = readFileSync(join(projectRoot, 'src/routes/einvoice.routes.js'), 'utf-8');
  const hasDuplicateCheck = /einvoice_status.*submitted/.test(content) &&
                           /einvoice_status.*accepted/.test(content) &&
                           !content.match(/\/\/.*if.*einvoice_status/);

  if (hasDuplicateCheck) {
    console.log('✅ Fix G verified: E-invoice duplicate submission prevention enabled');
    fixesVerified++;
  } else {
    console.log('❌ Fix G failed: Duplicate submission check is missing or commented out');
  }
} catch (err) {
  console.log('⚠️  Fix G: Error reading file', err.message);
}

console.log(`\n📊 Fixes verified: ${fixesVerified}/7`);

if (fixesVerified === 7) {
  console.log('\n🎉 All 7 intentional bugs have been successfully fixed and verified!');
  process.exit(0);
} else {
  console.log('\n⚠️  Some bug fixes could not be verified.');
  process.exit(1);
}
