#!/usr/bin/env bash
# Re-exports build/vkey.json from the final zkey. Subset of setup.sh kept as
# its own entry point per the plan section 3 repo layout.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f build/aw_final.zkey ]; then
  echo "[export-vk] missing build/aw_final.zkey: run scripts/setup.sh first" >&2
  exit 1
fi

snarkjs zkey export verificationkey build/aw_final.zkey build/vkey.json
echo "[export-vk] wrote build/vkey.json"
