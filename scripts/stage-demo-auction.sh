#!/usr/bin/env bash
# Stage one fresh "live demo" auction on the STANDING Vickrey instance for the
# hackathon screen recording. Run this immediately before you hit record: it
# creates a fresh auction with a short bid window, seeds three competition bids
# below the planned winning bid, tops up every actor so the run is safe to
# repeat for retakes, and prints the exact bid the Freighter demo wallet should
# place to win.
#
# Why this is separate from scripts/e2e.sh: e2e.sh is a hermetic reproduction
# that deploys its OWN fresh verifier, tokens, and auction contract and then
# asserts balances; it never touches the standing instances by design. The demo
# instead has to seed the STANDING contract that the web app (web/src/config.ts)
# and the Freighter demo wallet already point at, using the persisted operator
# key and whitelist in secrets/. Reusing e2e.sh would either redeploy (breaking
# the frontend wiring) or require gutting its assertions, so a focused script is
# the correct unit.
#
# Run from the Windows host shell:
#   WSL_UTF8=1 MSYS2_ARG_CONV_EXCL='*' wsl -d Ubuntu --cd /home/drew/stelar10 \
#     --exec bash -lc 'bash scripts/stage-demo-auction.sh [WINDOW_SECONDS]'
#
# WINDOW_SECONDS (optional, default 300): the bid window length. Use a smaller
# value (for example 180) for a tight single continuous take, or a larger value
# for a take you plan to cut. Testnet only.
set -Eeuo pipefail

log() { echo "[stage:$1] $2" >&2; }
fail() { log "$1" "FAIL: $2"; exit 1; }
report_abort() { echo "[stage:fatal] aborted at line ${BASH_LINENO[0]}: $BASH_COMMAND" >&2; }
trap report_abort ERR

# --- Standing instances (sourceRef: web/src/config.ts, docs/MOCKS.md) --------
NETWORK="testnet"
AUCTION_CONTRACT="CB5MMHVHPKG65D2DYO7HVGBDCMQIDEYP2O7DK5EYPYJUDZQXHWAJJDJ4"
BENJI_SAC="CDUTXMK5MGOXSBUPZNQZ6J5RCQEVC4MOMYW72WXVUWV5W7OCXJIGJUGN"
USDC_SAC="CDIKPNCUSBHSTGD5GZKKHPK6BVE732BUCKQ3EPLYMSLUSHEZPAFTNPVX"

# --- Local identities (stellar keys ls) --------------------------------------
ISSUER_ALIAS="token-issuer"
SELLER_ALIAS="drew-dev"
DEN_ALIASES=("den-bidder-1781249681-0" "den-bidder-1781249681-1" "den-bidder-1781249681-2")

# --- Freighter demo wallet (whitelist index 4, sourceRef secrets/whitelist-demo.json)
DREW_ADDR="GDIVCF6NSGSOXSFOU7H4DUDLOYMERGDKZWMPNVQM6VFNVR26B67FJQBH"

# --- Auction shape (matches docs/DECISIONS.md auction 6 staging) -------------
LOT_AMOUNT=50000                 # tBENJI lot, base units
MAX_PRICE=50000                  # tUSDC deposit pulled per bid, base units
DEN_PRICES=(18000 27000 31000)   # all strictly below the planned winning bid
WINNING_HINT=40000               # what the Freighter wallet should bid to win
CLEARING_PRICE=31000             # Vickrey second price = the top den bid
GRACE_SECONDS=86400              # long; the demo never needs the refund path
WINDOW_SECONDS="${1:-300}"       # bid window in seconds (default 5 minutes)

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

for required_tool in stellar node jq date; do
  command -v "$required_tool" > /dev/null 2>&1 || fail setup "missing tool: $required_tool"
done
[ -f secrets/operator-box-key.json ] || fail setup "missing secrets/operator-box-key.json"
[ -f secrets/whitelist-demo.json ]  || fail setup "missing secrets/whitelist-demo.json"
[ -f secrets/operator-session.json ] || fail setup "missing secrets/operator-session.json (the in-browser unseal session)"

OPERATOR_BOX_PUB="$(jq -r .publicKeyHex secrets/operator-box-key.json)"
WHITELIST_ROOT="$(jq -r .rootDecimal secrets/whitelist-demo.json)"
[ -n "$OPERATOR_BOX_PUB" ] && [ "$OPERATOR_BOX_PUB" != "null" ] || fail setup "operator pubkey unreadable"
[ -n "$WHITELIST_ROOT" ]  && [ "$WHITELIST_ROOT" != "null" ]  || fail setup "whitelist root unreadable"

SELLER_ADDR="$(stellar keys address "$SELLER_ALIAS")" || fail setup "seller alias $SELLER_ALIAS not found"

RUN_DIR="$(mktemp -d /tmp/sealedstellar-stage.XXXXXX)"; chmod 700 "$RUN_DIR"
log setup "auction $AUCTION_CONTRACT, operator pub ${OPERATOR_BOX_PUB:0:12}..., whitelist root frozen"

