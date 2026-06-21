// Display formatting helpers: BigInt amounts, addresses, hashes, clocks.
// The demo SAC tokens mint whole abstract base units (scripts/e2e.sh mints
// 1,000,000 tUSDC units per bidder), so amounts render 1:1 with thousands
// grouping and no decimal scaling. sourceRef: docs/MOCKS.md item 1.

import type { AuctionTone } from './chain'

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

// Field-element commitments render as c0a4…9e1d: 32-byte hex, truncated.
export function commitmentToTruncatedHex(commitment: bigint): string {
  return truncateHex(commitment.toString(16).padStart(64, '0'))
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

// Countdown for cards and the room metric: mm:ss below an hour, hh:mm:ss above
// (the redesign shows mm:ss for short windows).
export function formatCountdown(remainingSeconds: number): string {
  const fullClock = formatClock(remainingSeconds)
  return remainingSeconds >= 3600 ? fullClock : fullClock.slice(3)
}

// The one tone-specific metric shown on both the list card and the room
// header, so the two stay in lockstep. The clearing price is the second-price
// settlement value; null when the AuctionSettled event is unavailable.
// sourceRef: design-handoff/hackathon-ui-with-glass-effects metricFor().
export type AuctionMetric = {
  label: string
  value: string
}

export function getAuctionMetric(
  tone: AuctionTone,
  remainingSeconds: number,
  clearingPrice: bigint | null,
): AuctionMetric {
  if (tone === 'open') {
    return { label: 'Closes in', value: formatCountdown(remainingSeconds) }
  }
  if (tone === 'settled') {
    return {
      label: 'Cleared at',
      value: clearingPrice !== null ? formatTokenAmount(clearingPrice) : 'Settled',
    }
  }
  if (tone === 'refunded') {
    return { label: 'Status', value: 'Refunded' }
  }
  return { label: 'Status', value: 'Closed' }
}
