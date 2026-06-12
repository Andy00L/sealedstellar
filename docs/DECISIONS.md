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
