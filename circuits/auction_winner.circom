pragma circom 2.0.0;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";
include "lib/commitment.circom";
include "lib/merkle.circom";

// SealedStellar winner statement, plan section 2.6 with the Vickrey pricing
// amendment (docs/DECISIONS.md 2026-06-13). Proves, without opening ANY bid,
// including the winner's: the commitments bind the private prices for this
// auction, the winner slot holds the maximum price (lowest index wins ties),
// the public winning price equals the SECOND-highest price (the best bid
// among the non-winner slots) and is nonzero, and the winner address leaf is
// a member of the whitelist tree. With fewer than two positive-price bids
// the second price is 0 and no witness exists: such auctions cannot settle
// and fall to the refund path (rule b).
template AuctionWinner(bidCount, merkleDepth) {
    // Public inputs. Order FROZEN in docs/DECISIONS.md (2026-06-12); the
    // contract rebuilds public.json in exactly this order at settle.
    signal input auctionId;
    signal input commitments[bidCount];
    signal input winnerIndex;
    signal input winningPrice;
    signal input whitelistRoot;
    signal input winnerAddrHash;

    // Private inputs.
    signal input bidPrices[bidCount];
    signal input bidSalts[bidCount];
    signal input merklePathElements[merkleDepth];
    signal input merklePathIndexBits[merkleDepth];

    // 1. Every price fits in 64 bits, so the comparators below are sound.
    component priceRangeChecks[bidCount];
    for (var bidIndex = 0; bidIndex < bidCount; bidIndex++) {
        priceRangeChecks[bidIndex] = Num2Bits(64);
        priceRangeChecks[bidIndex].in <== bidPrices[bidIndex];
    }

    // 2. Commitment binding, or the canonical empty slot: a commitment of 0
    //    (EMPTY_COMMITMENT, docs/DECISIONS.md) forces that slot's price to 0
    //    and skips the hash equality; any other commitment must match
    //    Poseidon3(price, salt, auctionId).
    component bidCommitments[bidCount];
    component emptySlotFlags[bidCount];
    for (var bidIndex = 0; bidIndex < bidCount; bidIndex++) {
        bidCommitments[bidIndex] = BidCommitment();
        bidCommitments[bidIndex].bidPrice <== bidPrices[bidIndex];
        bidCommitments[bidIndex].bidSalt <== bidSalts[bidIndex];
        bidCommitments[bidIndex].auctionId <== auctionId;

        emptySlotFlags[bidIndex] = IsZero();
        emptySlotFlags[bidIndex].in <== commitments[bidIndex];

        (1 - emptySlotFlags[bidIndex].out)
            * (bidCommitments[bidIndex].commitment - commitments[bidIndex]) === 0;
        emptySlotFlags[bidIndex].out * bidPrices[bidIndex] === 0;
    }

    // 3. Winner selector: one indicator per slot, exactly one hot. The sum
    //    constraint also forces winnerIndex into 0..bidCount-1 (any other
    //    field value leaves every indicator at 0).
    component indexMatches[bidCount];
    signal indicators[bidCount];
    signal selectedPriceTerms[bidCount];
    var indicatorTotal = 0;
    var selectedPriceTotal = 0;
    for (var bidIndex = 0; bidIndex < bidCount; bidIndex++) {
        indexMatches[bidIndex] = IsEqual();
        indexMatches[bidIndex].in[0] <== winnerIndex;
        indexMatches[bidIndex].in[1] <== bidIndex;
        indicators[bidIndex] <== indexMatches[bidIndex].out;
        indicatorTotal += indicators[bidIndex];

        selectedPriceTerms[bidIndex] <== indicators[bidIndex] * bidPrices[bidIndex];
        selectedPriceTotal += selectedPriceTerms[bidIndex];
    }
    indicatorTotal === 1;

    signal selectedPrice;
    selectedPrice <== selectedPriceTotal;

    // 4. Vickrey clearing price: the public winningPrice is the maximum
    //    price among the NON-winner slots (second price). The winner's own
    //    bid never appears in the public signals. otherPrices zeroes out the
    //    winner slot; empty slots already hold price 0.
    signal otherPrices[bidCount];
    signal runningSecondMax[bidCount];
    component secondMaxCompare[bidCount - 1];
    for (var bidIndex = 0; bidIndex < bidCount; bidIndex++) {
        otherPrices[bidIndex] <== bidPrices[bidIndex] * (1 - indicators[bidIndex]);
    }
    runningSecondMax[0] <== otherPrices[0];
    for (var bidIndex = 1; bidIndex < bidCount; bidIndex++) {
        secondMaxCompare[bidIndex - 1] = GreaterEqThan(64);
        secondMaxCompare[bidIndex - 1].in[0] <== runningSecondMax[bidIndex - 1];
        secondMaxCompare[bidIndex - 1].in[1] <== otherPrices[bidIndex];
        // out == 1 keeps the running value, out == 0 takes the new price.
        runningSecondMax[bidIndex] <== otherPrices[bidIndex]
            + secondMaxCompare[bidIndex - 1].out
                * (runningSecondMax[bidIndex - 1] - otherPrices[bidIndex]);
    }

    winningPrice === runningSecondMax[bidCount - 1];
    // Nonzero clearing price doubles as rule b: with fewer than two
    // positive-price bids the second max is 0 and settlement is unprovable.
    // It also keeps empty or zero-price slots from winning: a winner with
    // price 0 forces every other slot to 0 (maximality), hence a 0 second
    // price, rejected here.
    component winningPriceIsZero = IsZero();
    winningPriceIsZero.in <== winningPrice;
    winningPriceIsZero.out === 0;

    // 5. Maximality plus the lowest-index tie-break (plan section 2.4):
    //    selectedPrice >= bidPrices[i] for every slot, and strictly greater
    //    for every slot at an index below winnerIndex.
    component maxChecks[bidCount];
    component strictChecks[bidCount];
    component beforeWinnerFlags[bidCount];
    for (var bidIndex = 0; bidIndex < bidCount; bidIndex++) {
        maxChecks[bidIndex] = GreaterEqThan(64);
        maxChecks[bidIndex].in[0] <== selectedPrice;
        maxChecks[bidIndex].in[1] <== bidPrices[bidIndex];
        maxChecks[bidIndex].out === 1;

        strictChecks[bidIndex] = GreaterThan(64);
        strictChecks[bidIndex].in[0] <== selectedPrice;
        strictChecks[bidIndex].in[1] <== bidPrices[bidIndex];

        // bidIndex is a compile-time constant below bidCount and winnerIndex
        // is forced into 0..bidCount-1 above, so 4 comparator bits suffice
        // for bidCount = 8.
        beforeWinnerFlags[bidIndex] = LessThan(4);
        beforeWinnerFlags[bidIndex].in[0] <== bidIndex;
        beforeWinnerFlags[bidIndex].in[1] <== winnerIndex;

        beforeWinnerFlags[bidIndex].out * (1 - strictChecks[bidIndex].out) === 0;
    }

    // 6. The winner address leaf is a member of the whitelist tree (plan
    //    section 2.5). Only the winner's membership is proven, so losing
    //    bidders are never identified.
    component membershipCheck = MerkleTreeChecker(merkleDepth);
    membershipCheck.leaf <== winnerAddrHash;
    membershipCheck.root <== whitelistRoot;
    for (var levelIndex = 0; levelIndex < merkleDepth; levelIndex++) {
        membershipCheck.pathElements[levelIndex] <== merklePathElements[levelIndex];
        membershipCheck.pathIndexBits[levelIndex] <== merklePathIndexBits[levelIndex];
    }
}

// 8 bid slots (plan section 2.1), whitelist depth 10 (plan section 2.5).
component main {
    public [auctionId, commitments, winnerIndex, winningPrice, whitelistRoot, winnerAddrHash]
} = AuctionWinner(8, 10);
