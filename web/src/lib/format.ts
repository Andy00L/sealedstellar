// Display formatting helpers: BigInt amounts, addresses, hashes, clocks.
// The demo SAC tokens mint whole abstract base units (scripts/e2e.sh mints
// 1,000,000 tUSDC units per bidder), so amounts render 1:1 with thousands
// grouping and no decimal scaling. sourceRef: docs/MOCKS.md item 1.

const AMOUNT_FORMATTER = new Intl.NumberFormat('en-US')

export function formatTokenAmount(rawAmount: bigint): string {
  return AMOUNT_FORMATTER.format(rawAmount)
}

// GBX4…R7TQ style: first four, ellipsis, last four (hi-fi address recipe,
// sourceRef: design-handoff/stellar/project/ss-ui.jsx ssAddrs).
export function truncateAddress(address: string): string {
  if (address.length <= 10) {
    return address
  }
  return `${address.slice(0, 4)}…${address.slice(-4)}`
}

// c0a4…9e1d style for 64-char hex hashes and field elements.
export function truncateHex(hexText: string): string {
  if (hexText.length <= 10) {
    return hexText
  }
  return `${hexText.slice(0, 4)}…${hexText.slice(-4)}`
}

// hh:mm:ss with zero padding; clamps below zero
// (sourceRef: design-handoff/stellar/project/ss-ui.jsx ssFmtClock).
export function formatClock(totalSeconds: number): string {
  const clampedSeconds = Math.max(0, Math.floor(totalSeconds))
  const hours = String(Math.floor(clampedSeconds / 3600)).padStart(2, '0')
  const minutes = String(Math.floor((clampedSeconds % 3600) / 60)).padStart(2, '0')
  const seconds = String(clampedSeconds % 60).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}
