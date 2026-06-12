#!/usr/bin/env bash
# Compiles the auction winner circuit. Commands per plan section 6.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p build
echo "[compile] circom auction_winner.circom"
circom auction_winner.circom --r1cs --wasm --sym -o build -l node_modules
echo "[compile] done"
