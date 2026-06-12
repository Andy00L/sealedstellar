'use strict';

// Shared fixture builders for circuit tests and the demo input generator.
// Test and tooling code: invalid fixture construction throws with a
// [functionName] message (mocha and the CLI scripts surface throws as
// failures); production prover code keeps the errors-as-values rule.
//
// All semantic constants below are frozen in docs/DECISIONS.md (2026-06-12).

const { buildPoseidon } = require('circomlibjs');

// sourceRef: SEALEDSTELLAR_BUILD_PLAN.md sections 2.1 and 2.5.
const BID_SLOT_COUNT = 8;
const MERKLE_DEPTH = 10;
// docs/DECISIONS.md 2026-06-12: canonical empty slot commitment.
const EMPTY_COMMITMENT = 0n;
// docs/DECISIONS.md 2026-06-12: empty whitelist leaves are 0.
const EMPTY_LEAF = 0n;

async function createPoseidonHasher() {
  const poseidonInstance = await buildPoseidon();
  return {
    hash(fieldInputs) {
      const rawHash = poseidonInstance(fieldInputs.map((value) => BigInt(value)));
      return poseidonInstance.F.toObject(rawHash);
    },
  };
}

function computeBidCommitment(hasher, bidPrice, bidSalt, auctionId) {
  return hasher.hash([bidPrice, bidSalt, auctionId]);
}

// winner_addr_hash = Poseidon2(hi_128, lo_128) over the 32 raw address key
// bytes, big-endian halves. Frozen in docs/DECISIONS.md (2026-06-12).
function computeAddressLeaf(hasher, addressKeyBytes) {
  if (!(addressKeyBytes instanceof Uint8Array) || addressKeyBytes.length !== 32) {
    throw new Error('[computeAddressLeaf] expected a 32-byte Uint8Array');
  }
  let highHalf = 0n;
  let lowHalf = 0n;
  for (let byteIndex = 0; byteIndex < 16; byteIndex += 1) {
    highHalf = (highHalf << 8n) | BigInt(addressKeyBytes[byteIndex]);
    lowHalf = (lowHalf << 8n) | BigInt(addressKeyBytes[byteIndex + 16]);
  }
  return hasher.hash([highHalf, lowHalf]);
}

class PoseidonMerkleTree {
  constructor(hasher, depth, leaves) {
    const capacity = 2 ** depth;
    if (leaves.length > capacity) {
      throw new Error(`[PoseidonMerkleTree] ${leaves.length} leaves exceed capacity ${capacity}`);
    }
    this.depth = depth;
    this.levels = [];
    const paddedLeaves = leaves.map((leafValue) => BigInt(leafValue));
    while (paddedLeaves.length < capacity) {
      paddedLeaves.push(EMPTY_LEAF);
    }
    this.levels.push(paddedLeaves);
    for (let levelIndex = 0; levelIndex < depth; levelIndex += 1) {
      const previousLevel = this.levels[levelIndex];
      const nextLevel = [];
      for (let pairIndex = 0; pairIndex < previousLevel.length; pairIndex += 2) {
        nextLevel.push(hasher.hash([previousLevel[pairIndex], previousLevel[pairIndex + 1]]));
      }
      this.levels.push(nextLevel);
    }
  }

  get root() {
    return this.levels[this.depth][0];
  }

  pathFor(leafIndex) {
    if (leafIndex < 0 || leafIndex >= this.levels[0].length) {
      throw new Error(`[pathFor] leaf index ${leafIndex} out of range`);
    }
    const elements = [];
    const indexBits = [];
    let runningIndex = leafIndex;
    for (let levelIndex = 0; levelIndex < this.depth; levelIndex += 1) {
      const siblingIndex = runningIndex % 2 === 0 ? runningIndex + 1 : runningIndex - 1;
      elements.push(this.levels[levelIndex][siblingIndex]);
      indexBits.push(runningIndex % 2);
      runningIndex = Math.floor(runningIndex / 2);
    }
    return { elements, indexBits };
  }
}

// Vickrey outcome (docs/DECISIONS.md 2026-06-13 freeze): the winner holds
// the maximum price (lowest slot wins ties); the public clearing price is
// the highest price among the OTHER slots (second price). With fewer than
// two positive-price bids the clearing price is 0 and the auction cannot
// settle (rule b: it falls to the refund path).
function selectVickreyOutcome(bidPrices) {
  let winnerIndex = -1;
  let winnerPrice = -1n;
  bidPrices.forEach((bidPrice, slotIndex) => {
    if (BigInt(bidPrice) > winnerPrice) {
      winnerPrice = BigInt(bidPrice);
      winnerIndex = slotIndex;
    }
  });
  let clearingPrice = 0n;
  bidPrices.forEach((bidPrice, slotIndex) => {
    if (slotIndex !== winnerIndex && BigInt(bidPrice) > clearingPrice) {
      clearingPrice = BigInt(bidPrice);
    }
  });
  return { winnerIndex, winnerPrice, clearingPrice };
}

