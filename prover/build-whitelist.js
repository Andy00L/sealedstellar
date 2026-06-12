#!/usr/bin/env node
// Builds the whitelist Poseidon Merkle tree (depth 10) from Stellar account
// addresses, using the frozen leaf mapping (docs/DECISIONS.md 2026-06-12):
// leaf = Poseidon2 over the big-endian halves of the 32 raw key bytes.
//
// Usage: node build-whitelist.js --addresses <G..,G..,...> --out <whitelist.json>
'use strict';

const fs = require('fs');
const StellarSdk = require('@stellar/stellar-sdk');

const {
  createPoseidonHasher,
  computeAddressLeaf,
  PoseidonMerkleTree,
  MERKLE_DEPTH,
} = require('../circuits/test/helpers.js');

function parseCliArguments(argv) {
  const options = {};
  const flagNames = ['--addresses', '--out'];
  for (let argIndex = 2; argIndex < argv.length; argIndex += 2) {
    const flagName = argv[argIndex];
    const flagValue = argv[argIndex + 1];
    if (!flagNames.includes(flagName) || flagValue === undefined) {
      return {
        ok: false,
        reason: 'usage: node build-whitelist.js --addresses <G..,G..> --out <whitelist.json>',
      };
    }
    options[flagName.slice(2)] = flagValue;
  }
  for (const requiredName of ['addresses', 'out']) {
    if (!options[requiredName]) {
      return { ok: false, reason: `missing required flag --${requiredName}` };
    }
  }
  return { ok: true, value: options };
}

async function main() {
  const optionsResult = parseCliArguments(process.argv);
  if (!optionsResult.ok) {
    console.error(`[main] ${optionsResult.reason}`);
    process.exitCode = 1;
    return;
  }
  const memberAddresses = optionsResult.value.addresses.split(',').filter(Boolean);
  if (memberAddresses.length === 0) {
    console.error('[main] at least one address is required');
    process.exitCode = 1;
    return;
  }

  const hasher = await createPoseidonHasher();
  const members = [];
  for (const memberAddress of memberAddresses) {
    if (!StellarSdk.StrKey.isValidEd25519PublicKey(memberAddress)) {
      console.error(`[main] not a valid G address: ${memberAddress}`);
      process.exitCode = 1;
      return;
    }
    const keyBytes = StellarSdk.StrKey.decodeEd25519PublicKey(memberAddress);
    const leaf = computeAddressLeaf(hasher, Uint8Array.from(keyBytes));
    members.push({ address: memberAddress, leafDecimal: leaf.toString() });
  }

  const tree = new PoseidonMerkleTree(
    hasher,
    MERKLE_DEPTH,
    members.map((member) => BigInt(member.leafDecimal)),
  );

  const outputDocument = {
    depth: MERKLE_DEPTH,
    rootDecimal: tree.root.toString(),
    members,
  };
  try {
    fs.writeFileSync(optionsResult.value.out, `${JSON.stringify(outputDocument, null, 2)}\n`, 'utf8');
  } catch (writeError) {
    console.error(`[main] cannot write ${optionsResult.value.out}: ${writeError.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[main] whitelist root computed over ${members.length} members (depth ${MERKLE_DEPTH})`);
}

main();
