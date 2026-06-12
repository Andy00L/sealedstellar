#!/usr/bin/env node
// Generates the operator's tweetnacl box keypair. The secret key is written
// to the output file only (mode 0600) and is never printed; bidders encrypt
// their (price, salt) payloads to the public key (plan section 2.2).
//
// Usage: node operator-keygen.js --out <keyfile.json>
'use strict';

const fs = require('fs');
const nacl = require('tweetnacl');

function parseCliArguments(argv) {
  const options = {};
  for (let argIndex = 2; argIndex < argv.length; argIndex += 2) {
    const flagName = argv[argIndex];
    const flagValue = argv[argIndex + 1];
    if (flagName !== '--out' || flagValue === undefined) {
      return { ok: false, reason: 'usage: node operator-keygen.js --out <keyfile.json>' };
    }
    options.out = flagValue;
  }
  if (!options.out) {
    return { ok: false, reason: 'missing required flag --out' };
  }
  return { ok: true, value: options };
}

function main() {
  const optionsResult = parseCliArguments(process.argv);
  if (!optionsResult.ok) {
    console.error(`[main] ${optionsResult.reason}`);
    process.exitCode = 1;
    return;
  }

  const operatorKeyPair = nacl.box.keyPair();
  const keyDocument = {
    publicKeyHex: Buffer.from(operatorKeyPair.publicKey).toString('hex'),
    secretKeyHex: Buffer.from(operatorKeyPair.secretKey).toString('hex'),
  };
  try {
    fs.writeFileSync(optionsResult.value.out, `${JSON.stringify(keyDocument, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch (writeError) {
    console.error(`[main] cannot write key file: ${writeError.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[main] operator box public key: ${keyDocument.publicKeyHex}`);
}

main();
