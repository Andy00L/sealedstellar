#!/usr/bin/env bash
# SealedStellar end-to-end reproduction script (plan section 5, day 7).
# From a fresh clone (after the README install steps: rust + stellar-cli,
# node, circom, snarkjs, npm install in circuits/ and prover/) this script:
#   1. generates and friendbot-funds 11 fresh testnet identities
#      (issuer, seller, operator, 8 bidders),
#   2. deploys fresh contracts: verifier (committed vkey), tBENJI and tUSDC
#      Stellar Asset Contracts, the auction contract,
#   3. creates auction 1, places 8 sealed bids (circomlibjs commitment +
#      tweetnacl ciphertext in the event), creates auction 2 with 3 bids,
#   4. as the operator: fetches the bid events, decrypts, proves with the
#      committed zkey, settles auction 1 on testnet,
#   5. asserts the exact final token balances of all 10 money-touching
#      accounts (8 bidders, seller, auction contract),
#   6. waits out the grace period and runs refund_all on auction 2, then
#      asserts the refund balances too.
# Exits 0 only if every step and every assertion passes. Testnet only.
#
# Conventions: every log line goes to stderr with an [e2e:phase] prefix;
# stdout of helper functions carries data only (safe to capture).
set -Eeuo pipefail

log() { echo "[e2e:$1] $2" >&2; }
fail() { log "$1" "FAIL: $2"; exit 1; }
report_abort() { echo "[e2e:fatal] aborted at line ${BASH_LINENO[0]}: $BASH_COMMAND" >&2; }
trap report_abort ERR

# ----------------------------------------------------------------------------
# Configuration (amounts are abstract token base units)
# ----------------------------------------------------------------------------
NETWORK="testnet"
RPC_URL="https://soroban-testnet.stellar.org"
HORIZON_URL="https://horizon-testnet.stellar.org"

LOT_AMOUNT=1000
MAX_PRICE=500000
BIDDER_FUNDING_USDC=1000000
# Bid prices for auction 1; unique maximum 350000 at slot 2.
BID_PRICES=(120000 280000 350000 200000 310000 90000 150000 260000)
EXPECTED_WINNER_INDEX=2
EXPECTED_WINNING_PRICE=350000
# Auction 2 (refund path) bid prices, 3 bidders.
REFUND_BID_PRICES=(110000 90000 130000)

# Auction 1 deadline leaves room for 11 bid transactions; its grace period is
# long so it can never hit the refund path during the run. Auction 2 refunds
# shortly after the shared deadline.
BID_WINDOW_SECONDS=420
AUCTION1_GRACE=86400
AUCTION2_GRACE=60

# ----------------------------------------------------------------------------
# Paths and prerequisites
# ----------------------------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"
RUN_DIR="$(mktemp -d /tmp/sealedstellar-e2e.XXXXXX)"
chmod 700 "$RUN_DIR"
RUN_TAG="$(date +%s)-$$"
log setup "run directory $RUN_DIR (tag $RUN_TAG)"

for required_tool in stellar node npm jq curl snarkjs circom; do
  command -v "$required_tool" > /dev/null 2>&1 \
    || fail setup "missing tool: $required_tool (see README install steps)"
done

if [ ! -d circuits/node_modules ]; then
  log setup "installing circuits npm dependencies"
  (cd circuits && npm install --no-audit --no-fund > /dev/null 2>&1)
fi
if [ ! -d prover/node_modules ]; then
  log setup "installing prover npm dependencies"
  (cd prover && npm install --no-audit --no-fund > /dev/null 2>&1)
fi
if [ ! -f circuits/build/auction_winner_js/auction_winner.wasm ]; then
  log setup "compiling the circuit (witness wasm missing)"
  bash circuits/scripts/compile.sh > /dev/null 2>&1
fi
[ -f circuits/build/aw_final.zkey ] || fail setup "missing committed circuits/build/aw_final.zkey"
[ -f circuits/build/vkey.json ] || fail setup "missing committed circuits/build/vkey.json"

