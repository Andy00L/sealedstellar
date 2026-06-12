# SealedStellar: Build Plan

Private sealed-bid auction for tokenized real-world assets on Stellar.
Bids stay hidden as Poseidon commitments. A Groth16 zero-knowledge proof, verified
inside a Soroban contract, establishes the winner and the clearing price without
opening any losing bid. Settlement (RWA token to winner, USDC to seller, refunds
to losers) fires atomically in the same call.

Target: 1st place at Stellar Hacks: Real-World ZK.
Window: submissions open June 15, 2026, 12:00 AM PST; deadline June 29, 2026, 12:00 PM PST.
Internal deadline: submit June 28, 2026 (one-day buffer, no exceptions).

Repo location (WSL): /home/drew/stelar10
Windows path: \\wsl.localhost\Ubuntu\home\drew\stelar10
All commands in this plan run inside WSL Ubuntu, never in PowerShell or cmd.

Governing standards: ~/.claude/SKILL_GENERAL.md and ~/.claude/REFERENCE_SECURITY_AUDIT.md
apply to every file in this repo. The agent never runs git. Testnet only, no real funds,
no mainnet, ever.

---

## 1. Why this wins (the bar to hit)

1. ZK is load-bearing: the contract cannot settle without a valid proof. This is the
   hackathon's number one eligibility rule.
2. The demo has a single magic moment: blurred bids, countdown hits zero, proof
   generates in the browser, the clearing price unseals on screen, and the testnet
   settlement transaction appears on Stellar Expert. Judges in the previous rounds
   rewarded exactly this pattern: real value moving seconds after a proof verifies.
3. The verifier path is de-risked: a Groth16 verifier over BN254 already exists in
   stellar/soroban-examples (groth16_verifier), built on the Protocol 25/26 host
   functions. The two weeks go into the product, not the toolchain.
4. The framing is Stellar-native: anti-sniping block trades for tokenized treasury
   style assets, plus a whitelist membership proof inside the circuit for regulated
   asset compliance. No other team is likely to attempt this.

What it is NOT: not a privacy pool fork, not a game, not a mixer. State plainly in
the README that bid privacy holds against the public and other bidders; the auction
operator (the prover) sees bids after close. The proof removes the need to trust the
operator about the OUTCOME. Honest scope statements are rewarded by these judges.

---

## 2. Protocol design (frozen before any code)

### 2.1 Roles
- Seller: creates an auction for a lot of an RWA token, paid in USDC.
- Bidders: up to N = 8 per auction (fixed circuit size for v1).
- Operator (prover): collects decrypted bids after close, computes the winner,
  generates the Groth16 proof, calls settle. Anyone holding the bids can do this;
  the proof makes the result trustless.

### 2.2 Commitment scheme
Each bid is a field element commitment:

    commitment_i = Poseidon(price_i, salt_i, auction_id)

- price_i: integer in token base units (i128 on chain, constrained to 64 bits in
  the circuit). Strictly greater than zero.
- salt_i: random 31-byte value generated in the bidder's browser, never reused.
- auction_id: u64 sequence number from the contract, bound into the commitment to
  block cross-auction replay.

The browser also encrypts (price_i, salt_i) to the operator's public key
(tweetnacl box) and the ciphertext is emitted in a contract event, so the operator
can recover bids after close without any off-chain channel. Bidders keep a local
copy as backup.

### 2.3 Uniform deposit escrow (critical privacy detail)
Deposits must NOT equal the bid, or the deposit amount leaks the bid on chain.
Rule: every bidder locks exactly max_price (an auction parameter) in USDC when
placing a bid. At settlement: winner pays winning_price from the deposit and is
refunded (max_price - winning_price); every loser is refunded max_price in full.
All on-chain amounts are identical across bidders, so nothing leaks.

### 2.4 Winner selection
First-price sealed-bid auction for v1. Tie-break: the lowest bidder index among
equal highest bids wins. This rule is enforced inside the circuit, not by the
operator. Vickrey (second-price) is a stretch goal only if days 8-9 are ahead of
schedule; it is one extra selection constraint, not a redesign.

