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
