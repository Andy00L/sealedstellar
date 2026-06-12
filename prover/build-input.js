#!/usr/bin/env node
// Builds the circuit input for the auction winner proof from operator data:
// decrypted bids (operator-decrypt.js) plus the whitelist tree
// (build-whitelist.js). Computes the winner (maximum price, lowest index on
// ties), pads empty slots, and emits both the circuit input and a small meta
// file with the public settle arguments for the CLI.
//
// Usage: node build-input.js --decrypted-file <decrypted.json> \
//   --whitelist-file <whitelist.json> --out-input <input.json> \
//   --out-meta <meta.json>
'use strict';

const fs = require('fs');

const {
  createPoseidonHasher,
  PoseidonMerkleTree,
  selectVickreyOutcome,
  BID_SLOT_COUNT,
  MERKLE_DEPTH,
} = require('../circuits/test/helpers.js');

function parseCliArguments(argv) {
  const options = {};
  const flagNames = ['--decrypted-file', '--whitelist-file', '--out-input', '--out-meta'];
  for (let argIndex = 2; argIndex < argv.length; argIndex += 2) {
    const flagName = argv[argIndex];
    const flagValue = argv[argIndex + 1];
    if (!flagNames.includes(flagName) || flagValue === undefined) {
      return {
        ok: false,
        reason:
          'usage: node build-input.js --decrypted-file <f> --whitelist-file <f> --out-input <f> --out-meta <f>',
      };
    }
    const optionKey = flagName
      .slice(2)
      .replace('-file', 'File')
      .replace('out-input', 'outInput')
      .replace('out-meta', 'outMeta');
    options[optionKey] = flagValue;
  }
  for (const requiredName of ['decryptedFile', 'whitelistFile', 'outInput', 'outMeta']) {
    if (!options[requiredName]) {
      return { ok: false, reason: `missing required flag for ${requiredName}` };
    }
  }
  return { ok: true, value: options };
}

// Vickrey selection through the shared helper: winner is the maximum price
// (lowest slot on ties), the public clearing price is the second-highest.
function selectWinner(bids) {
  const paddedPrices = Array.from({ length: BID_SLOT_COUNT }, () => 0n);
  for (const bid of bids) {
    paddedPrices[bid.slotIndex] = BigInt(bid.priceDecimal);
  }
  const outcome = selectVickreyOutcome(paddedPrices);
  if (outcome.winnerIndex < 0 || outcome.winnerPrice <= 0n) {
    return { ok: false, reason: 'no positive-price bid found' };
  }
  if (outcome.clearingPrice <= 0n) {
    return {
      ok: false,
      reason:
        'fewer than two positive-price bids: the Vickrey clearing price is zero and the auction cannot settle (rule b, refund path)',
    };
  }
  return {
    ok: true,
    value: { winnerIndex: outcome.winnerIndex, clearingPrice: outcome.clearingPrice },
  };
}

async function main() {
  const optionsResult = parseCliArguments(process.argv);
  if (!optionsResult.ok) {
    console.error(`[main] ${optionsResult.reason}`);
    process.exitCode = 1;
    return;
  }
  const options = optionsResult.value;

  let decryptedDocument;
  let whitelistDocument;
  try {
    decryptedDocument = JSON.parse(fs.readFileSync(options.decryptedFile, 'utf8'));
    whitelistDocument = JSON.parse(fs.readFileSync(options.whitelistFile, 'utf8'));
  } catch (readError) {
    console.error(`[main] cannot read inputs: ${readError.message}`);
    process.exitCode = 1;
    return;
  }

  const bids = decryptedDocument.bids;
  if (!Array.isArray(bids) || bids.length === 0 || bids.length > BID_SLOT_COUNT) {
    console.error(`[main] expected 1 to ${BID_SLOT_COUNT} decrypted bids`);
    process.exitCode = 1;
    return;
  }

  const winnerResult = selectWinner(bids);
  if (!winnerResult.ok) {
    console.error(`[main] ${winnerResult.reason}`);
    process.exitCode = 1;
    return;
  }
  const { winnerIndex, clearingPrice } = winnerResult.value;
  const winnerBid = bids.find((bid) => bid.slotIndex === winnerIndex);

  const memberIndex = whitelistDocument.members.findIndex(
    (member) => member.address === winnerBid.bidder,
  );
  if (memberIndex < 0) {
    console.error('[main] winner address is not a whitelist member');
    process.exitCode = 1;
    return;
  }

  const hasher = await createPoseidonHasher();
  const tree = new PoseidonMerkleTree(
    hasher,
    whitelistDocument.depth,
    whitelistDocument.members.map((member) => BigInt(member.leafDecimal)),
  );
  if (tree.root.toString() !== whitelistDocument.rootDecimal) {
    console.error('[main] rebuilt whitelist root does not match the whitelist file');
    process.exitCode = 1;
    return;
  }
  if (whitelistDocument.depth !== MERKLE_DEPTH) {
    console.error(`[main] whitelist depth ${whitelistDocument.depth} does not match circuit depth ${MERKLE_DEPTH}`);
    process.exitCode = 1;
    return;
  }
  const winnerPath = tree.pathFor(memberIndex);

  const paddedCommitments = [];
  const paddedPrices = [];
  const paddedSalts = [];
  for (let slotIndex = 0; slotIndex < BID_SLOT_COUNT; slotIndex += 1) {
    const slotBid = bids.find((bid) => bid.slotIndex === slotIndex);
    if (slotBid) {
      paddedCommitments.push(slotBid.commitmentDecimal);
      paddedPrices.push(slotBid.priceDecimal);
      paddedSalts.push(slotBid.saltDecimal);
    } else {
      // Canonical empty slot (docs/DECISIONS.md 2026-06-12).
      paddedCommitments.push('0');
      paddedPrices.push('0');
      paddedSalts.push('0');
    }
  }

  const circuitInput = {
    auctionId: BigInt(decryptedDocument.auctionId).toString(),
    commitments: paddedCommitments,
    winnerIndex: winnerIndex.toString(),
    winningPrice: clearingPrice.toString(),
    whitelistRoot: whitelistDocument.rootDecimal,
    winnerAddrHash: whitelistDocument.members[memberIndex].leafDecimal,
    bidPrices: paddedPrices,
    bidSalts: paddedSalts,
    merklePathElements: winnerPath.elements.map((element) => element.toString()),
    merklePathIndexBits: winnerPath.indexBits.map((indexBit) => indexBit.toString()),
  };
  const settleMeta = {
    auctionId: decryptedDocument.auctionId,
    winnerIndex,
    winningPrice: clearingPrice.toString(),
    winnerAddress: winnerBid.bidder,
  };

  try {
    fs.writeFileSync(options.outInput, `${JSON.stringify(circuitInput, null, 1)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.writeFileSync(options.outMeta, `${JSON.stringify(settleMeta, null, 2)}\n`, 'utf8');
  } catch (writeError) {
    console.error(`[main] cannot write outputs: ${writeError.message}`);
    process.exitCode = 1;
    return;
  }
  // Only the clearing price (second-highest bid) becomes public at settle.
  // No bid value is printed: not the losers' and not the winner's.
  console.log(
    `[main] winner slot ${winnerIndex}, clearing price ${clearingPrice} (input and settle meta written)`,
  );
}

main();
