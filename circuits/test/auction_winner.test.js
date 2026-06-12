'use strict';

const path = require('path');
const { assert } = require('chai');
const { wasm: wasmTester } = require('circom_tester');

const {
  createPoseidonHasher,
  computeBidCommitment,
  buildHonestFixture,
  recomputeCommitmentsForAuction,
  fixtureSalt,
} = require('./helpers.js');

describe('auction_winner circuit (plan section 2.6)', function describeAuctionWinner() {
  this.timeout(600000);

  let circuit;
  let hasher;

  before(async function compileOnce() {
    circuit = await wasmTester(path.join(__dirname, '..', 'auction_winner.circom'), {
      include: [path.join(__dirname, '..', 'node_modules')],
    });
    hasher = await createPoseidonHasher();
  });

  async function expectAccepted(input) {
    const witness = await circuit.calculateWitness(input, true);
    await circuit.checkConstraints(witness);
    return witness;
  }

  async function expectRejected(input, rejectionLabel) {
    let witnessFailed = false;
    try {
      const witness = await circuit.calculateWitness(input, true);
      await circuit.checkConstraints(witness);
    } catch (constraintError) {
      witnessFailed = true;
    }
    assert.isTrue(witnessFailed, `expected constraint failure: ${rejectionLabel}`);
  }

  it('accepts the honest winner with empty slots present', async function honestWinner() {
    const { input } = buildHonestFixture(hasher);
    await expectAccepted(input);
  });

  it('exposes public signals in the frozen DECISIONS.md order', async function frozenOrder() {
    const { input } = buildHonestFixture(hasher);
    const witness = await expectAccepted(input);
    // Witness layout: index 0 is the constant 1, then the 13 public signals
    // in the frozen order (no outputs declared).
    const publicSignals = witness.slice(1, 14).map((signalValue) => signalValue.toString());
    const expectedOrder = [
      input.auctionId,
      ...input.commitments,
      input.winnerIndex,
      input.winningPrice,
      input.whitelistRoot,
      input.winnerAddrHash,
    ];
    assert.deepEqual(publicSignals, expectedOrder);
  });

  it('accepts a full house of eight real bids', async function fullHouse() {
    const { input, meta } = buildHonestFixture(hasher);
    const fullPrices = [1200n, 3500n, 990n, 2750n, 3100n, 800n, 1n, 2100n];
    input.bidPrices = fullPrices.map((bidPrice) => bidPrice.toString());
    input.commitments = fullPrices.map((bidPrice, bidIndex) =>
      computeBidCommitment(hasher, bidPrice, meta.bidSalts[bidIndex], meta.auctionId).toString(),
    );
    await expectAccepted(input);
  });

  it('rejects a wrong winner index even with that slot price as winning price', async function wrongWinner() {
    const { input } = buildHonestFixture(hasher);
    // Slot 4 holds 3100, not the maximum 3500 at slot 1.
    input.winnerIndex = '4';
    input.winningPrice = '3100';
    await expectRejected(input, 'slot 4 is not the maximum bid');
  });

  it('rejects an inflated winning price', async function inflatedPrice() {
    const { input } = buildHonestFixture(hasher);
    input.winningPrice = '3600';
    await expectRejected(input, 'winning price above the selected bid');
  });

  it('rejects a commitment mismatch', async function commitmentMismatch() {
    const { input } = buildHonestFixture(hasher);
    input.commitments[2] = (BigInt(input.commitments[2]) + 1n).toString();
    await expectRejected(input, 'tampered commitment for slot 2');
  });

  it('rejects a zero winning price even when every bid is zero', async function zeroPrice() {
    const { input, meta } = buildHonestFixture(hasher);
    const zeroPrices = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n];
    input.bidPrices = zeroPrices.map((bidPrice) => bidPrice.toString());
    input.commitments = zeroPrices.map((bidPrice, bidIndex) =>
      computeBidCommitment(hasher, bidPrice, meta.bidSalts[bidIndex], meta.auctionId).toString(),
    );
    input.winnerIndex = '0';
    input.winningPrice = '0';
    await expectRejected(input, 'zero winning price');
  });

  it('gives a tie to the lowest index and rejects the higher one', async function tieBreak() {
    const honest = buildHonestFixture(hasher);
    const tiePrices = [1200n, 3500n, 990n, 3500n, 3100n, 0n, 0n, 0n];
    const tieCommitments = tiePrices.map((bidPrice, bidIndex) => {
      if (honest.meta.emptySlots[bidIndex]) {
        return '0';
      }
      return computeBidCommitment(hasher, bidPrice, honest.meta.bidSalts[bidIndex], honest.meta.auctionId).toString();
    });

    const lowerIndexInput = { ...honest.input };
    lowerIndexInput.bidPrices = tiePrices.map((bidPrice) => bidPrice.toString());
    lowerIndexInput.commitments = tieCommitments;
    lowerIndexInput.winnerIndex = '1';
    lowerIndexInput.winningPrice = '3500';
    await expectAccepted(lowerIndexInput);

    const higherIndexInput = { ...lowerIndexInput };
    higherIndexInput.winnerIndex = '3';
    await expectRejected(higherIndexInput, 'tie must go to the lowest index');
  });

  it('rejects an empty slot as winner under both price stories', async function emptySlotWin() {
    const zeroPriceStory = buildHonestFixture(hasher).input;
    zeroPriceStory.winnerIndex = '5';
    zeroPriceStory.winningPrice = '0';
    await expectRejected(zeroPriceStory, 'empty slot with zero price');

    const fakePriceStory = buildHonestFixture(hasher).input;
    fakePriceStory.winnerIndex = '5';
    fakePriceStory.winningPrice = '3500';
    await expectRejected(fakePriceStory, 'empty slot with a nonzero price story');
  });

  it('rejects commitments replayed from another auction', async function crossAuctionReplay() {
    const { input, meta } = buildHonestFixture(hasher);
    // Commitments recomputed for auction 43, public auctionId stays 42.
    input.commitments = recomputeCommitmentsForAuction(hasher, meta, 43n);
    await expectRejected(input, 'commitments bound to a different auction id');
  });

  it('rejects a winner outside the whitelist tree', async function nonMember() {
    const { input } = buildHonestFixture(hasher);
    // A leaf that was never inserted: stale path, foreign leaf value.
    input.winnerAddrHash = computeBidCommitment(hasher, 7n, fixtureSalt(7), 7n).toString();
    await expectRejected(input, 'winner leaf not under the whitelist root');
  });

  it('rejects an out-of-range winner index', async function outOfRangeIndex() {
    const { input } = buildHonestFixture(hasher);
    input.winnerIndex = '8';
    input.winningPrice = '0';
    await expectRejected(input, 'winner index beyond the last slot');
  });
});
