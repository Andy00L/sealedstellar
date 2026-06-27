// Errors as values: every fallible faucet operation returns a Result; nothing in
// the business logic throws. Boot invariants (config) are the only loud failures.
// sourceRef: indexer/src/result.ts (the same discipline).

export type Result<ValueType, ErrorType> =
  | { ok: true; value: ValueType }
  | { ok: false; error: ErrorType }

// Faucet failure modes, each mapped to a distinct HTTP status in api.ts so the
// caller can react: bad input and a missing trustline are the client's to fix
// (400), a flood is throttled (429), a chain or mint problem is the service's
// (502).
export type FaucetError =
  | { kind: 'bad_request'; detail: string }
  | { kind: 'rate_limited'; detail: string }
  | { kind: 'no_trustline'; detail: string }
  | { kind: 'mint_failed'; detail: string }
  | { kind: 'chain_unreachable'; detail: string }
