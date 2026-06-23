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

// ---------------------------------------------------------------------------
// Settle failure vocabulary: the operator flow, like bidding, gets one
// actionable sentence per failure mode, decoded from the settle error
// variants, never a code.
// sourceRef: contracts/auction/src/lib.rs settle() error returns.
// ---------------------------------------------------------------------------

export type SettleFailure =
  | { kind: 'wallet_declined' }
  | { kind: 'deadline_not_reached' }
  | { kind: 'already_finalized' }
  | { kind: 'winner_index_invalid' }
  | { kind: 'price_not_positive' }
  | { kind: 'price_exceeds_max' }
  | { kind: 'winner_mismatch' }
  | { kind: 'proof_invalid' }
  | { kind: 'verifier_failed' }
  | { kind: 'rpc_unreachable' }
  | { kind: 'submission_failed'; detail: string }

export function describeSettleFailure(failure: SettleFailure): string {
  switch (failure.kind) {
    case 'wallet_declined':
      return 'You declined the signature in your wallet. The auction was not settled.'
    case 'deadline_not_reached':
      return 'Bidding has not closed yet. Settlement opens after the deadline.'
    case 'already_finalized':
      return 'This auction is already settled or refunded.'
    case 'winner_index_invalid':
      return 'The winner slot in the proof bundle is out of range for this auction.'
    case 'price_not_positive':
      return 'The clearing price must be above zero. An auction with fewer than two bids has no second price and can only be refunded.'
    case 'price_exceeds_max':
      return 'The clearing price exceeds the auction max price; this bundle does not match this auction.'
    case 'winner_mismatch':
      return 'The winner address does not match the bid in that slot. Re-check the proof bundle.'
    case 'proof_invalid':
      return 'The proof did not verify on chain for this auction. Re-generate it against this exact auction.'
    case 'verifier_failed':
      return 'The on-chain verifier rejected the proof bytes. Re-export the bundle from the CLI.'
    case 'rpc_unreachable':
      return 'Testnet RPC is not answering. Settlement is safe to retry.'
    case 'submission_failed':
      return `The network rejected the settlement: ${failure.detail}`
  }
}

// Maps a settle contract error code to its failure mode, or null when the
// code is not one settle can return (the caller falls back to a generic
// submission failure).
export function classifySettleContractError(code: number): SettleFailure | null {
  switch (code) {
    case AUCTION_ERROR_CODES.SettleBeforeDeadline:
      return { kind: 'deadline_not_reached' }
    case AUCTION_ERROR_CODES.AlreadySettled:
    case AUCTION_ERROR_CODES.AlreadyRefunded:
      return { kind: 'already_finalized' }
    case AUCTION_ERROR_CODES.WinnerIndexOutOfRange:
      return { kind: 'winner_index_invalid' }
    case AUCTION_ERROR_CODES.WinningPriceNotPositive:
      return { kind: 'price_not_positive' }
    case AUCTION_ERROR_CODES.WinningPriceExceedsMax:
      return { kind: 'price_exceeds_max' }
    case AUCTION_ERROR_CODES.WinnerAddressMismatch:
      return { kind: 'winner_mismatch' }
    case AUCTION_ERROR_CODES.ProofInvalid:
      return { kind: 'proof_invalid' }
    case AUCTION_ERROR_CODES.VerifierCallFailed:
      return { kind: 'verifier_failed' }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Create-auction failure vocabulary: the seller flow gets one actionable
// sentence per failure mode, decoded from the create_auction error variants
// and the lot-escrow token leg, never a code.
// sourceRef: contracts/auction/src/lib.rs create_auction() error returns.
// ---------------------------------------------------------------------------

export type CreateAuctionFailure =
  | { kind: 'wallet_declined' }
  | { kind: 'rpc_unreachable' }
  | { kind: 'lot_uncovered' }
  | { kind: 'lot_not_positive' }
  | { kind: 'price_not_positive' }
  | { kind: 'price_too_large' }
  | { kind: 'deadline_not_future' }
  | { kind: 'grace_zero' }
  | { kind: 'submission_failed'; detail: string }

export function describeCreateAuctionFailure(failure: CreateAuctionFailure): string {
  switch (failure.kind) {
    case 'wallet_declined':
      return 'You declined the signature in your wallet. The auction was not created.'
    case 'rpc_unreachable':
      return 'Testnet RPC is not answering. Creating the auction is safe to retry.'
    case 'lot_uncovered':
      return 'Your wallet cannot cover the lot. It must hold the lot asset and a trustline for it before you can escrow it.'
    case 'lot_not_positive':
      return 'The lot amount must be above zero.'
    case 'price_not_positive':
      return 'The max price must be above zero.'
    case 'price_too_large':
      return 'The max price is too large; it must fit in 64 bits (at most 18446744073709551615).'
    case 'deadline_not_future':
      return 'The bid window must end in the future. Increase the window length.'
    case 'grace_zero':
      return 'The grace period must be above zero.'
    case 'submission_failed':
      return `The network rejected the auction: ${failure.detail}`
  }
}

// Maps a create_auction contract error code to its failure mode, or null when
// the code is not one create_auction returns (the caller falls back to a
// generic submission failure).
export function classifyCreateAuctionContractError(code: number): CreateAuctionFailure | null {
  switch (code) {
    case AUCTION_ERROR_CODES.LotAmountNotPositive:
      return { kind: 'lot_not_positive' }
    case AUCTION_ERROR_CODES.MaxPriceNotPositive:
      return { kind: 'price_not_positive' }
    case AUCTION_ERROR_CODES.MaxPriceExceeds64Bits:
      return { kind: 'price_too_large' }
    case AUCTION_ERROR_CODES.DeadlineNotInFuture:
      return { kind: 'deadline_not_future' }
    case AUCTION_ERROR_CODES.GracePeriodZero:
      return { kind: 'grace_zero' }
    default:
      return null
  }
}

// The lot-escrow leg traps as SAC diagnostic text (not an auction code), the
// same way the bid deposit leg does. sourceRef: DEPOSIT_FAILURE_MARKERS above.
export function isLotTransferFailure(detail: string): boolean {
  const lowercaseDetail = detail.toLowerCase()
  return DEPOSIT_FAILURE_MARKERS.some((marker) => lowercaseDetail.includes(marker))
}
