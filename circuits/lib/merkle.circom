pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";

// Poseidon Merkle membership checker with a fixed depth.
// Pattern sourceRef: tornado-core circuits/merkleTree.circom (MIT licensed),
// rewritten here with explicit boolean constraints on the path index bits and
// project naming. Leaf and root semantics are frozen in docs/DECISIONS.md
// (2026-06-12): internal nodes are Poseidon2, empty leaves are 0.
template MerkleTreeChecker(depth) {
    signal input leaf;
    signal input root;
    signal input pathElements[depth];
    // 0 means the running node is the left child at that level, 1 the right.
    signal input pathIndexBits[depth];

    component levelHashers[depth];
    signal levelNodes[depth + 1];
    signal leftInputs[depth];
    signal rightInputs[depth];

    levelNodes[0] <== leaf;

    for (var levelIndex = 0; levelIndex < depth; levelIndex++) {
        // Each path index must be a bit, otherwise the selector below could
        // smuggle arbitrary linear combinations.
        pathIndexBits[levelIndex] * (1 - pathIndexBits[levelIndex]) === 0;

        // bit == 0: (node, sibling); bit == 1: (sibling, node).
        leftInputs[levelIndex] <== levelNodes[levelIndex]
            + pathIndexBits[levelIndex] * (pathElements[levelIndex] - levelNodes[levelIndex]);
        rightInputs[levelIndex] <== pathElements[levelIndex]
            + pathIndexBits[levelIndex] * (levelNodes[levelIndex] - pathElements[levelIndex]);

        levelHashers[levelIndex] = Poseidon(2);
        levelHashers[levelIndex].inputs[0] <== leftInputs[levelIndex];
        levelHashers[levelIndex].inputs[1] <== rightInputs[levelIndex];
        levelNodes[levelIndex + 1] <== levelHashers[levelIndex].out;
    }

    root === levelNodes[depth];
}
