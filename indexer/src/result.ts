// Errors as values: every fallible operation returns a Result and callers
// branch on it; nothing in the business logic throws. The only exceptions are
// boot invariants (config) and the database open, which must fail loudly.
// sourceRef: web/src/lib/errors.ts (the web app uses the same discipline).

export type Result<ValueType, ErrorType> =
  | { ok: true; value: ValueType }
  | { ok: false; error: ErrorType }

// Chain read failures, one shape per mode so the caller can react distinctly
// (a contract trap ends the backfill probe; an rpc outage is retried).
export type ChainError =
  | { kind: 'rpc_unreachable'; detail: string }
  | { kind: 'simulation_failed'; detail: string }
  | { kind: 'contract_error'; code: number }
  | { kind: 'decode_failed'; detail: string }

// API-layer failures, mapped to distinct HTTP statuses in api.ts.
export type IndexerError =
  | { kind: 'bad_request'; detail: string }
  | { kind: 'not_found'; detail: string }
  | { kind: 'rate_limited'; detail: string }
