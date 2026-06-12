# SealedStellar decision log

One entry per decision or measured result, newest at the bottom. Dates are
absolute. Required by SEALEDSTELLAR_BUILD_PLAN.md (working method).

## 2026-06-11: Phase 0 verification complete

- Toolchain measured inside WSL Ubuntu: stellar-cli 25.2.0, circom 2.2.3,
  snarkjs 0.7.6, node v22.22.2, npm 10.9.7, cargo 1.94.1, rustc 1.94.1,
  jq 1.7. Installed wasm targets: wasm32v1-none and wasm32-unknown-unknown.
- Deviation from plan section 4.4: the plan names Node 20 via nvm; this
  machine has Node 22.22.2 and no nvm. Every tool in the pipeline runs on 22,
  so no downgrade. Revisit only if a tool misbehaves.
- drew-dev identity exists and is funded:
  GATSUJVP77U3MQQLS5RTSXTL4BIAI7JEDSP7QR6LCKUFHQB5SMTYPMZH with
  10000.0000000 XLM on testnet (Horizon query, 2026-06-11).
- Network verified against live RPC (plan day 0 instruction): testnet
  protocol 26, passphrase "Test SDF Network ; September 2015". Matches the
  plan values.
- Throwaway spike (/tmp/spike): one-constraint multiplier circuit compiled,
  trusted setup ran, proof generated, `snarkjs groth16 verify` printed OK
  locally. Phase 0 definition of done met.

## 2026-06-11: powers of tau source replaced (plan 4.6 URL dead)

- The hermez S3 URL returns HTTP 403. Used the mirror named in the snarkjs
  README instead:
  https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_14.ptau
- blake2b hash verified against the README listing (matched):
  eeefbcf7c3803b523c94112023c7ff89558f9b8e0cf5d6cdcba3ade60f168af4a181c9c21774b94fbae6c90411995f7d854d02ebd93fb66043dbb06f17a831c1
- File: circuits/build/pot14.ptau, 18957464 bytes, gitignored.

## 2026-06-11: curve confirmed BN254, SDK pinned by git revision

- Plan section 1 says a BN254 Groth16 verifier exists in soroban-examples.
  Read in session: the groth16_verifier example (identical on main and
  p25-preview) is BLS12-381. BN254 appears only as a guest-library example
  (import_ark_bn254, written when host support was absent) and as host
  function previews (p25-preview/p25-preview/contracts/{bn254,poseidon}).
- The host functions did ship on chain: CAP-0074 (BN254) and CAP-0075
  (Poseidon permutations) in Protocol 25 X-Ray, live 2026-01-22; CAP-0080
  (BN254 msm, Fr arithmetic, curve checks) in Protocol 26 Yardstick, 2026-05.
  Testnet runs protocol 26 (verified above), so BN254 verification on chain
  is available and the plan's BN254 route stands.
- Released soroban-sdk 26.1.0 lacks crypto::bn254 (compile probe failed,
  2026-06-11). SDK pinned in contracts/Cargo.toml to rs-soroban-sdk main
  revision caddc8c367e8fd66a2a5962bcb0ca4850c23bf4a (2026-06-08). Move to the
  next crates.io release once it includes bn254.
- Type names at that revision: Bn254G1Affine, Bn254G2Affine, Bn254Fr
  (plain Fr is a deprecated alias); scalars built via Bn254Fr::from_u256.
- Why BN254 over BLS12-381: keeps the standard snarkjs bn128 stack, the
  downloaded ptau, circomlib Poseidon constants, and browser-side
  circomlibjs for bid commitments (days 10-12) all curve-consistent.

## 2026-06-11: proof byte encoding, source of truth

- Encoding read from soroban-sdk src/crypto/bn254.rs doc comments at the
  pinned revision: G1 is 64 bytes be_bytes(X) || be_bytes(Y); G2 is 128
  bytes with each Fp2 coordinate as be_bytes(c1) || be_bytes(c0); flag bits
  unset; public signals are U256 scalars.
- snarkjs emits each G2 coordinate as [c0, c1], so the limb swap lives in
  prover/format-args.js (packG2) and mirrored in the verifier test fixtures.
