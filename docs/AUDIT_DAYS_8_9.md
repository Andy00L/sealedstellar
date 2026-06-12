# Security audit, days 8-9 (2026-06-12)

Trigger: hackathon submission approaching (REFERENCE_SECURITY_AUDIT.md,
"when to run the full audit"). Scope: contracts/ (verifier, auction),
circuits/ (auction_winner and libs), prover/ (all scripts), scripts/e2e.sh.
Auditor: build agent, adversarial pass over code it wrote in this session,
every file re-read in full.

## Phase 0-2: context, architecture, threat model

- Languages: Rust (soroban-sdk pinned git caddc8c, soroban-poseidon pinned
  git b4bf706b), Circom 2.2.3 + circomlib, Node (no TypeScript), bash.
- Assets: bidder tUSDC deposits (max_price each), the tBENJI lot, outcome
  integrity, bid-amount privacy versus the public and other bidders.
- Adversaries: malicious bidders (griefing, replay), malicious sellers
  (token choice, whitelist control), the operator (sees bids after close;
  outcome bound by proof), permissionless settle/refund callers, observers.
- Trust assumptions: BN254 and Poseidon host functions, the deployed
  verifier instance, SEP-41 behavior of the demo SAC tokens, the
  single-contribution zkey ceremony (documented weakness, MOCKS.md item 3).

## Phase 3: findings (pre-fix)

| # | Finding | Severity | Location | Resolution |
|---|---------|----------|----------|------------|
| 1 | Seller-chosen rwa token that traps on transfer makes refund_all revert entirely: every bidder deposit stranded permanently (funds locked, no path out) | HIGH | contracts/auction refund_all | FIXED in code |
| 2 | Any bidder can post an undecryptable ciphertext; the operator cannot open all 8 commitments, settlement becomes unprovable, the auction degrades to refund_all. Zero cost to void any auction | MEDIUM | protocol design | DOCUMENTED (MOCKS.md item 8); real fixes (verifiable encryption, reveal-or-slash bonds) are future work |
| 3 | No storage TTL management: a long-running auction entry can be archived before its deadline, blocking settle and refund until a manual restore | MEDIUM | contracts/auction create_auction | FIXED in code |
| 4 | Privacy claim precision: bidder identities are public through signed transactions and BidPlaced events; only amounts are hidden | MEDIUM (docs) | docs/MOCKS.md | DOCUMENTED (MOCKS.md item 7) |
| 5 | The whitelist pads with 0 leaves and the circuit accepts a membership proof for a 0 leaf; safe only because the contract derives winner_addr_hash itself and Poseidon outputs are never 0 | LOW | circuit/contract boundary | DOCUMENTED (invariant comment on address_leaf) |
| 6 | Verifier computes vk_x with 13 sequential g1_mul/g1_add instead of the CAP-0080 msm host function; measured verify fee 35764 stroops leaves no urgency | LOW | contracts/verifier | ACCEPTED (redeploying the working verifier is not justified by a fee optimization) |
| 7 | operator_enc_pubkey is stored unvalidated; a wrong key degrades to the refund path (seller foot-gun, not an attack on others) | LOW | contracts/auction | DOCUMENTED (MOCKS.md item 8 covers the degradation path) |
| 8 | No seller cancel before the deadline: with zero bids the lot stays locked until deadline plus grace | LOW | contracts/auction | ACCEPTED (refund_all covers it; a cancel function is future work) |
| 9 | Four clippy lints: two needless borrows (auction), two literal-bool assert_eq (verifier tests) | LOW | contracts | FIXED in code |

Checklist categories with no findings: replay and binding (auction_id and
commitments rebuilt from storage, cross-auction replay tested on real
proofs), authorization (require_auth on bidder and seller; settle and
refund_all permissionless by design), arithmetic (i128 checks, 64-bit price
bound enforced at create, overflow-checks on in release profile), circuit
soundness review (one-hot selector forces winner_index range; strict
tie-break; commitment binding with the 0 empty-slot escape unreachable for
real bids because place_bid rejects commitment 0; comparators within their
64-bit domain; Merkle path bits boolean-constrained, fixed depth 10),
reentrancy (Soroban disallows it; state transitions written before
transfers anyway), secrets handling (salts and decrypted bids never
printed; operator key file mode 0600 in a mode 700 run dir).

## Phase 5: fixes applied

| # | Fix | Files |
|---|-----|-------|
| 1 | refund_all now refunds every deposit first, then attempts the lot return with try_transfer: on failure it emits LotReturnFailed and leaves the lot retryable through the new permissionless reclaim_lot (distinct errors ReclaimRequiresRefundedAuction, LotAlreadyReclaimed, LotTransferFailed; new lot_reclaimed flag; LotReclaimed event). Covered by three new tests including a stateful BreakableToken double that traps on demand | contracts/auction/src/lib.rs, contracts/auction/src/test.rs |
| 3 | create_auction extends the auction entry TTL and the instance TTL to the auction lifetime (deadline plus grace) plus one day of ledgers, clamped to the network maximum | contracts/auction/src/lib.rs |
| 9 | Borrow style and assert style lints | contracts/auction/src/lib.rs, contracts/verifier/src/test.rs |

## Phase 6-7: post-fix verification

- cargo clippy --all-targets -- -D warnings: clean.
- cargo test (workspace): 23 of 23 green (20 auction including the three
  new lot-reclaim tests, 3 verifier).
- circuits suite: 12 of 12 green.
- wasm builds: verifier 5285 bytes (unchanged), auction 36958 bytes.
- Full e2e.sh run on testnet with the fixed contract: exit 0 in 695 s, all
  13 balance assertions exact. Auction contract (post-fix wasm)
  CBKOTFN3IQKCE2WOIH5SFDGTLUL5SBFDCLQZWARAPN7LJB3TVU6ZHVRK, settle tx
  8b9ba1f3c306a11b4714cdb94c5352cc4f4ba8e9523f1e17e04d18839b530e85, refund
  tx 860c0cb1ec33db49f4f4d24fd208ea52bab7c2eb57a75f6be3e9135074b8588b.
- Dependency notes: cargo audit binary not installed on this machine; the
  dependency surface is the pinned stellar SDK revision, soroban-poseidon,
  num-bigint, hex, stellar-strkey (dev), plus npm circomlib/circomlibjs/
  snarkjs/@stellar/stellar-sdk/tweetnacl. All pinned by lockfiles.

## Honest list: not fixed, why

- Finding 2 (ciphertext griefing) is a protocol-level limitation shared by
  commit-reveal designs; the in-window mitigation is the refund escape
  hatch plus explicit documentation. A sound fix needs verifiable
  encryption inside the circuit or slashable reveal bonds; both are out of
  scope before the deadline and listed as future work.
- Finding 6 (msm) and finding 8 (seller cancel) are improvements, not
  vulnerabilities; both recorded for post-hackathon work.
