pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";

// Bid commitment binding: commitment = Poseidon3(price, salt, auctionId).
// Scheme frozen in docs/DECISIONS.md (2026-06-12). Binding auctionId inside
// the hash blocks cross-auction replay (plan section 2.2).
template BidCommitment() {
    signal input bidPrice;
    signal input bidSalt;
    signal input auctionId;
    signal output commitment;

    component commitmentHasher = Poseidon(3);
    commitmentHasher.inputs[0] <== bidPrice;
    commitmentHasher.inputs[1] <== bidSalt;
    commitmentHasher.inputs[2] <== auctionId;
    commitment <== commitmentHasher.out;
}