- The p25-preview test built bytes with ark serialize_uncompressed
  (little-endian). That predates the shipped encoding and was rejected as a
  source; the main-branch SDK doc comments win.
- Local evidence: cargo test green, 3 tests (valid proof true, wrong public
  signal false, signal count mismatch returns the distinct error).

## 2026-06-11: days 1-2 gate PASSED on testnet, four days ahead of schedule

- Verifier contract (vkey stored by constructor at deploy):
  CAEXSNOUKT26YS5ZIV7WJD2AZCB4WVS4CRHXU2BN4K22IYVB6EL5MQH6
  wasm 5285 bytes, wasm hash
  f0461817482c8b661f00f1bdfefce35ca339ae6bbe86ef664b607a4e3866f5fa.
- Deploy tx (fee_charged 98224 stroops):
  541b4e8e0f5bccb137939fadfbbeb282338fa06857770d5c2274f058fa7b8905
- PASS tx, public signal 33, contract returned true (fee_charged 23529
  stroops):
  924a1baf05cb77ce7bd7bcc8af240e860e3f87109eb4ad8d62d950fe17d10072
  https://stellar.expert/explorer/testnet/tx/924a1baf05cb77ce7bd7bcc8af240e860e3f87109eb4ad8d62d950fe17d10072
- FAIL tx, public signal 34, contract returned false (fee_charged 23529
  stroops):
  3e6026a1ebecec0d003e0e63e9d708b7cdace5016a437d1986df3e009b95f7f5
  https://stellar.expert/explorer/testnet/tx/3e6026a1ebecec0d003e0e63e9d708b7cdace5016a437d1986df3e009b95f7f5
- One earlier tx (f56c1672c3c4f2414ea9adf36b2708a2d7e15cc52b309ff54c229941c50720cd)
  uploaded the wasm but the deploy step aborted on an emptied constructor
  argument (shell wrapper bug, fixed below). Harmless; the upload was reused.
- Gate is GREEN: GO for days 3-4 (the real circuit) per plan section 5.

## 2026-06-11: open action for drew (rules eligibility)

- The DoraHacks rules page rejects automated fetches (HTTP 405), so the
  pre-window code eligibility rule is unconfirmed. Prior Stellar rounds
  required code written during the hackathon window (or capped prior code
  around 30 percent, per search results; unverified for this round).
- ACTION: open the Stellar Hacks Real-World ZK rules page by hand and
  confirm whether work done before June 15 is eligible. Everything built
  today is small by design and gets rebuilt fresh inside the window if the
  rules require it (plan section 5 hedge).

## 2026-06-11: process notes

- No git commands were run by the agent (per standards). Reference repos
  live in ~/ref as tarball extracts. cargo resolves the pinned soroban-sdk
  git revision internally during builds.
- Shell sessions started from the Windows host must wrap commands as:
  WSL_UTF8=1 MSYS2_ARG_CONV_EXCL='*' wsl -d Ubuntu --cd <dir> --exec bash -lc '<command>'
  The goal text's form without --exec routes through an intermediate WSL
  shell that breaks command substitution and embedded quotes.
- Home copies of the standards (~/.claude/SKILL_GENERAL.md and
  ~/.claude/REFERENCE_SECURITY_AUDIT.md) and the plan's fallback
  docs/standards/ both do not exist; the live copies are the repo's
  .claude/SKILL_GENERAL.md and .claude/REFERENCE_SECURITY_AUDIT.md.

## 2026-06-12: eligibility item CLOSED, repo facts

- Drew checked the official hackathon rules page by hand: requirements are a
  public repo, a 2 to 3 minute video, and load-bearing ZK on Stellar. No
  restriction on pre-window code. The 2026-06-11 open action is closed; no
  rebuild of the days 1-2 artifacts is needed.
- Repo pushed as commit ec26f48 to https://github.com/Andy00L/sealedstellar,
  kept private until submission day (the submission checklist flips it
  public).

## 2026-06-12: FROZEN public input order and circuit semantics (days 3-4)

Frozen before any constraint was written, per plan section 2.6. Any change
to this list after today is a protocol change and needs an explicit
decision entry plus regenerated keys.