VERIFIER_WASM="contracts/target/wasm32v1-none/release/sealedstellar_verifier.wasm"
AUCTION_WASM="contracts/target/wasm32v1-none/release/sealedstellar_auction.wasm"
if [ ! -f "$VERIFIER_WASM" ] || [ ! -f "$AUCTION_WASM" ]; then
  log setup "building contract wasm"
  (cd contracts && stellar contract build > /dev/null 2>&1)
fi

FRIENDBOT_URL="$(curl -fsS -X POST "$RPC_URL" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getNetwork"}' | jq -r '.result.friendbotUrl')" \
  || fail setup "getNetwork RPC call failed"
[ -n "$FRIENDBOT_URL" ] && [ "$FRIENDBOT_URL" != "null" ] \
  || fail setup "could not resolve friendbot url from RPC"
log setup "friendbot: $FRIENDBOT_URL"

# ----------------------------------------------------------------------------
# Identities and funding (idempotent: friendbot may report already-funded;
# the Horizon account lookup is the source of truth)
# ----------------------------------------------------------------------------
fund_account() {
  local account_address="$1"
  local attempt
  for attempt in 1 2 3 4 5; do
    curl -fsS "${FRIENDBOT_URL%/}/?addr=${account_address}" > /dev/null 2>&1 || true
    if curl -fsS "$HORIZON_URL/accounts/$account_address" -o /dev/null 2> /dev/null; then
      return 0
    fi
    log fund "account not visible yet (attempt $attempt), retrying"
    sleep 3
  done
  return 1
}

# Sets MADE_ALIAS and MADE_ADDR; runs in the main shell so failures surface.
make_identity() {
  local role="$1"
  MADE_ALIAS="e2e-$RUN_TAG-$role"
  stellar keys generate "$MADE_ALIAS" --network "$NETWORK" > /dev/null 2>&1 \
    || fail fund "keys generate failed for $role"
  MADE_ADDR="$(stellar keys address "$MADE_ALIAS")" \
    || fail fund "keys address failed for $role"
  fund_account "$MADE_ADDR" || fail fund "friendbot funding failed for $role"
  log fund "$role funded: $MADE_ADDR"
}

make_identity issuer;   ISSUER_ALIAS="$MADE_ALIAS";   ISSUER_ADDR="$MADE_ADDR"
make_identity seller;   SELLER_ALIAS="$MADE_ALIAS";   SELLER_ADDR="$MADE_ADDR"
make_identity operator; OPERATOR_ALIAS="$MADE_ALIAS"; OPERATOR_ADDR="$MADE_ADDR"
BIDDER_ALIASES=()
BIDDER_ADDRS=()
for bidder_index in 0 1 2 3 4 5 6 7; do
  make_identity "bidder$bidder_index"
  BIDDER_ALIASES+=("$MADE_ALIAS")
  BIDDER_ADDRS+=("$MADE_ADDR")
done

# ----------------------------------------------------------------------------
# Fresh deploys
# ----------------------------------------------------------------------------
extract_tx_hash() {
  { grep -oE 'Signing transaction: [0-9a-f]{64}' "$1" || true; } | tail -1 | cut -d' ' -f3
}

node prover/format-args.js --vkey circuits/build/vkey.json --out "$RUN_DIR/vkey-args.json" \
  > /dev/null || fail deploy "format-args vkey-only mode failed"
VK_JSON="$(jq -c .verification_key "$RUN_DIR/vkey-args.json")"

VERIFIER_ID="$(stellar contract deploy --wasm "$VERIFIER_WASM" --source "$OPERATOR_ALIAS" \
  --network "$NETWORK" -- --verification_key "$VK_JSON" 2> "$RUN_DIR/deploy-verifier.log" | tail -1)" \
  || fail deploy "verifier deploy failed (see $RUN_DIR/deploy-verifier.log)"
[ -n "$VERIFIER_ID" ] || fail deploy "verifier deploy produced no contract id"
log deploy "verifier: $VERIFIER_ID (tx $(extract_tx_hash "$RUN_DIR/deploy-verifier.log"))"

BENJI_SAC="$(stellar contract asset deploy --asset "tBENJI:$ISSUER_ADDR" --network "$NETWORK" \
  --source "$ISSUER_ALIAS" 2> "$RUN_DIR/deploy-benji.log" | tail -1)" \
  || fail deploy "tBENJI deploy failed (see $RUN_DIR/deploy-benji.log)"
