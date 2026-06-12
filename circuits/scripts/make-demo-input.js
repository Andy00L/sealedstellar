#!/usr/bin/env node
// Writes the canonical 8-bid demo fixture as build/input.json plus the
// expected public signal vector (frozen order, docs/DECISIONS.md 2026-06-12)
// as build/expected_public.json. After scripts/prove.sh, build/public.json
// must equal build/expected_public.json byte for byte; the days 3-4 run
// checks that with diff.
'use strict';

const fs = require('fs');
const path = require('path');

const { createPoseidonHasher, buildHonestFixture } = require('../test/helpers.js');

async function main() {
  const hasher = await createPoseidonHasher();
  const { input } = buildHonestFixture(hasher);

  const buildDirectory = path.join(__dirname, '..', 'build');
  if (!fs.existsSync(buildDirectory)) {
    console.error('[main] build directory missing: run scripts/compile.sh first');
    process.exitCode = 1;
    return;
  }

  const expectedPublicSignals = [
    input.auctionId,
    ...input.commitments,
    input.winnerIndex,
    input.winningPrice,
    input.whitelistRoot,
    input.winnerAddrHash,
  ];

  const inputPath = path.join(buildDirectory, 'input.json');
  const expectedPublicPath = path.join(buildDirectory, 'expected_public.json');
  fs.writeFileSync(inputPath, `${JSON.stringify(input, null, 1)}\n`, 'utf8');
  fs.writeFileSync(expectedPublicPath, `${JSON.stringify(expectedPublicSignals, null, 1)}\n`, 'utf8');

  console.log(`[main] wrote ${inputPath}`);
  console.log(`[main] wrote ${expectedPublicPath} (13 signals, frozen order)`);
}

main();