Public signal vector (public.json index: meaning), 13 signals total:

- 0: auction_id (u64 as field element)
- 1 to 8: commitments[0..7], slot order = bid arrival order on chain
- 9: winner_index (0..7)
- 10: winning_price (token base units, 64-bit range)
- 11: whitelist_root (Poseidon Merkle root, depth 10)
- 12: winner_addr_hash (leaf for the winner address)

The circuit declares these as public inputs in exactly this order and has
zero output signals, so snarkjs public.json reproduces the list verbatim.
The verifier vkey IC therefore has length 14. The auction contract (days
5-6) must rebuild this exact vector from storage plus settle arguments.

Frozen semantic constants:

- EMPTY_COMMITMENT = 0. The contract fills unused bid slots with 0;
  in-circuit an empty slot forces that slot's price to 0 and skips the
  Poseidon binding for it.
- commitment_i = Poseidon3(price_i, salt_i, auction_id) over BN254
  (circomlib constants; circomlibjs computes the same hash in the browser).
- winner_addr_hash = Poseidon2(hi_128, lo_128) where hi_128 and lo_128 are
  the big-endian halves of the 32-byte ed25519 public key of the winner
  address. Whitelist leaves use the same mapping. 32 bytes never reduce mod
  the field this way (each half is below 2^128).
- Whitelist tree: depth 10 (1024 leaves), internal nodes Poseidon2, unused
  leaves padded with 0. A real address leaf is a Poseidon output and is
  never 0, so the padding cannot be proven as a member by an honest
  contract-supplied winner_addr_hash.
- Tie-break: for every index strictly below winner_index the winner's price
  must be strictly greater; equal prices at higher indexes are allowed.
  Lowest index among equal highest bids wins, enforced in-circuit.
- Prices are range-checked to 64 bits; winning_price must be nonzero and
  equal to the selected winner's price.

Open question parked for days 5-6: whether the CAP-0075 host poseidon
matches circomlib parameters (t, rounds, constants). If it does not, the
contract will compare against stored leaf hashes instead of hashing
addresses on chain; the circuit and this freeze are unaffected either way.

## 2026-06-12: days 3-4 milestone DONE, real circuit verified on testnet

- circuits/auction_winner.circom implements plan section 2.6 exactly:
  commitment binding with the empty-slot escape, 64-bit price range checks,
  one-hot winner selector (also forces winner_index into 0..7), maximality
  with the strict lowest-index tie-break, winning_price equality and nonzero
  check, Poseidon Merkle membership at depth 10 (circuits/lib/merkle.circom,
  circuits/lib/commitment.circom).
- Measured compile output (circom 2.2.3): 6229 non-linear constraints, 5566
  linear constraints, 11795 total, 13 public inputs, 36 private inputs, 0
  outputs, 11768 wires, 152 template instances. Within the 2^14 pot14 bound
  with 4589 to spare, so the plan 2.6 size estimate holds and no feature
  cuts are needed.
- Test suite: 12 circom_tester tests, all passing in 5 seconds (plan
  required 8 minimum). Coverage: honest winner with empty slots, full house
  of 8 real bids, frozen public-order assertion against the witness, wrong
  winner_index, inflated winning_price, commitment mismatch, zero winning
  price on an all-zero auction, tie accepted at lower index and rejected at
  higher, empty-slot winner under both price stories, cross-auction replay
  (commitments recomputed for auction 43 against public id 42),
  non-whitelisted winner, out-of-range winner_index 8.
- Groth16 setup ran with pot14 plus one dev contribution (trusted-setup
  weakness stays on the MOCKS ledger). vkey nPublic 13, IC length 14.
  snarkjs verified the 8-bid demo proof locally (OK) and
  build/public.json matched build/expected_public.json exactly, proving the
  frozen order end to end.
- Second verifier instance deployed from the existing wasm (hash
  f0461817482c8b661f00f1bdfefce35ca339ae6bbe86ef664b607a4e3866f5fa, no
  re-upload) with the real vkey in the constructor:
  CDQFIRJYA4AB2N2QSFPU52MGYFYUD3LF7KMMCJKEPYNO2WY5EARUTAUY
  deploy tx (fee_charged 190566 stroops):
  4ae632827cfad11f80d8d27098b12d997e3d9b02d631760a9131f27adb802545