USDC_SAC="$(stellar contract asset deploy --asset "tUSDC:$ISSUER_ADDR" --network "$NETWORK" \
  --source "$ISSUER_ALIAS" 2> "$RUN_DIR/deploy-usdc.log" | tail -1)" \
  || fail deploy "tUSDC deploy failed (see $RUN_DIR/deploy-usdc.log)"
log deploy "tBENJI SAC: $BENJI_SAC"
log deploy "tUSDC SAC: $USDC_SAC"

AUCTION_CONTRACT="$(stellar contract deploy --wasm "$AUCTION_WASM" --source "$OPERATOR_ALIAS" \
  --network "$NETWORK" -- --verifier "$VERIFIER_ID" 2> "$RUN_DIR/deploy-auction.log" | tail -1)" \
  || fail deploy "auction deploy failed (see $RUN_DIR/deploy-auction.log)"
[ -n "$AUCTION_CONTRACT" ] || fail deploy "auction deploy produced no contract id"
log deploy "auction: $AUCTION_CONTRACT (tx $(extract_tx_hash "$RUN_DIR/deploy-auction.log"))"

# ----------------------------------------------------------------------------
# Trustlines and minting (classic G accounts need trustlines before they can
# hold SAC-wrapped assets)
# ----------------------------------------------------------------------------
change_trust() {
  local holder_alias="$1" asset_line="$2"
  stellar tx new change-trust --source-account "$holder_alias" --network "$NETWORK" \
    --line "$asset_line" > /dev/null 2>&1 \
    || fail trust "change-trust $asset_line failed for $holder_alias"
}
mint_to() {
  local sac_id="$1" recipient="$2" amount="$3"
  stellar contract invoke --id "$sac_id" --source "$ISSUER_ALIAS" --network "$NETWORK" \
    -- mint --to "$recipient" --amount "$amount" > /dev/null 2> /dev/null \
    || fail mint "mint $amount to $recipient failed"
}

log trust "setting trustlines (seller both assets, bidders tUSDC, winner tBENJI)"
change_trust "$SELLER_ALIAS" "tBENJI:$ISSUER_ADDR"
change_trust "$SELLER_ALIAS" "tUSDC:$ISSUER_ADDR"
for bidder_index in 0 1 2 3 4 5 6 7; do
  change_trust "${BIDDER_ALIASES[$bidder_index]}" "tUSDC:$ISSUER_ADDR"
done
change_trust "${BIDDER_ALIASES[$EXPECTED_WINNER_INDEX]}" "tBENJI:$ISSUER_ADDR"

log mint "minting 2x lot to seller and deposit funding to bidders"
mint_to "$BENJI_SAC" "$SELLER_ADDR" $((LOT_AMOUNT * 2))
for bidder_index in 0 1 2 3 4 5 6 7; do
  mint_to "$USDC_SAC" "${BIDDER_ADDRS[$bidder_index]}" "$BIDDER_FUNDING_USDC"
done
log mint "minting complete"

# ----------------------------------------------------------------------------
# Operator key, whitelist, auctions
# ----------------------------------------------------------------------------
node prover/operator-keygen.js --out "$RUN_DIR/operator-box-key.json" > /dev/null \
  || fail operator "operator keygen failed"
OPERATOR_BOX_PUB="$(jq -r .publicKeyHex "$RUN_DIR/operator-box-key.json")"
log operator "box public key ready"

WHITELIST_CSV="$(IFS=,; echo "${BIDDER_ADDRS[*]}")"
node prover/build-whitelist.js --addresses "$WHITELIST_CSV" --out "$RUN_DIR/whitelist.json" \
  > /dev/null || fail whitelist "whitelist build failed"
WHITELIST_ROOT="$(jq -r .rootDecimal "$RUN_DIR/whitelist.json")"
log whitelist "root computed over 8 members"

NOW_EPOCH="$(date +%s)"
COMMIT_DEADLINE=$((NOW_EPOCH + BID_WINDOW_SECONDS))
log create "commit deadline $COMMIT_DEADLINE (in ${BID_WINDOW_SECONDS}s), auction 2 grace ${AUCTION2_GRACE}s"