extract_tx_hash() { { grep -oE 'Signing transaction: [0-9a-f]{64}' "$1" || true; } | tail -1 | cut -d' ' -f3; }

mint_to() {
  local sac_id="$1" recipient="$2" amount="$3"
  stellar contract invoke --id "$sac_id" --source "$ISSUER_ALIAS" --network "$NETWORK" \
    -- mint --to "$recipient" --amount "$amount" > /dev/null 2> /dev/null \
    || fail mint "mint $amount to $recipient failed (does $recipient trust the asset?)"
}

# Each run escrows exactly one lot (seller) and one deposit per bidder, so top
# up that much every time. This keeps retakes from draining any account.
log fund "topping up one lot and one deposit per actor (retake-safe)"
mint_to "$BENJI_SAC" "$SELLER_ADDR" "$LOT_AMOUNT"
for den_alias in "${DEN_ALIASES[@]}"; do
  mint_to "$USDC_SAC" "$(stellar keys address "$den_alias")" "$MAX_PRICE"
done
mint_to "$USDC_SAC" "$DREW_ADDR" "$MAX_PRICE"

NOW_EPOCH="$(date +%s)"
COMMIT_DEADLINE=$((NOW_EPOCH + WINDOW_SECONDS))
log create "creating demo auction, window ${WINDOW_SECONDS}s (deadline epoch $COMMIT_DEADLINE)"

AUCTION_ID="$(stellar contract invoke --id "$AUCTION_CONTRACT" --source "$SELLER_ALIAS" --network "$NETWORK" \
  -- create_auction --seller "$SELLER_ADDR" --rwa_token "$BENJI_SAC" \
  --lot_amount "$LOT_AMOUNT" --payment_token "$USDC_SAC" --max_price "$MAX_PRICE" \
  --commit_deadline "$COMMIT_DEADLINE" --grace_period "$GRACE_SECONDS" \
  --whitelist_root "$WHITELIST_ROOT" --operator_enc_pubkey "$OPERATOR_BOX_PUB" \
  2> "$RUN_DIR/create.log" | tail -1)" \
  || { tail -5 "$RUN_DIR/create.log" >&2; fail create "create_auction failed"; }
[ -n "$AUCTION_ID" ] || fail create "create_auction produced no auction id"
log create "auction id $AUCTION_ID (tx $(extract_tx_hash "$RUN_DIR/create.log"))"

place_den_bid() {
  local slot="$1" price="$2"
  local den_alias="${DEN_ALIASES[$slot]}"
  local den_addr; den_addr="$(stellar keys address "$den_alias")"
  node prover/make-bid.js --price "$price" --auction-id "$AUCTION_ID" \
    --operator-pub "$OPERATOR_BOX_PUB" --out "$RUN_DIR/den-$slot.json" > /dev/null \
    || fail bids "make-bid failed for den slot $slot"
  stellar contract invoke --id "$AUCTION_CONTRACT" --source "$den_alias" --network "$NETWORK" \
    -- place_bid --auction_id "$AUCTION_ID" --bidder "$den_addr" \
    --commitment "$(jq -r .commitmentDecimal "$RUN_DIR/den-$slot.json")" \
    --encrypted_bid "$(jq -r .encryptedBidHex "$RUN_DIR/den-$slot.json")" \
    > /dev/null 2> "$RUN_DIR/den-$slot.log" \
    || { tail -5 "$RUN_DIR/den-$slot.log" >&2; fail bids "place_bid failed for den slot $slot"; }
  log bids "den slot $slot sealed at $price (tx $(extract_tx_hash "$RUN_DIR/den-$slot.log"))"
}

for slot in 0 1 2; do place_den_bid "$slot" "${DEN_PRICES[$slot]}"; done

echo "$AUCTION_ID" > secrets/demo-auction-id.txt
CLOSE_HUMAN="$(date -d "@$COMMIT_DEADLINE" '+%Y-%m-%d %H:%M:%S %Z' 2>/dev/null || echo "epoch $COMMIT_DEADLINE")"

cat <<EOF

================= DEMO AUCTION READY (auction $AUCTION_ID) =================
  Standing contract : $AUCTION_CONTRACT
  Bid window closes : $CLOSE_HUMAN  (epoch $COMMIT_DEADLINE, ~${WINDOW_SECONDS}s)
  Competition bids  : den slots 0,1,2 at ${DEN_PRICES[*]} (all sealed on chain)

  ON CAMERA, with your Freighter wallet:
    $DREW_ADDR
    1. Open the app, connect Freighter, open auction $AUCTION_ID.
    2. Place a sealed bid of $WINNING_HINT tUSDC (any value $((CLEARING_PRICE + 1))..$MAX_PRICE wins).
    3. Watch the countdown reach zero (the window closes).
    4. Open the operator panel, load secrets/operator-session.json, generate the
       in-browser proof, and settle.
    5. You win and pay the Vickrey clearing price $CLEARING_PRICE; your own bid
       value is never revealed on chain.

  Retake? Re-run this script for a brand new auction (everything is topped up
  again automatically). Auction id is also saved to secrets/demo-auction-id.txt.
===========================================================================
EOF