- PASS tx, real proof, 13 signals, returned true (fee_charged 35764
  stroops):
  d51072a38f10ad2fd0b87c7d3b3d6893a482de9f5a992599281d3130345cb7ca
  https://stellar.expert/explorer/testnet/tx/d51072a38f10ad2fd0b87c7d3b3d6893a482de9f5a992599281d3130345cb7ca
- FAIL tx, winning_price flipped 3500 to 3600, returned false (fee_charged
  35764 stroops):
  8ad5171539b4f7be0ca98d020f3b2f165a2156f012171027fbf2fb452c28ddca
  https://stellar.expert/explorer/testnet/tx/8ad5171539b4f7be0ca98d020f3b2f165a2156f012171027fbf2fb452c28ddca
- The days 1-2 spike instance (CAEXSNOU...) keeps the spike vkey and stays
  untouched as the gate record; the auction contract (days 5-6) will call
  the new CDQFIRJY... instance.

## 2026-06-12: Poseidon on-chain decision (days 5-6, GO decision 1)

- Finding: the CAP-0075 host function is a fully parameterized permutation
  (caller supplies t, d, round counts, MDS matrix, and all round constants);
  it bakes in no parameter set, so host-vs-circomlib mismatch is not a
  property of the host. The preview-era poseidon_hash wrapper moved into the
  stellar library rs-soroban-poseidon, whose README and test suite state and
  assert "BN254 matches circomlib" (the circom Poseidon([1, 2]) vector).
- Choice: depend on soroban-poseidon, pinned to git revision
  b4bf706b7d0d602f9389280d259c0fb9f19983bf, and compute the winner leaf on
  chain at settle. The stored-leaf fallback was not needed.
- Evidence in contracts/auction tests: poseidon_matches_circomlib_vector
  (hash([1, 2]) equals the circomlib value) and
  address_leaf_matches_js_fixture (the on-chain leaf for the deterministic
  winner address equals the value circomlibjs computed in the JS fixture).
- Leaf input bytes are the 32-byte tail of the ScAddress XDR: the ed25519
  public key for G accounts (the frozen mapping) and the contract id for C
  addresses, hashed as two big-endian 128-bit halves either way.
- The library's crates.io soroban-sdk requirement is redirected to our
  pinned sdk git revision via [patch.crates-io] so one sdk build exists.

## 2026-06-12: zkey distribution policy (days 5-6, GO decision 2)

- circuits/build/aw_final.zkey is 5436794 bytes, far under the 50 MB line,
  so the zkey and build/vkey.json are committed (gitignore negation). A
  regenerated zkey cannot verify against the deployed verifier instance.
- scripts/setup.sh now refuses to overwrite an existing aw_final.zkey unless
  SEALEDSTELLAR_FORCE_SETUP=1, to protect the deployed-vkey match.
- The single-contribution ceremony weakness is recorded in docs/MOCKS.md.

## 2026-06-12: days 5-6 milestone DONE, auction contract live on testnet

Interface notes (plan conflicts resolved toward section 2.7):

- The plan section 5 sketch lists a settle parameter named
  merkle_proof_unused_on_chain. Sections 2.7 and 7 state the caller supplies
  only winner_index, winning_price, winner_address, and proof bytes. The
  parameter is dropped: an argument nothing reads violates the dead-code
  rule, and the plan's own frozen protocol section excludes it.
- winner_address stays an argument per the plan interface but storage is the
  authority: settle fails with WinnerAddressMismatch unless it equals
  bids[winner_index].bidder. The leaf is computed from the stored bidder.
- get_auction returns the stored Auction struct directly instead of a
  duplicate AuctionView type (same fields, no copy drift).
- The verifier client uses a structural twin of the deployed Proof type;
  field names a, b, c mirror the deployed verifier ABI and stay single
  letters deliberately (renaming would break the on-chain instance).

Design decisions:

- The lot is escrowed at create_auction, not at settle, so settlement can
  never fail on a missing seller balance and no path half-moves funds.
  refund_all returns the lot along with every deposit.