create_auction() {
  local grace_seconds="$1" log_file="$2"
  stellar contract invoke --id "$AUCTION_CONTRACT" --source "$SELLER_ALIAS" --network "$NETWORK" \
    -- create_auction --seller "$SELLER_ADDR" --rwa_token "$BENJI_SAC" \
    --lot_amount "$LOT_AMOUNT" --payment_token "$USDC_SAC" --max_price "$MAX_PRICE" \
    --commit_deadline "$COMMIT_DEADLINE" --grace_period "$grace_seconds" \
    --whitelist_root "$WHITELIST_ROOT" --operator_enc_pubkey "$OPERATOR_BOX_PUB" \
    2> "$log_file" | tail -1
}

AUCTION1_ID="$(create_auction "$AUCTION1_GRACE" "$RUN_DIR/create-1.log")" \
  || fail create "create_auction 1 failed (see $RUN_DIR/create-1.log)"
AUCTION1_TX="$(extract_tx_hash "$RUN_DIR/create-1.log")"
[ "$AUCTION1_ID" = "1" ] || fail create "expected auction id 1, got: $AUCTION1_ID"
AUCTION2_ID="$(create_auction "$AUCTION2_GRACE" "$RUN_DIR/create-2.log")" \
  || fail create "create_auction 2 failed (see $RUN_DIR/create-2.log)"
AUCTION2_TX="$(extract_tx_hash "$RUN_DIR/create-2.log")"
[ "$AUCTION2_ID" = "2" ] || fail create "expected auction id 2, got: $AUCTION2_ID"
log create "auction 1 (settle path) tx $AUCTION1_TX"
log create "auction 2 (refund path) tx $AUCTION2_TX"

# ----------------------------------------------------------------------------
# Bids (commitment + ciphertext per bid; salts never printed)
# ----------------------------------------------------------------------------
START_LEDGER="$(curl -fsS -X POST "$RPC_URL" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}' | jq -r '.result.sequence')" \
  || fail bids "getLatestLedger RPC call failed"
START_LEDGER=$((START_LEDGER - 5))
log bids "event window starts at ledger $START_LEDGER"

place_bid() {
  local auction_id="$1" bidder_index="$2" price="$3" bid_file="$4" log_file="$5"
  node prover/make-bid.js --price "$price" --auction-id "$auction_id" \
    --operator-pub "$OPERATOR_BOX_PUB" --out "$bid_file" > /dev/null \
    || fail bids "make-bid failed for bidder $bidder_index"
  stellar contract invoke --id "$AUCTION_CONTRACT" --source "${BIDDER_ALIASES[$bidder_index]}" \
    --network "$NETWORK" -- place_bid --auction_id "$auction_id" \
    --bidder "${BIDDER_ADDRS[$bidder_index]}" \
    --commitment "$(jq -r .commitmentDecimal "$bid_file")" \
    --encrypted_bid "$(jq -r .encryptedBidHex "$bid_file")" \
    > /dev/null 2> "$log_file" \
    || fail bids "place_bid failed for bidder $bidder_index on auction $auction_id (see $log_file)"
}

for bidder_index in 0 1 2 3 4 5 6 7; do
  place_bid 1 "$bidder_index" "${BID_PRICES[$bidder_index]}" \
    "$RUN_DIR/bid-a1-$bidder_index.json" "$RUN_DIR/bid-a1-$bidder_index.log"
  log bids "auction 1 slot $bidder_index sealed (tx $(extract_tx_hash "$RUN_DIR/bid-a1-$bidder_index.log"))"
done
for bidder_index in 0 1 2; do
  place_bid 2 "$bidder_index" "${REFUND_BID_PRICES[$bidder_index]}" \
    "$RUN_DIR/bid-a2-$bidder_index.json" "$RUN_DIR/bid-a2-$bidder_index.log"
  log bids "auction 2 slot $bidder_index sealed (tx $(extract_tx_hash "$RUN_DIR/bid-a2-$bidder_index.log"))"
done