### 2.5 Whitelist (compliance angle, the differentiator)
The seller commits a Poseidon Merkle root (depth 10, up to 1024 addresses) of
KYC-approved bidder addresses at auction creation. The circuit proves the winner's
address hash is a member of that tree. Losing bidders are never identified, so the
proof shows "the winner is compliance-approved" without revealing who else bid.

### 2.6 Circuit statement (public vs private)
Public inputs (order matters, freeze it day 3 and never change silently):
1. auction_id
2. commitments[8] (eight field elements; unused slots filled with a canonical
   zero-commitment the circuit recognizes and excludes from winning)
3. winner_index (0..7)
4. winning_price
5. whitelist_root
6. winner_addr_hash (Poseidon hash of the winner's Stellar address bytes)

Private inputs:
- price[8], salt[8]
- merkle_path[10], merkle_path_index_bits[10] for the winner

Constraints:
- For every i: Poseidon(price[i], salt[i], auction_id) == commitments[i], OR
  commitments[i] equals the canonical empty commitment and price[i] == 0.
- price values fit in 64 bits (Num2Bits range check).
- price[winner_index] >= price[i] for all i (GreaterEqThan over 64 bits), and for
  all i < winner_index: price[winner_index] > price[i] (strict, enforcing the
  lowest-index tie-break).
- winning_price == price[winner_index] and winning_price > 0.
- MerkleTreeChecker(depth 10, Poseidon) proves winner_addr_hash under whitelist_root.

Estimated size: 8 Poseidon(3) commitments + 10 Poseidon(2) tree levels + 8 range
checks (64-bit) + 8 comparators. Well under 2^14 constraints. Use
powersOfTau28_hez_final_14.ptau. If the build measures above 16k constraints,
move to the _15 file; do not guess, read the circom compile output.

### 2.7 Contract-side replay and lifecycle rules
- settle succeeds at most once per auction (state flag checked before the verifier
  call, set in the same invocation).
- settle requires now >= commit_deadline.
- The proof binds auction_id and the exact stored commitments: the contract
  reconstructs the public input vector itself from storage plus the caller-supplied
  (winner_index, winning_price, winner_address). The caller can NEVER supply the
  commitments or the auction_id directly.
- Timeout escape hatch: if no valid settle by commit_deadline + grace_period,
  anyone may call refund_all and every deposit returns. No funds can be stranded.

---

## 3. Architecture and repo layout

    Browser (bidder)                Operator console (browser)        Stellar testnet
    --------------------            ---------------------------       -----------------------
    Poseidon commitment   --------> place_bid(commitment,             auction contract
    encrypt bid to op key            ciphertext) + lock max_price       - storage, escrow,
                                                                         deadlines, refunds
                                    decrypt bids after close            - settle() calls -->
                                    snarkjs prove in browser          groth16_verifier contract
                                    settle(proof, winner,               (BN254 host functions)
                                           winning_price)             mock tBENJI + tUSDC tokens

Repo layout (follows SKILL_GENERAL folder hygiene: one concern per folder):

    stelar10/
      CLAUDE.md                  repo-level standards file (copy of template)
      docs/
        BRIEF.md                 one page: what, why, success criteria
        DECISIONS.md             every design decision with date and reason
        MOCKS.md                 the honest-mocks ledger (section 9 below)
      circuits/
        auction_winner.circom    main circuit
        lib/                     commitment.circom, merkle.circom (or circomlib use)
        test/                    circom_tester unit tests
        scripts/                 compile.sh, setup.sh, prove.sh, export-vk.sh
        build/                   gitignored artifacts (r1cs, wasm, zkey)
      contracts/                 Rust workspace
        auction/                 the auction contract
        verifier/                groth16 verifier adapted from soroban-examples
      prover/                    Node CLI: witness build, prove, format Soroban args
      web/                       React + Vite app (drew owns final polish)
      scripts/
        deploy-testnet.sh        deploy verifier, tokens, auction; write addresses
        e2e.sh                   full happy path from the CLI, no browser
      README.md
      .env.example               documented variables, never real secrets
      .gitignore                 build/, .env, *.zkey upload policy decided day 4

---

## 4. Toolchain and environment setup (WSL Ubuntu)

Run every block inside WSL. If a command is issued from Claude Desktop and the shell
lands on Windows, wrap it:

    wsl -d Ubuntu --cd /home/drew/stelar10 -- bash -lc "<command>"

### 4.1 Base packages

    sudo apt update && sudo apt install -y build-essential pkg-config libssl-dev \
      libudev-dev curl git jq

### 4.2 Rust + Soroban target

    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
    rustup target add wasm32v1-none
    # Older toolchains used wasm32-unknown-unknown. Run `stellar contract build`
    # once and follow whatever target IT reports missing. Do not assume.

### 4.3 Stellar CLI

    cargo install --locked stellar-cli
    stellar --version
    stellar keys generate --global drew-dev --network testnet --fund
    stellar keys address drew-dev    # fund again at https://lab.stellar.org if needed

Network config used everywhere: --network testnet
(RPC https://soroban-testnet.stellar.org, passphrase "Test SDF Network ; September 2015").
Verify both against current docs on day 0; do not trust this file if they disagree.

### 4.4 Node + circom + snarkjs

    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    source ~/.bashrc && nvm install 20 && nvm use 20
    npm install -g snarkjs
    git clone https://github.com/iden3/circom.git ~/tools/circom
    cd ~/tools/circom && cargo build --release && cargo install --path circom
    circom --version    # expect 2.1.x or newer

In circuits/: `npm init -y && npm install circomlib circomlibjs circom_tester chai mocha`

### 4.5 Reference repos (read, never blind-copy; cite file paths in comments)

    mkdir -p ~/ref && cd ~/ref
    git clone https://github.com/stellar/soroban-examples.git
    git clone https://github.com/NethermindEth/stellar-risc0-verifier.git   # comparison only

Find the Groth16 verifier inside soroban-examples (search the repo for
groth16; on the p25-preview branch if not on main). READ its test file first:
it defines the exact byte serialization for proof points and public inputs
that the prover must reproduce. That test is the source of truth, not memory.

### 4.6 Powers of tau

    cd circuits && mkdir -p build
    curl -L -o build/pot14.ptau \
      https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_14.ptau

If this URL is dead, fetch the current mirror from the snarkjs README. Verify the
file hash listed there before use.

---

## 5. Phase plan, day by day

Phase 0 runs before submissions open and is limited to environment setup, reading,
and throwaway toolchain spikes. Day 0 action: read the official rules page once more
and confirm whether code written before June 15 is eligible. If pre-window code is
restricted, every spike is rebuilt fresh inside the window (they are tiny by design).

### Phase 0: June 11-14 (prep, throwaway spikes only)
- Install everything in section 4. Definition of done: `stellar --version`,
  `circom --version`, `snarkjs --version` all print, and drew-dev is funded.
- Read in full: the soroban-examples Groth16 verifier and its test, the Stellar
  ZK docs page (developers.stellar.org/docs/build/apps/zk), the BN254 and Poseidon
  migration pages in the soroban-sdk docs.
- Spike (throwaway, lives in /tmp): compile circomlib's multiplier2-style toy
  circuit, run trusted setup, produce one proof, verify with `snarkjs groth16 verify`.
  Done when verification prints OK locally. No on-chain work yet.

### Days 1-2 (June 15-16): THE de-risk milestone, proof verified on testnet
Goal: a trivial Circom proof verified inside a Soroban contract on testnet.
- Copy the Groth16 verifier example into contracts/verifier; adapt to take the
  verification key at init (constructor) and expose verify(proof_bytes, public_inputs).
- Write prover/format-args: convert snarkjs proof.json + public.json into the exact
  byte layout the verifier test uses (read that test line by line; mirror it).
- Deploy to testnet, invoke verify with a real proof, get true; flip one public
  input byte, get false.
Definition of done: two testnet transaction hashes saved in docs/DECISIONS.md, one
passing and one failing. THIS IS THE GO/NO-GO GATE. If blocked after two full days,
escalate to the #zk-chat Discord with a minimal repro, and in parallel evaluate the
RISC Zero fallback (section 10). Do not start the real circuit while this gate is red.

### Days 3-4 (June 17-18): the real circuit
- Implement auction_winner.circom exactly per section 2.6. Freeze the public input
  order in docs/DECISIONS.md.
- Unit tests with circom_tester: honest winner accepted; wrong winner_index rejected;
  inflated winning_price rejected; commitment mismatch rejected; tie goes to lowest
  index; empty slots cannot win; price of zero rejected; non-member fails the
  whitelist check. Eight tests minimum, all red-green verified.
- Run setup.sh (groth16 setup + one contribution + export vkey), prove.sh on a
  fixture of 8 bids, verify locally, then verify ON TESTNET through the day 1
  verifier with the real circuit's vkey.
Done when: the real circuit's proof verifies on testnet, and the compile output
(constraint count) is recorded in DECISIONS.md.

### Days 5-6 (June 19-20): auction contract
Interface (errors as values per SKILL_GENERAL; no panics in business logic):

    fn create_auction(seller, rwa_token, lot_amount, payment_token, max_price,
                      commit_deadline, grace_period, whitelist_root,
                      operator_enc_pubkey) -> Result<AuctionId, AuctionError>
    fn place_bid(auction_id, bidder, commitment, encrypted_bid) -> Result<(), AuctionError>
        // require_auth(bidder); transfer max_price deposit in; cap 8 bids;
        // reject after commit_deadline; reject duplicate commitment.
    fn settle(auction_id, winner_index, winning_price, winner_address,
              merkle_proof_unused_on_chain, proof_bytes) -> Result<(), AuctionError>
        // rebuild public inputs FROM STORAGE + args; cross-contract call to
        // verifier; on true: move lot to winner, winning_price to seller,
        // refund winner (max_price - winning_price), refund all losers,
        // set Settled. Single state transition, idempotency checked first.
    fn refund_all(auction_id) -> Result<(), AuctionError>
        // only after commit_deadline + grace_period and not Settled.
    fn get_auction(auction_id) -> Result<AuctionView, AuctionError>

- Distinct error variants for every failure mode (deadline passed, already settled,
  bids full, bad proof, transfer failed, not found). Different mode, different error.
- Deploy two Stellar Asset Contract tokens on testnet as tBENJI and tUSDC mocks:
  `stellar contract asset deploy --asset CODE:ISSUER --network testnet` (issuer is a
  throwaway testnet key; mint to test accounts). Record in docs/MOCKS.md.
- Rust unit tests covering every error path plus the happy path. `cargo test` green.

### Day 7 (June 21): end-to-end on testnet, CLI only
- scripts/e2e.sh: deploy fresh contracts, create auction, place 8 bids from 8 funded
  test identities, decrypt, prove, settle, assert final balances of all 10 accounts,
  then run the refund_all path on a second auction that never settles.
Done when e2e.sh exits 0 twice in a row from a clean clone. This script is also the
judge's reproduction path: it goes in the README verbatim.

### Days 8-9 (June 22-23): hardening + stretch
- Mid-project audit pass: hackathon submission is an explicit trigger in
  REFERENCE_SECURITY_AUDIT.md, so run the relevant phases against contracts/ and
  circuits/ now, not on day 13. Record the report in docs/.
- Fix list from the audit. Re-run all tests and e2e.sh.
- Only if fully green and ahead: Vickrey pricing OR raise N to 16. Never both.

### Days 10-12 (June 24-26): frontend (drew leads polish, agent scaffolds)
- React + Vite + TypeScript in web/. Stellar Wallets Kit for Freighter connect.
- Bidder flow: auction room with live commitment cards (blurred bars), countdown,
  bid modal computing the Poseidon commitment in-browser (circomlibjs) and the
  tweetnacl ciphertext, then one wallet signature for place_bid.
- Operator flow: after close, decrypt bids client-side, run snarkjs groth16
  fullProve with the circuit wasm + zkey IN THE BROWSER (the circuit is small
  enough; show a progress indicator), then one wallet signature for settle.
- The unseal moment: on settle success, animate winner card flipping from blurred
  to clearing price, render a VERIFIED ON SOROBAN stamp, link the transaction on
  https://stellar.expert/explorer/testnet/tx/<hash>.
- State lives in component state; no browser storage APIs (standards rule).
- Fallback if browser proving stalls: prove via `node prover/prove.js` and paste
  the proof into the UI; document in MOCKS.md. Do not lose a day to WASM issues.

### Day 13 (June 27): freeze, docs, video
- Feature freeze at 09:00. README final: 30-second pitch, architecture diagram,
  exact testnet contract IDs + Stellar Expert links, one-command repro (e2e.sh),
  "What is real vs mocked" section copied from docs/MOCKS.md, ZKP2P-adjacent and
  sealed-bid prior art credited honestly.
- Record the demo video (script in section 8). Two takes maximum, pick one.

### Day 14 (June 28): submit
- Fresh-clone test on a second WSL user or container: follow the README only.
- Submit the BUIDL on DoraHacks with repo link + video. Confirm it shows as
  submitted. Buffer day June 29 morning is for platform failures only.

---

## 6. Prover pipeline (exact commands, circuits/scripts/)

    # compile.sh
    circom auction_winner.circom --r1cs --wasm --sym -o build -l node_modules

    # setup.sh
    snarkjs groth16 setup build/auction_winner.r1cs build/pot14.ptau build/aw_0000.zkey
    snarkjs zkey contribute build/aw_0000.zkey build/aw_final.zkey \
      --name="drew" -e="$(head -c 64 /dev/urandom | xxd -p)"
    snarkjs zkey export verificationkey build/aw_final.zkey build/vkey.json

    # prove.sh  (input.json built by prover/build-input.js from decrypted bids)
    node build/auction_winner_js/generate_witness.js \
      build/auction_winner_js/auction_winner.wasm input.json build/witness.wtns
    snarkjs groth16 prove build/aw_final.zkey build/witness.wtns \
      build/proof.json build/public.json
    snarkjs groth16 verify build/vkey.json build/public.json build/proof.json

prover/format-args.js then maps proof.json (pi_a, pi_b, pi_c) and public.json into
the byte layout the Soroban verifier expects. The mapping is copied from the
verifier example's own test with a sourceRef comment naming the exact file. Mind
the G2 coordinate ordering (snarkjs nests [[x1,x2],[y1,y2]]; pairing libraries
differ on order): if verification fails on-chain but passes locally, swap the G2
limb order FIRST before debugging anything else. Note this in a comment.

The development zkey ceremony is single-contributor and therefore trusted-setup
weak. State this in MOCKS.md; it is expected at hackathon scale.

---

## 7. Security checklist (auction-specific, from REFERENCE_SECURITY_AUDIT.md)

Money and assets:
- Settle exactly once; idempotency flag read-then-set within one invocation.
- Sum check in tests: deposits in == payouts + refunds out, to the stroop.
- refund_all covers operator disappearance; no path strands funds.
- All amounts i128; reject zero and negative; lot_amount > 0; max_price > 0.
Replay and binding:
- auction_id inside every commitment and inside the proof's public inputs.
- Contract rebuilds public inputs from its own storage; caller supplies only
  winner_index, winning_price, winner_address, proof bytes.
- A proof for auction A replayed on auction B must fail: covered by a test.
Authorization:
- require_auth on bidder for place_bid and on seller for create_auction.
- settle and refund_all are permissionless by design (the proof or the clock is
  the authority); document this decision in DECISIONS.md.
Circuit:
- Range-check every price (64-bit); strict tie-break constraints; empty-slot
  handling cannot be abused to win with a zero bid (explicit test).
- Public input ORDER frozen and asserted identically in circuit, contract, prover.
Secrets:
- Salts and decrypted bids never logged anywhere, including the browser console.
- Operator decryption key entered at runtime, never committed; .env gitignored.
- Every log line carries a [FunctionName] prefix and redacts identifiers.

---

## 8. Demo video script (2 minutes 30 seconds)

    0:00-0:15  Hook. "On a public blockchain, every bid is visible, so large trades
               of tokenized assets get sniped. SealedStellar fixes the auction."
    0:15-0:45  Live: three browser windows bid on a tBENJI lot. Cards appear
               blurred. Voiceover: amounts are Poseidon commitments, deposits are
               uniform, nothing leaks.
    0:45-1:30  The moment. Countdown hits zero. Operator clicks Settle. Proof
               generates in the browser with a progress bar. The winning card
               unseals to the clearing price; losing cards stay blurred forever.
               VERIFIED ON SOROBAN stamp; cut to the Stellar Expert transaction
               showing token and USDC legs settle atomically.
    1:30-2:00  How: 20-second architecture diagram. Circom Groth16, BN254 host
               functions from Protocols 25/26, verifier contract, whitelist
               membership proved in-circuit for regulated assets.
    2:00-2:30  Honesty + close. "Operator sees bids after close; the proof makes
               the OUTCOME trustless. Tokens are testnet mocks. Repo, e2e script,
               and contract IDs in the README." End on the unseal replay.

---

## 9. Honest-mocks ledger (docs/MOCKS.md, mirrored in README)

1. tBENJI and tUSDC are testnet Stellar Asset Contract tokens minted by us; no
   real Franklin Templeton or Circle assets are involved.
2. The operator learns bid values after close; privacy is against the public and
   other bidders. Trustless alternatives (MPC, timelock encryption) listed as
   future work.
3. Groth16 zkey from a single-contribution dev ceremony; a production deployment
   needs a real multi-party ceremony.
4. Whitelist is a demo Merkle tree of test addresses, standing in for an issuer's
   KYC registry.
5. N is fixed at 8 bidders per auction in v1.
If browser proving was replaced by CLI proving anywhere in the demo, say so here.

---

## 10. Risk register and fallbacks

1. Day 1-2 gate fails (verifier will not verify on testnet): switch to the RISC
   Zero path: reimplement winner selection as a Rust guest program, prove with
   the zkVM, verify the Groth16 receipt via NethermindEth/stellar-risc0-verifier.
   Decision deadline: end of day 3. The product and UI are unchanged.
2. Circuit exceeds budget on-chain: drop whitelist depth to 5, then N to 4.
   Measure with the CLI's cost output before cutting features blind.
3. Browser proving too slow or WASM issues: CLI proving, documented (section 5,
   days 10-12 fallback). Costs polish, not eligibility.
4. snarkjs-to-Soroban serialization mismatch: G2 limb order swap first; then diff
   against the verifier example's test vectors byte by byte.
5. Time collapse generally: the cut order is Vickrey, then whitelist, then N=4.
   NEVER cut: on-chain verification, uniform deposits, refund_all, the e2e script.

---

## 11. Submission checklist (June 28)

    [ ] Public GitHub repo, README per day 13 spec, license file
    [ ] e2e.sh passes from a fresh clone following only the README
    [ ] Verifier + auction contract IDs on testnet listed and linked
    [ ] 2:30 video uploaded (YouTube unlisted is fine) and linked
    [ ] docs/MOCKS.md honest and current
    [ ] Final-check greps from SKILL_GENERAL.md pass on every file
    [ ] BUIDL submitted on DoraHacks and visible; screenshot saved
