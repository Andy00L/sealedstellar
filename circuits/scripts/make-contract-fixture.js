#!/usr/bin/env node
// Builds the auction-contract test fixture: the same honest 8-slot story as
// the demo fixture, but bound to auction_id 1 (the contract's first id) and
// to the deterministic test winner address whose 32 ed25519 key bytes are
// 0x42 repeated (mirrored as WINNER_PUBKEY_BYTE in
// contracts/auction/src/test.rs). Outputs:
//   build/contract_input.json        circuit input for proving
//   build/contract_fixture_meta.json decimals the Rust tests embed
'use strict';

const fs = require('fs');
const path = require('path');

const { createPoseidonHasher, buildHonestFixture } = require('../test/helpers.js');

// Mirrors WINNER_PUBKEY_BYTE in contracts/auction/src/test.rs.
const WINNER_PUBKEY_BYTE = 0x42;
// The auction contract assigns ids starting at 1 (contracts/auction).
const CONTRACT_FIXTURE_AUCTION_ID = 1n;

async function main() {
  const hasher = await createPoseidonHasher();
  const winnerAddressKeyBytes = Uint8Array.from({ length: 32 }, () => WINNER_PUBKEY_BYTE);
  const { input, meta } = buildHonestFixture(hasher, {
    auctionId: CONTRACT_FIXTURE_AUCTION_ID,
    winnerAddressKeyBytes,
  });

  const buildDirectory = path.join(__dirname, '..', 'build');
  if (!fs.existsSync(buildDirectory)) {
    console.error('[main] build directory missing: run scripts/compile.sh first');
    process.exitCode = 1;
    return;
  }

  const inputPath = path.join(buildDirectory, 'contract_input.json');
  fs.writeFileSync(inputPath, `${JSON.stringify(input, null, 1)}\n`, 'utf8');

  const fixtureMeta = {
    auctionId: input.auctionId,
    commitments: input.commitments,
    winnerIndex: input.winnerIndex,
    winningPrice: input.winningPrice,
    whitelistRoot: input.whitelistRoot,
    winnerAddrHash: input.winnerAddrHash,
    winnerLeafIndex: meta.winnerLeafIndex,
  };
  const metaPath = path.join(buildDirectory, 'contract_fixture_meta.json');
  fs.writeFileSync(metaPath, `${JSON.stringify(fixtureMeta, null, 1)}\n`, 'utf8');

  console.log(`[main] wrote ${inputPath}`);
  console.log(`[main] wrote ${metaPath}`);
}

main();
