#!/usr/bin/env bash
# Groth16 setup with one development contribution. Commands per plan
# section 6. A single-contribution ceremony is trusted-setup weak by design
# at hackathon scale; documented in docs/MOCKS.md.
set -euo pipefail
cd "$(dirname "$0")/.."

PTAU_FILE=build/pot14.ptau
if [ ! -f "$PTAU_FILE" ]; then
  echo "[setup] missing $PTAU_FILE: download per plan section 4.6" >&2
  exit 1
fi

# Guard (decision 2026-06-12, docs/DECISIONS.md): the committed zkey matches
# the verifier instance deployed on testnet. Regenerating it silently would
# break every on-chain verification until a new instance is deployed.
if [ -f build/aw_final.zkey ] && [ "${SEALEDSTELLAR_FORCE_SETUP:-0}" != "1" ]; then
  echo "[setup] build/aw_final.zkey exists; a regenerated zkey cannot verify" >&2
  echo "[setup] against the deployed verifier. Re-run with" >&2
  echo "[setup] SEALEDSTELLAR_FORCE_SETUP=1 only if you plan to redeploy." >&2
  exit 1
fi

echo "[setup] groth16 setup"
snarkjs groth16 setup build/auction_winner.r1cs "$PTAU_FILE" build/aw_0000.zkey

echo "[setup] zkey contribute"
snarkjs zkey contribute build/aw_0000.zkey build/aw_final.zkey \
  --name="drew" -e="$(head -c 64 /dev/urandom | xxd -p -c 256)"

echo "[setup] export verification key"
snarkjs zkey export verificationkey build/aw_final.zkey build/vkey.json
echo "[setup] done"