- settle and refund_all are permissionless by design: the proof or the
  clock is the authority (plan section 7 documentation requirement).
- Auction ids start at 1. Commitment 0 is rejected from place_bid (reserved
  empty-slot marker). Encrypted bids cap at 256 bytes. max_price must fit
  64 bits (circuit range), grace_period must be nonzero.
- Settled state is written before transfers within the single atomic
  invocation (idempotency flag per plan section 2.7).
- Events migrated to the sdk 26 #[contractevent] macro (the tuple publish
  API is deprecated at the pinned revision). BidPlaced carries the
  tweetnacl ciphertext per plan section 2.2.

Evidence:

- cargo test: 17 of 17 green. The happy path settles with the REAL groth16
  proof through the real verifier crate and asserts conservation to the
  stroop (contract ends at zero balance in both tokens; seller, winner, and
  every loser hit exact expected balances).
- cross_auction_replay_proof_rejected: the auction 1 proof replayed on an
  identical auction 2 fails with ProofInvalid (auction_id is rebuilt from
  storage, never caller-supplied).
- settle_rejects_proof_for_a_different_statement (the days 3-4 demo proof,
  valid material for auction 42) fails with ProofInvalid; tampered proof
  bytes fail with VerifierCallFailed (distinct failure modes).
- Fixture provenance: circuits/scripts/make-contract-fixture.js binds the
  proof to auction_id 1 and winner key bytes 0x42 repeated;
  build/contract_args.json holds the soroban-formatted material.