# ----------------------------------------------------------------------------
# Operator flow: events -> decrypt -> input -> proof (overlaps the deadline)
# ----------------------------------------------------------------------------
node prover/fetch-bid-events.js --rpc "$RPC_URL" --contract "$AUCTION_CONTRACT" \
  --start-ledger "$START_LEDGER" --auction-id 1 --out "$RUN_DIR/events-a1.json" >&2 \
  || fail operator "event fetch failed"
EVENT_COUNT="$(jq '.bids | length' "$RUN_DIR/events-a1.json")"
[ "$EVENT_COUNT" = "8" ] || fail operator "expected 8 bid events, got $EVENT_COUNT"

# Integrity: event commitments must equal the stored on-chain commitments.
stellar contract invoke --id "$AUCTION_CONTRACT" --source "$OPERATOR_ALIAS" --network "$NETWORK" \
  -- get_auction --auction_id 1 2> /dev/null | tail -1 > "$RUN_DIR/auction-1-view.json" \
  || fail operator "get_auction failed"
STORED_COMMITMENTS="$(jq -c '[.bids[].commitment]' "$RUN_DIR/auction-1-view.json")"
EVENT_COMMITMENTS="$(jq -c '[.bids[].commitmentDecimal]' "$RUN_DIR/events-a1.json")"
[ "$STORED_COMMITMENTS" = "$EVENT_COMMITMENTS" ] \
  || fail operator "event commitments do not match on-chain storage"
log operator "event commitments match on-chain storage"

node prover/operator-decrypt.js --secret-file "$RUN_DIR/operator-box-key.json" \
  --bids-file "$RUN_DIR/events-a1.json" --out "$RUN_DIR/decrypted-a1.json" >&2 \
  || fail operator "decryption failed"
node prover/build-input.js --decrypted-file "$RUN_DIR/decrypted-a1.json" \
  --whitelist-file "$RUN_DIR/whitelist.json" --out-input "$RUN_DIR/input-a1.json" \
  --out-meta "$RUN_DIR/settle-meta.json" >&2 \
  || fail operator "input build failed"

WINNER_INDEX="$(jq -r .winnerIndex "$RUN_DIR/settle-meta.json")"
WINNING_PRICE="$(jq -r .winningPrice "$RUN_DIR/settle-meta.json")"
WINNER_ADDRESS="$(jq -r .winnerAddress "$RUN_DIR/settle-meta.json")"
[ "$WINNER_INDEX" = "$EXPECTED_WINNER_INDEX" ] \
  || fail operator "operator-derived winner index $WINNER_INDEX differs from expected $EXPECTED_WINNER_INDEX"
[ "$WINNING_PRICE" = "$EXPECTED_WINNING_PRICE" ] \
  || fail operator "operator-derived winning price $WINNING_PRICE differs from expected $EXPECTED_WINNING_PRICE"
[ "$WINNER_ADDRESS" = "${BIDDER_ADDRS[$EXPECTED_WINNER_INDEX]}" ] \
  || fail operator "operator-derived winner address mismatch"

log prove "generating witness and groth16 proof with the committed zkey"
bash circuits/scripts/prove.sh "$RUN_DIR/input-a1.json" > "$RUN_DIR/prove.log" 2>&1 \
  || { tail -5 "$RUN_DIR/prove.log" >&2; fail prove "proving failed (see $RUN_DIR/prove.log)"; }
grep -q "OK" "$RUN_DIR/prove.log" || fail prove "local snarkjs verification did not print OK"
log prove "proof generated and verified locally"
node prover/format-args.js --vkey circuits/build/vkey.json --proof circuits/build/proof.json \
  --public circuits/build/public.json --out "$RUN_DIR/settle-args.json" > /dev/null \
  || fail prove "format-args failed"
PROOF_JSON="$(jq -c .proof "$RUN_DIR/settle-args.json")"

# ----------------------------------------------------------------------------
# Settle auction 1 after the deadline
# ----------------------------------------------------------------------------
wait_until_after() {
  local target_epoch="$1" label="$2"
  while [ "$(date +%s)" -le $((target_epoch + 5)) ]; do
    log wait "$label: $((target_epoch + 5 - $(date +%s)))s remaining"
    sleep 15
  done
}
wait_until_after "$COMMIT_DEADLINE" "commit deadline"

