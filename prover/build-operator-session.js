#!/usr/bin/env node
// Builds the single operator session file the in-browser operator flow loads:
// the box secret key plus the whitelist member addresses (in leaf order). The
// browser decrypts the bids and rebuilds the whitelist Merkle path from this,
// then proves and settles client-side.
//
// The secret key is operator-only material: it is written to the output file
// (mode 0600) and never printed. Run this on the operator's own machine and
// keep the output local.
//
// Usage:
//   node build-operator-session.js --key <operator-box-key.json> \
//     --whitelist <whitelist.json> --out <operator-session.json>
'use strict';

const fs = require('fs');

function parseCliArguments(argv) {
  const options = {};
  const flagNames = ['--key', '--whitelist', '--out'];
  for (let argIndex = 2; argIndex < argv.length; argIndex += 2) {
    const flagName = argv[argIndex];
    const flagValue = argv[argIndex + 1];
    if (!flagNames.includes(flagName) || flagValue === undefined) {
      return {
        ok: false,
        reason:
          'usage: node build-operator-session.js --key <operator-box-key.json> --whitelist <whitelist.json> --out <operator-session.json>',
      };
    }
    options[flagName.slice(2)] = flagValue;
  }
  for (const requiredName of ['key', 'whitelist', 'out']) {
    if (!options[requiredName]) {
      return { ok: false, reason: `missing required flag --${requiredName}` };
    }
  }
  return { ok: true, value: options };
}

function readJsonFile(filePath, label) {
  let rawText;
  try {
    rawText = fs.readFileSync(filePath, 'utf8');
  } catch (readError) {
    return { ok: false, reason: `${label}: cannot read ${filePath}: ${readError.message}` };
  }
  try {
    return { ok: true, value: JSON.parse(rawText) };
  } catch (parseError) {
    return { ok: false, reason: `${label}: ${filePath} is not valid JSON: ${parseError.message}` };
  }
}

function main() {
  const optionsResult = parseCliArguments(process.argv);
  if (!optionsResult.ok) {
    console.error(`[main] ${optionsResult.reason}`);
    process.exitCode = 1;
    return;
  }
  const options = optionsResult.value;

  const keyFile = readJsonFile(options.key, 'key');
  if (!keyFile.ok) {
    console.error(`[main] ${keyFile.reason}`);
    process.exitCode = 1;
    return;
  }
  const whitelistFile = readJsonFile(options.whitelist, 'whitelist');
  if (!whitelistFile.ok) {
    console.error(`[main] ${whitelistFile.reason}`);
    process.exitCode = 1;
    return;
  }

  const secretKeyHex = keyFile.value.secretKeyHex;
  if (typeof secretKeyHex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(secretKeyHex)) {
    console.error('[main] key file has no valid 32-byte secretKeyHex');
    process.exitCode = 1;
    return;
  }
  if (!Array.isArray(whitelistFile.value.members) || whitelistFile.value.members.length === 0) {
    console.error('[main] whitelist file has no members');
    process.exitCode = 1;
    return;
  }
  const members = [];
  for (const member of whitelistFile.value.members) {
    if (!member || typeof member.address !== 'string') {
      console.error('[main] a whitelist member is missing an address');
      process.exitCode = 1;
      return;
    }
    members.push({ address: member.address });
  }

  const session = { secretKeyHex, whitelist: { members } };
  try {
    fs.writeFileSync(options.out, `${JSON.stringify(session, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch (writeError) {
    console.error(`[main] cannot write ${options.out}: ${writeError.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `[main] operator session written to ${options.out} (${members.length} whitelist members; load it in the operator flow, keep it local)`,
  );
}

main();
