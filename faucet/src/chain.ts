// The faucet's only chain action: mint a SAC's asset to a destination by invoking
// the stellar CLI, which holds the token-issuer key in its keystore and signs
// from it. This process never sees the issuer secret. The destination is
// validated upstream and passed as a separate argv (execFile, never a shell
// string), so it cannot inject. Errors travel as values; a missing destination
// trustline maps to a distinct error so the API can tell the caller to add it.
// sourceRef: scripts/stage-demo-auction.sh mint_to (the identical CLI mint).

import { execFile, type ExecFileException } from 'node:child_process'

import { ISSUER_ALIAS, NETWORK, STELLAR_BIN } from './config'
import type { FaucetError, Result } from './result'

// A testnet invoke (simulate + sign + submit) is a few seconds; allow slack.
const MINT_TIMEOUT_MS = 90_000
const STDOUT_MAX_BYTES = 8 * 1024 * 1024
// The CLI logs "Signing transaction: <64 hex>" to stderr on submit.
// sourceRef: scripts/stage-demo-auction.sh extract_tx_hash.
const TX_HASH_PATTERN = /Signing transaction:\s*([0-9a-f]{64})/i

type StellarRun =
  | { ok: true; stderr: string }
  | { ok: false; reason: 'missing_cli' | 'timeout' | 'nonzero'; stderr: string }

function runStellar(args: string[]): Promise<StellarRun> {
  return new Promise((resolve) => {
    execFile(
      STELLAR_BIN,
      args,
      { encoding: 'utf8', timeout: MINT_TIMEOUT_MS, maxBuffer: STDOUT_MAX_BYTES },
      (error: ExecFileException | null, _stdout: string, stderr: string) => {
        if (error === null) {
          resolve({ ok: true, stderr })
          return
        }
        if (error.message.includes('ENOENT')) {
          resolve({ ok: false, reason: 'missing_cli', stderr })
          return
        }
        if (error.killed === true || error.signal === 'SIGTERM') {
          resolve({ ok: false, reason: 'timeout', stderr })
          return
        }
        resolve({ ok: false, reason: 'nonzero', stderr })
      },
    )
  })
}

function firstMeaningfulLine(text: string): string {
  const line = text
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry !== '')
  return line ?? 'mint failed'
}

export async function mintToken(
  contractId: string,
  toAddress: string,
  amountBaseUnits: bigint,
): Promise<Result<{ txHash: string }, FaucetError>> {
  const args = [
    'contract',
    'invoke',
    '--id',
    contractId,
    '--source',
    ISSUER_ALIAS,
    '--network',
    NETWORK,
    '--',
    'mint',
    '--to',
    toAddress,
    '--amount',
    amountBaseUnits.toString(),
  ]
  const run = await runStellar(args)
  if (run.ok) {
    const txHash = TX_HASH_PATTERN.exec(run.stderr)?.[1] ?? ''
    return { ok: true, value: { txHash } }
  }
  if (run.reason === 'missing_cli') {
    return {
      ok: false,
      error: {
        kind: 'mint_failed',
        detail: `the "${STELLAR_BIN}" CLI is not on PATH; the faucet needs it to mint`,
      },
    }
  }
  if (run.reason === 'timeout') {
    return { ok: false, error: { kind: 'chain_unreachable', detail: 'the mint timed out talking to testnet' } }
  }
  if (run.stderr.toLowerCase().includes('trustline')) {
    return { ok: false, error: { kind: 'no_trustline', detail: 'destination has no trustline for the asset' } }
  }
  return { ok: false, error: { kind: 'mint_failed', detail: firstMeaningfulLine(run.stderr) } }
}