stellar contract invoke --id "$AUCTION_CONTRACT" --source "$OPERATOR_ALIAS" --network "$NETWORK" \
  -- settle --auction_id 1 --winner_index "$WINNER_INDEX" --winning_price "$WINNING_PRICE" \
  --winner_address "$WINNER_ADDRESS" --proof "$PROOF_JSON" \
  > /dev/null 2> "$RUN_DIR/settle.log" \
  || { tail -5 "$RUN_DIR/settle.log" >&2; fail settle "settle invocation failed"; }
SETTLE_TX="$(extract_tx_hash "$RUN_DIR/settle.log")"
log settle "auction 1 settled on testnet, tx $SETTLE_TX"

# ----------------------------------------------------------------------------
# Refund auction 2 after its grace period
# ----------------------------------------------------------------------------
wait_until_after $((COMMIT_DEADLINE + AUCTION2_GRACE)) "refund unlock"
stellar contract invoke --id "$AUCTION_CONTRACT" --source "$OPERATOR_ALIAS" --network "$NETWORK" \
  -- refund_all --auction_id 2 > /dev/null 2> "$RUN_DIR/refund.log" \
  || { tail -5 "$RUN_DIR/refund.log" >&2; fail refund "refund_all invocation failed"; }
REFUND_TX="$(extract_tx_hash "$RUN_DIR/refund.log")"
log refund "auction 2 refunded, tx $REFUND_TX"

# ----------------------------------------------------------------------------
# Balance assertions: 8 bidders + seller + auction contract, both tokens
# ----------------------------------------------------------------------------
token_balance() {
  local sac_id="$1" holder="$2"
  stellar contract invoke --id "$sac_id" --source "$OPERATOR_ALIAS" --network "$NETWORK" \
    -- balance --id "$holder" 2> /dev/null | tail -1 | tr -d '"'
}
assert_balance() {
  local sac_id="$1" holder="$2" expected="$3" label="$4"
  local actual
  actual="$(token_balance "$sac_id" "$holder")" || fail assert "$label: balance query failed"
  [ "$actual" = "$expected" ] || fail assert "$label: expected $expected, got $actual"
  log assert "$label = $expected OK"
}

assert_balance "$USDC_SAC" "$AUCTION_CONTRACT" 0 "contract tUSDC"
assert_balance "$BENJI_SAC" "$AUCTION_CONTRACT" 0 "contract tBENJI"
assert_balance "$USDC_SAC" "$SELLER_ADDR" "$EXPECTED_WINNING_PRICE" "seller tUSDC"
assert_balance "$BENJI_SAC" "$SELLER_ADDR" "$LOT_AMOUNT" "seller tBENJI"
for bidder_index in 0 1 2 3 4 5 6 7; do
  if [ "$bidder_index" = "$EXPECTED_WINNER_INDEX" ]; then
    assert_balance "$USDC_SAC" "${BIDDER_ADDRS[$bidder_index]}" \
      $((BIDDER_FUNDING_USDC - EXPECTED_WINNING_PRICE)) "winner (bidder $bidder_index) tUSDC"
    assert_balance "$BENJI_SAC" "${BIDDER_ADDRS[$bidder_index]}" "$LOT_AMOUNT" \
      "winner (bidder $bidder_index) tBENJI"
  else
    assert_balance "$USDC_SAC" "${BIDDER_ADDRS[$bidder_index]}" "$BIDDER_FUNDING_USDC" \
      "loser (bidder $bidder_index) tUSDC"
  fi
done

# ----------------------------------------------------------------------------
# Summary
# ----------------------------------------------------------------------------
log summary "verifier:        $VERIFIER_ID"
log summary "auction:         $AUCTION_CONTRACT"
log summary "tBENJI / tUSDC:  $BENJI_SAC / $USDC_SAC"
log summary "create txs:      $AUCTION1_TX , $AUCTION2_TX"
log summary "settle tx:       $SETTLE_TX"
log summary "refund tx:       $REFUND_TX"
log summary "winner:          slot $WINNER_INDEX at $WINNING_PRICE"
log summary "runtime:         ${SECONDS}s"
log summary "all balance assertions passed; run artifacts in $RUN_DIR"
exit 0
