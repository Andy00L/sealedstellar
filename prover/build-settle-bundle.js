#!/usr/bin/env node
// Builds the single JSON bundle the web operator flow pastes to settle an
// auction from a CLI-generated proof. It merges the soroban-formatted proof
// (format-args.js --out, the .proof object) with the settle meta
// (build-input.js --out-meta: winnerIndex, winningPrice, winnerAddress) and
// the auction id, so the proof and its meta can never be mismatched in the UI.
//
// Everything in the bundle is public on-chain material (proof bytes, winner
// address, the clearing price, winner slot); no secret is read or printed.
//
// Usage:
//   node build-settle-bundle.js --args <settle-args.json> \
//     --meta <settle-meta.json> --auction-id <id> --out <bundle.json>
'use strict';

const fs = require('fs');

function parseCliArguments(argv) {
  const options = {};
  const flagNames = ['--args', '--meta', '--auction-id', '--out'];
  for (let argIndex = 2; argIndex < argv.length; argIndex += 2) {
    const flagName = argv[argIndex];
    const flagValue = argv[argIndex + 1];
    if (!flagNames.includes(flagName) || flagValue === undefined) {
      return {
        ok: false,
        reason:
          'usage: node build-settle-bundle.js --args <settle-args.json> --meta <settle-meta.json> --auction-id <id> --out <bundle.json>',
      };
    }
    options[flagName.slice(2).replace('-id', 'Id')] = flagValue;
  }
  for (const requiredName of ['args', 'meta', 'auctionId', 'out']) {
    if (!options[requiredName]) {
      return { ok: false, reason: `missing required flag --${requiredName === 'auctionId' ? 'auction-id' : requiredName}` };
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

function isHexProofField(value, expectedLength) {
  return typeof value === 'string' && value.length === expectedLength && /^[0-9a-fA-F]+$/.test(value);
}

function main() {
  const optionsResult = parseCliArguments(process.argv);
  if (!optionsResult.ok) {
    console.error(`[main] ${optionsResult.reason}`);
    process.exitCode = 1;
    return;
  }
  const options = optionsResult.value;

  const auctionId = Number(options.auctionId);
  if (!Number.isInteger(auctionId) || auctionId <= 0) {
    console.error('[main] --auction-id must be a positive integer');
    process.exitCode = 1;
    return;
  }

  const argsFile = readJsonFile(options.args, 'args');
  if (!argsFile.ok) {
    console.error(`[main] ${argsFile.reason}`);
    process.exitCode = 1;
    return;
  }
  const metaFile = readJsonFile(options.meta, 'meta');
  if (!metaFile.ok) {
    console.error(`[main] ${metaFile.reason}`);
    process.exitCode = 1;
    return;
  }

  const proof = argsFile.value.proof;
  // a and c are G1 (64 bytes = 128 hex), b is G2 (128 bytes = 256 hex).
  // sourceRef: contracts/verifier/src/lib.rs Proof field sizes.
  if (
    !proof ||
    !isHexProofField(proof.a, 128) ||
    !isHexProofField(proof.b, 256) ||
    !isHexProofField(proof.c, 128)
  ) {
    console.error('[main] args file has no valid .proof (expected hex a/b/c of 128/256/128 chars). Run format-args.js with --proof and --public first.');
    process.exitCode = 1;
    return;
  }

  const meta = metaFile.value;
  const winnerIndex = Number(meta.winnerIndex);
  if (!Number.isInteger(winnerIndex) || winnerIndex < 0) {
    console.error('[main] meta file has no valid winnerIndex');
    process.exitCode = 1;
    return;
  }
  if (meta.winningPrice === undefined || meta.winningPrice === null) {
    console.error('[main] meta file has no winningPrice');
    process.exitCode = 1;
    return;
  }
  if (typeof meta.winnerAddress !== 'string' || !meta.winnerAddress.startsWith('G')) {
    console.error('[main] meta file has no valid winnerAddress');
    process.exitCode = 1;
    return;
  }

  const bundle = {
    auctionId,
    winnerIndex,
    winningPrice: String(meta.winningPrice),
    winnerAddress: meta.winnerAddress,
    proof: { a: proof.a, b: proof.b, c: proof.c },
  };

  try {
    fs.writeFileSync(options.out, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
  } catch (writeError) {
    console.error(`[main] cannot write ${options.out}: ${writeError.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[main] settle bundle for auction ${auctionId} written to ${options.out} (paste its contents into the operator flow)`);
}

main();