- Testnet deployments (drew-dev):
  - tBENJI SAC: CDUTXMK5MGOXSBUPZNQZ6J5RCQEVC4MOMYW72WXVUWV5W7OCXJIGJUGN
  - tUSDC SAC: CDIKPNCUSBHSTGD5GZKKHPK6BVE732BUCKQ3EPLYMSLUSHEZPAFTNPVX
    (issuer GDYLKSRXQZ7Y2Y44HDKVXB74WSXFRZRMGHKGG5XXO7ZFOWU7HWVYRR3G,
    alias token-issuer; recorded in docs/MOCKS.md)
  - Auction contract (wasm 34803 bytes, wired to verifier CDQFIRJY...):
    CDAOIR2ZR2VOXMWQGGDD4K5NUD2AU4MTNDPYOA6IEDIXA3N6YLL5KX3B
    deploy tx
    f3946e514672e3f28a6fd7396f7a232567cbee7ab490c88ce93afe80a817cb41
  - Sanity invoke get_auction(99) returns Error(Contract, #1)
    (AuctionNotFound), confirming the error surface on chain.
- Next: day 7 e2e.sh (fresh deploys, 8 funded identities, decrypt, prove,
  settle, balance assertions, refund path).

## 2026-06-12: day 7 milestone DONE, e2e.sh green twice in a row on testnet

What the script proves end to end, from nothing but a funded friendbot
faucet: 11 fresh identities, fresh verifier (committed vkey) + tBENJI +
tUSDC + auction deploys, auction 1 with 8 sealed bids (circomlibjs
commitment, tweetnacl ciphertext emitted in the BidPlaced event), auction 2
with 3 bids, operator recovers bids purely from chain events and the
decryption key, recomputed commitments verified against storage, proof from
the committed zkey, on-chain settle, exact balance assertions on 8 bidders
plus seller plus the auction contract in both tokens, then refund_all on
auction 2 after its real-time grace period.

- Run A: exit 0 in 684 s. verifier CAO3WUSJ3AFJ4RXNQGRZQWJRKW6KK4R5U6HDA7POSWSSI4I5245GEA5B,
  auction CCHYAIMU2AJCSLAEESIUZM5KO74NZMVS5QCZ5IDH4OXOMXEIVMHEQOJM,
  tBENJI CCTT5WTMBFFAIGAIWKXQPI3BKJBHI2X2SOYKOM2PI75S5SEBXD64YXC7,
  tUSDC CCRL4I5LVKT5UNDL5V33WUSZPBSWJ7RNBAWC7W252OQ2HSM26ACXQSDC.
  create txs ed1535c2ff16d7d698ba36f5ac7bbbf38e74ec57c2a282557e8d3f14d0e7f7c0
  and e8392cff69ac89afeacbf7bba8e822424ef896200886dbee919a0b8e92b61268,
  settle tx 15d8379e04d96b144b2d8b5cf19cf6f25aade30732faae58f391ce514eb774da,
  refund tx 3a68420cdad0c3acfb46cf0eb4050aacd06c98b5046dcf8446651132a6d8b44c.
- Run B (own fresh deploys): exit 0 in 687 s.
  verifier CCIKAVZBV6ZH2MKRLY2EYDAVQXCN7YD4UN6GQXIUXDMPKASXSBFYOLRO,
  auction CA4PHJ2YDTYEULIRMX7JCL3YWJJMCROX4I4K7BLQBE2VLBNJK3FRVIUP,
  tBENJI CBR4ACJKZL4J6NCKGHFKCFPPM2ZL2ZBNIB7XHBV5M43O5HIK5NNDFDVC,
  tUSDC CBHFEWJKTGO63AEJFEJOES676XMIUDM32HY5OWXQYTG7GOMIH6JHG6QC.
  create txs 75a6656bf091035b8e79fd93d0efa0dfff42f61d4e693247476155dd2d724654
  and 07760ac2ebd94755f3a4c622981eb363bb0f22486559670ca4a842c5e1ff5579,
  settle tx 28ac5cf606305f297f0aa97a32d7c06e15ef434c103e4f6ec9fafe1c2e6ed9ba,
  refund tx 15748bebf4384b44081b90404357b7acc6756f849188784fd2ab286d5a6b05bd.
- Both runs: winner slot 2 at 350000, all 13 balance assertions exact, the
  auction contract ends holding zero in both tokens.
- Design notes: classic G accounts need trustlines before holding
  SAC-wrapped assets, so the script sets change-trust lines for the seller
  (both assets), every bidder (tUSDC), and the winner (tBENJI) before
  minting. Friendbot funding is idempotent: the curl call may report
  already-funded, the Horizon account lookup decides, with 5 retries.
  Deadlines are real wall-clock testnet time: a 420 s bid window shared by
  both auctions, auction 2 refundable 60 s after the deadline.
- Bug fixed during bring-up (first attempt died silently): helper functions
  logged to stdout while also returning data on stdout, so command
  substitution swallowed logs and corrupted captured values, and set -e
  aborted without a message. Rule now encoded in the script: logs go to
  stderr, function stdout carries data only, every capture is
  failure-wrapped, and an ERR trap names the failing line.
- The prover package gained @stellar/stellar-sdk 15.1.0 (event fetch and
  strkey decoding) and tweetnacl 1.0.3 (box encryption). format-args.js
  gained a vkey-only mode for deploy time.
- Salts and decrypted prices exist only in files under the run directory in
  /tmp (mode 700, key files 0600); no secret value is ever printed.

## 2026-06-12: days 8-9 stage 1, security audit complete

Full report: docs/AUDIT_DAYS_8_9.md. Nine findings: one HIGH (a trapping
seller rwa token could strand all bidder deposits by making refund_all
revert), three MEDIUM (ciphertext griefing voids settlement at zero cost;
no storage TTL management; privacy claim needed precision about public
bidder identities), five LOW.

Code fixes: refund_all now refunds deposits unconditionally and the lot
return leg is a caught try_transfer with a LotReturnFailed event plus a
permissionless reclaim_lot retry (three new error variants, lot_reclaimed
flag, three new tests against a stateful BreakableToken double);
create_auction extends entry and instance TTL to the auction lifetime plus
a day; clippy lint cleanup. Documentation fixes: MOCKS.md items 7 (bidder
identities are public, amounts are hidden) and 8 (ciphertext griefing and
the refund escape hatch), plus the zero-leaf invariant comment on
address_leaf.

Post-fix verification: clippy -D warnings clean, 23 of 23 cargo tests, 12
of 12 circuit tests, auction wasm 36958 bytes, and a full e2e.sh testnet
run exit 0 in 695 s (settle tx 8b9ba1f3c306a11b4714cdb94c5352cc4f4ba8e952
3f1e17e04d18839b530e85, refund tx 860c0cb1ec33db49f4f4d24fd208ea52bab7c2e
b57a75f6be3e9135074b8588b). Stage 2 (Vickrey estimate) reported separately;
N=16 rejected by drew.

## 2026-06-13: AMENDED FREEZE, public signal index 10 is the Vickrey price

Supersedes the 2026-06-12 freeze for index 10 ONLY. The vector shape,
length (13), and every other index are unchanged.

- Index 10, winning_price, now means the CLEARING price: the highest price
  among the non-winner slots (second price). The winner pays it; the
  winner's own bid value never appears in any public signal, event, log,
  or argument. No bid amount is ever revealed on chain, the winner's
  included; the clearing price is by construction some LOSING bid's value.
- In-circuit: a second-max fold over the non-winner slots (otherPrices
  zero out the winner via the one-hot indicators; 7 GreaterEqThan(64)
  comparators chain the maximum), then winningPrice === secondMax and
  winningPrice != 0.
- Degenerate rule (b), drew's decision 2026-06-13: with fewer than two
  positive-price bids the second max is 0, the nonzero constraint makes
  settlement unprovable, and the auction can only end through refund_all.
  The production alternative (a seller reserve price as an extra public
  input) is recorded in docs/MOCKS.md.
- The winner still holds the strict maximum with the lowest-index
  tie-break; on a top tie the clearing price equals the tied value.
- Contract interface unchanged: settle's winning_price argument now
  carries the clearing price; the existing checks (positive, at most
  max_price) apply unchanged.

## 2026-06-13: days 8-9 stage 2 DONE, Vickrey live end to end on testnet

- Circuit: second-max fold added; measured compile 6699 non-linear plus
  5594 linear constraints (12293 total, up 498 from first-price), still 13
  public inputs and inside pot14 with 4091 to spare. 14 of 14 circuit
  tests green, including the two new cases: the winner's own bid rejected
  as the public price, and the single-positive-bid auction unprovable
  under rule (b) in both price stories; the top-tie case clears at the
  tied value.
- New single-contribution ceremony (SEALEDSTELLAR_FORCE_SETUP=1):
  aw_final.zkey is now 5655954 bytes, vkey.json regenerated, both
  recommitted. alpha, beta, gamma unchanged (phase 1), delta and all 14 IC
  points new. Contract and demo fixture proofs regenerated; cargo 23 of 23
  and clippy -D warnings clean against the new material.
- Standing reference instances for the days 10-12 frontend (drew-dev):
  verifier CD7PHFDZMHHCN25FKCERAFVXQC77CQOF55YP57VU3WEVPDY7RCNH6EGO,
  auction CB5MMHVHPKG65D2DYO7HVGBDCMQIDEYP2O7DK5EYPYJUDZQXHWAJJDJ4
  (deploy txs a23fe8a8d451084068297e32667170931f9db967f4c7a492556a88534ef5
  c5d0 and 4d0e0252fa4d01971196c1a1866b2f1f8654ace9f418abdb22e7fb7ad7c570
  38). Earlier first-price instances remain on chain as history only.
- e2e.sh green twice in a row with the winner paying the second price
  (clearing 310000, winning bid 350000 never revealed):
  run A exit 0 in 681 s, settle tx
  66e9803e10c4627d318a756ff3126d1b2b011eb9cef9e894b376404cb7eb1315,
  refund tx
  f01e859954cdfecf0a4a5ee5280e95d0e9b0b05df497b4bd39470fae7d63bee0;
  run B exit 0 in 677 s, settle tx
  8f322a10eea95b17bc0e6c8b8b6e49775b3a52f474d7b875dac056c034ea1156,
  refund tx
  dc41ae4459576ae152613d539780f27d71b797ea679b4262b7b6e1312e67111d.
  Seller received exactly 310000, the winner paid exactly 310000 net and
  holds the lot, every loser was made whole, the contract ended at zero.
- Privacy claim updated everywhere it appears (MOCKS items 7 and 9,
  circuit header, settle doc comment, e2e header, prover output): no bid
  amount is ever revealed, including the winner's; the public clearing
  price is by construction a losing bid's value.
