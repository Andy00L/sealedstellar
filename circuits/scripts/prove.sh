#!/usr/bin/env bash
# Witness generation, proof, and local verification. Commands per plan
# section 6. Optional first argument: input file (default build/input.json).
set -euo pipefail
cd "$(dirname "$0")/.."

INPUT_FILE="${1:-build/input.json}"
if [ ! -f "$INPUT_FILE" ]; then
  echo "[prove] missing input file $INPUT_FILE" >&2
  exit 1
fi

echo "[prove] generate witness"
node build/auction_winner_js/generate_witness.js \
  build/auction_winner_js/auction_winner.wasm "$INPUT_FILE" build/witness.wtns

echo "[prove] groth16 prove"
snarkjs groth16 prove build/aw_final.zkey build/witness.wtns \
  build/proof.json build/public.json

echo "[prove] groth16 verify (local)"
snarkjs groth16 verify build/vkey.json build/public.json build/proof.json
echo "[prove] done"
