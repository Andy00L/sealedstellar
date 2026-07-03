// Client for the server-side auto-settler (web/api/settle.ts). When a bid
// window has closed and the auction is not yet settled, the front end asks the
// backend to decrypt the sealed bids, generate the Groth16 proof, and submit
// the settle, so a closed auction settles on view without a human operator.
// The two operator secrets stay server-side (env vars, never in the bundle);
// nothing sensitive is sent or logged here. Errors travel as a discriminated
// result, never a throw. sourceRef: web/api/settle.ts, web/src/lib/faucet.ts.

const AUTO_SETTLE_ENDPOINT = '/api/settle'

export type AutoSettleResult =
  | { kind: 'settled' }
  | { kind: 'already_settled' }
  | { kind: 'pending'; detail: string }
  | { kind: 'failed'; detail: string }

type SettleResponseBody = {
  ok?: boolean
  alreadySettled?: boolean
  error?: { kind?: string; message?: string }
}

export async function requestAutoSettle(
  auctionId: number,
  signal?: AbortSignal,
): Promise<AutoSettleResult> {
  let response: Response
  try {
    response = await fetch(AUTO_SETTLE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auctionId }),
      signal,
    })
  } catch (networkError) {
    return {
      kind: 'failed',
      detail: networkError instanceof Error ? networkError.message : String(networkError),
    }
  }

  const rawText = await response.text()
  let payload: SettleResponseBody
  try {
    payload = JSON.parse(rawText) as SettleResponseBody
  } catch {
    return { kind: 'failed', detail: `auto-settle returned a non-JSON response (${response.status})` }
  }

  if (response.ok && payload.ok === true) {
    return payload.alreadySettled === true ? { kind: 'already_settled' } : { kind: 'settled' }
  }

  const detail = payload.error?.message ?? `auto-settle failed (${response.status})`
  // 409 (window not closed / not yet settleable) and 429 (another settle in
  // flight) are transient: the room keeps polling and will reveal when it lands.
  if (response.status === 409 || response.status === 429) {
    return { kind: 'pending', detail }
  }
  return { kind: 'failed', detail }
}
