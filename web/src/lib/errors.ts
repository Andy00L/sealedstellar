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