// Deterministic 31-byte test salts (not secrets): byte value bidIndex + 1
// repeated 31 times, well below the 2^248 salt bound.
function fixtureSalt(bidIndex) {
  const saltByteHex = (bidIndex + 1).toString(16).padStart(2, '0');
  return BigInt(`0x${saltByteHex.repeat(31)}`);
}

// Synthetic 32-byte address keys for whitelist fixtures.
function fixtureAddressKey(memberIndex) {
  return Uint8Array.from({ length: 32 }, () => 0x20 + memberIndex);
}

// Canonical honest fixture: 5 real bids, 3 empty slots, unique maximum at
// slot 1, winner whitelisted at leaf 3 of a 6-member tree. Options override
// the auction id and the winner's 32 address key bytes (used by
// scripts/make-contract-fixture.js to bind the proof to the auction
// contract's first auction id and its deterministic test winner address).
function buildHonestFixture(hasher, options = {}) {
  const auctionId = options.auctionId !== undefined ? BigInt(options.auctionId) : 42n;
  const winnerAddressKeyBytes = options.winnerAddressKeyBytes || fixtureAddressKey(3);
  const bidPrices = [1200n, 3500n, 990n, 2750n, 3100n, 0n, 0n, 0n];
  const emptySlots = [false, false, false, false, false, true, true, true];
  const bidSalts = bidPrices.map((unusedPrice, bidIndex) => fixtureSalt(bidIndex));
  // Winner slot 1 at 3500; the public clearing price is the second-highest
  // bid, 3100 (Vickrey, docs/DECISIONS.md 2026-06-13).
  const vickreyOutcome = selectVickreyOutcome(bidPrices);
  const winnerIndex = BigInt(vickreyOutcome.winnerIndex);
  const winningPrice = vickreyOutcome.clearingPrice;

  const commitments = bidPrices.map((bidPrice, bidIndex) => {
    if (emptySlots[bidIndex]) {
      return EMPTY_COMMITMENT;
    }
    return computeBidCommitment(hasher, bidPrice, bidSalts[bidIndex], auctionId);
  });

  const whitelistLeaves = Array.from({ length: 6 }, (unusedLeaf, memberIndex) =>
    computeAddressLeaf(hasher, memberIndex === 3 ? winnerAddressKeyBytes : fixtureAddressKey(memberIndex)),
  );
  const whitelistTree = new PoseidonMerkleTree(hasher, MERKLE_DEPTH, whitelistLeaves);
  const winnerLeafIndex = 3;
  const winnerPath = whitelistTree.pathFor(winnerLeafIndex);

  const input = {
    auctionId: auctionId.toString(),
    commitments: commitments.map((commitment) => commitment.toString()),
    winnerIndex: winnerIndex.toString(),
    winningPrice: winningPrice.toString(),
    whitelistRoot: whitelistTree.root.toString(),
    winnerAddrHash: whitelistLeaves[winnerLeafIndex].toString(),
    bidPrices: bidPrices.map((bidPrice) => bidPrice.toString()),
    bidSalts: bidSalts.map((bidSalt) => bidSalt.toString()),
    merklePathElements: winnerPath.elements.map((element) => element.toString()),
    merklePathIndexBits: winnerPath.indexBits.map((indexBit) => indexBit.toString()),
  };

  const meta = {
    auctionId,
    bidPrices,
    bidSalts,
    emptySlots,
    whitelistLeaves,
    whitelistTree,
    winnerLeafIndex,
  };

  return { input, meta };
}

// Recomputes the non-empty commitments for a different auction id, leaving
// every other input untouched (cross-auction replay fixture).
function recomputeCommitmentsForAuction(hasher, meta, replayAuctionId) {
  return meta.bidPrices.map((bidPrice, bidIndex) => {
    if (meta.emptySlots[bidIndex]) {
      return EMPTY_COMMITMENT.toString();
    }
    return computeBidCommitment(hasher, bidPrice, meta.bidSalts[bidIndex], replayAuctionId).toString();
  });
}

module.exports = {
  BID_SLOT_COUNT,
  MERKLE_DEPTH,
  EMPTY_COMMITMENT,
  EMPTY_LEAF,
  createPoseidonHasher,
  computeBidCommitment,
  computeAddressLeaf,
  PoseidonMerkleTree,
  selectVickreyOutcome,
  fixtureSalt,
  fixtureAddressKey,
  buildHonestFixture,
  recomputeCommitmentsForAuction,
};
