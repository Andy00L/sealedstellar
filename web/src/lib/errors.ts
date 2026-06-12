// Result type and contract error decoding. Errors travel as values
// (no throw in business logic); every failure mode keeps its own shape so
// the UI can render a distinct sentence for each one.

export type Result<ValueType, ErrorType> =
  | { ok: true; value: ValueType }
  | { ok: false; error: ErrorType }

export type ChainError =
  | { kind: 'rpc_unreachable'; detail: string }
  | { kind: 'simulation_failed'; detail: string }
  | { kind: 'contract_error'; code: number }
  | { kind: 'decode_failed'; detail: string }

// Contract error codes, one to one with the on-chain enum.
// sourceRef: contracts/auction/src/lib.rs AuctionError.
export const AUCTION_ERROR_CODES = {
  AuctionNotFound: 1,
  LotAmountNotPositive: 2,
  MaxPriceNotPositive: 3,
  MaxPriceExceeds64Bits: 4,
  DeadlineNotInFuture: 5,
  GracePeriodZero: 6,
  AlreadySettled: 7,
  AlreadyRefunded: 8,
  BidAfterDeadline: 9,
  BidsFull: 10,
  DuplicateCommitment: 11,
  CommitmentIsEmptyMarker: 12,
  EncryptedBidTooLarge: 13,
  SettleBeforeDeadline: 14,
  WinnerIndexOutOfRange: 15,
  WinningPriceNotPositive: 16,
  WinningPriceExceedsMax: 17,
  WinnerAddressMismatch: 18,
  ProofInvalid: 19,
  VerifierCallFailed: 20,
  RefundTooEarly: 21,
  ReclaimRequiresRefundedAuction: 22,
  LotAlreadyReclaimed: 23,
  LotTransferFailed: 24,
} as const

// The CLI and RPC surface contract failures as "Error(Contract, #N)" inside
// the simulation error text; this pulls the code out.
const CONTRACT_ERROR_PATTERN = /Error\(Contract, #(\d+)\)/

export function parseContractErrorCode(simulationErrorText: string): number | undefined {
  const matched = CONTRACT_ERROR_PATTERN.exec(simulationErrorText)
  if (!matched) {
    return undefined
  }
  return Number(matched[1])
}

export function isAuctionNotFound(error: ChainError): boolean {
  return error.kind === 'contract_error' && error.code === AUCTION_ERROR_CODES.AuctionNotFound
}

// ---------------------------------------------------------------------------
// Bid failure vocabulary: every failure mode gets its own sentence, decoded
// from contract error variants, never a code.
// sourceRef: design-handoff/stellar/project/ss-flows.jsx bidErrors.
// ---------------------------------------------------------------------------

export type BidFailure =
  | { kind: 'wallet_declined' }
  | { kind: 'deadline_passed' }
  | { kind: 'slots_full' }
  | { kind: 'duplicate_commitment' }
  | { kind: 'deposit_uncovered' }
  | { kind: 'rpc_unreachable' }
  | { kind: 'sealing_failed'; detail: string }
  | { kind: 'submission_failed'; detail: string }

export function describeBidFailure(failure: BidFailure, depositText: string): string {
  switch (failure.kind) {
    case 'wallet_declined':
      return 'You declined the signature in your wallet. Nothing was sent.'
    case 'deadline_passed':
      return 'Bidding closed while you were sealing. Your deposit was not taken.'
    case 'slots_full':
      return 'All 8 slots filled before your bid landed.'
    case 'duplicate_commitment':
      return 'This exact commitment already exists. Re-open the dialog to reseal with a fresh salt.'
    case 'deposit_uncovered':
      return `Your balance can’t cover the ${depositText} deposit.`
    case 'rpc_unreachable':
      return 'Testnet RPC isn’t answering. Your bid is safe to retry.'
    case 'sealing_failed':
      return `Sealing failed before anything left this tab: ${failure.detail}`
    case 'submission_failed':
      return `The network rejected the transaction: ${failure.detail}`
  }
}

// Token contract failures surface as diagnostics text rather than auction
// error codes; these markers identify the deposit-transfer leg.
// sourceRef: SAC diagnostic strings observed in the density-pass settle
// failure ("trustline entry is missing") and SEP-41 balance errors.
const DEPOSIT_FAILURE_MARKERS = ['trustline entry is missing', 'balance is not sufficient', 'resulting balance is not within the allowed range']

export function classifyPlaceBidChainError(error: ChainError): BidFailure {
  if (error.kind === 'rpc_unreachable') {
    return { kind: 'rpc_unreachable' }
  }
  if (error.kind === 'contract_error') {
    if (error.code === AUCTION_ERROR_CODES.BidAfterDeadline) {
      return { kind: 'deadline_passed' }
    }
    if (error.code === AUCTION_ERROR_CODES.BidsFull) {
      return { kind: 'slots_full' }
    }
    if (error.code === AUCTION_ERROR_CODES.DuplicateCommitment) {
      return { kind: 'duplicate_commitment' }
    }
  }
  if (error.kind === 'simulation_failed') {
    const lowercaseDetail = error.detail.toLowerCase()
    if (DEPOSIT_FAILURE_MARKERS.some((marker) => lowercaseDetail.includes(marker))) {
      return { kind: 'deposit_uncovered' }
    }
  }
  const detail =
    error.kind === 'contract_error' ? `contract error ${error.code}` : error.detail
  return { kind: 'submission_failed', detail }
}
