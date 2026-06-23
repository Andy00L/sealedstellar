// Create-auction screen: a seller fills the lot, payment, max price, and bid
// window, signs once, and the contract escrows the lot and opens the auction.
// Created auctions default to the demo operator key and KYC whitelist so they
// are settleable and accept bids from whitelisted accounts. The single wallet
// signature also authorizes the lot escrow (see lib/transactions create path).

import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'

import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  GlassSegmentedControl,
  type SegmentedOption,
} from '@/components/auction/GlassSegmentedControl'
import { BidErrorNotice } from '@/components/auction/BidErrorNotice'
import { useWallet } from '@/hooks/useWallet'
import { walletKit } from '@/lib/wallet-kit'
import {
  submitCreateAuction,
  type CreateAuctionParams,
  type WalletSigner,
} from '@/lib/transactions'
import { describeCreateAuctionFailure, type CreateAuctionFailure } from '@/lib/errors'
import { truncateHex } from '@/lib/format'
import {
  DEMO_OPERATOR_ENC_PUBKEY_HEX,
  DEMO_WHITELIST_ROOT_DECIMAL,
  KNOWN_TOKENS,
  NETWORK_PASSPHRASE,
  STELLAR_EXPERT_TX_BASE,
} from '@/config'

// u64 ceiling the contract enforces on the max price (MaxPriceExceeds64Bits).
// Unit: token base units. sourceRef: contracts/auction/src/lib.rs.
const MAX_U64 = 18446744073709551615n
const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3600

const TOKEN_OPTIONS: readonly SegmentedOption<string>[] = KNOWN_TOKENS.map((token) => ({
  value: token.contractId,
  label: token.symbol,
}))

type CreateStage =
  | { stage: 'form'; validationMessage?: string }
  | { stage: 'submitting' }
  | { stage: 'created'; txHash: string }
  | { stage: 'failed'; failure: CreateAuctionFailure }

function symbolForContractId(contractId: string): string {
  return KNOWN_TOKENS.find((token) => token.contractId === contractId)?.symbol ?? 'token'
}

function hexToBytes32(hexText: string): Uint8Array {
  const bytes = new Uint8Array(32)
  for (let byteIndex = 0; byteIndex < 32; byteIndex += 1) {
    bytes[byteIndex] = Number.parseInt(hexText.slice(byteIndex * 2, byteIndex * 2 + 2), 16)
  }
  return bytes
}

type ParsedBig = { ok: true; value: bigint } | { ok: false; message: string }

function parsePositiveBig(amountText: string, label: string): ParsedBig {
  const trimmed = amountText.trim().replaceAll(',', '')
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, message: `${label} must be a whole number of token units.` }
  }
  const value = BigInt(trimmed)
  if (value <= 0n) {
    return { ok: false, message: `${label} must be above zero.` }
  }
  return { ok: true, value }
}

type ParsedInt = { ok: true; value: number } | { ok: false; message: string }

function parsePositiveInt(text: string, label: string): ParsedInt {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, message: `${label} must be a whole number.` }
  }
  const value = Number(trimmed)
  if (value <= 0) {
    return { ok: false, message: `${label} must be above zero.` }
  }
  return { ok: true, value }
}

export function CreateAuctionRoute() {
  const { wallet, connectWallet } = useWallet()
  const [createStage, setCreateStage] = useState<CreateStage>({ stage: 'form' })
  const [lotTokenId, setLotTokenId] = useState(KNOWN_TOKENS[0].contractId)
  const [lotAmountText, setLotAmountText] = useState('50000')
  const [paymentTokenId, setPaymentTokenId] = useState(KNOWN_TOKENS[1].contractId)
  const [maxPriceText, setMaxPriceText] = useState('50000')
  const [windowMinutesText, setWindowMinutesText] = useState('30')
  const [graceHoursText, setGraceHoursText] = useState('24')

  const runCreate = async () => {
    if (wallet.status !== 'connected') {
      return
    }
    const lotAmount = parsePositiveBig(lotAmountText, 'Lot amount')
    if (!lotAmount.ok) {
      setCreateStage({ stage: 'form', validationMessage: lotAmount.message })
      return
    }
    const maxPrice = parsePositiveBig(maxPriceText, 'Max price')
    if (!maxPrice.ok) {
      setCreateStage({ stage: 'form', validationMessage: maxPrice.message })
      return
    }
    if (maxPrice.value > MAX_U64) {
      setCreateStage({ stage: 'form', validationMessage: 'Max price must fit in 64 bits.' })
      return
    }
    const windowMinutes = parsePositiveInt(windowMinutesText, 'Bid window')
    if (!windowMinutes.ok) {
      setCreateStage({ stage: 'form', validationMessage: windowMinutes.message })
      return
    }
    const graceHours = parsePositiveInt(graceHoursText, 'Grace period')
    if (!graceHours.ok) {
      setCreateStage({ stage: 'form', validationMessage: graceHours.message })
      return
    }
    if (lotTokenId === paymentTokenId) {
      setCreateStage({
        stage: 'form',
        validationMessage: 'The lot asset and the payment asset must be different.',
      })
      return
    }

    const nowSeconds = Math.floor(Date.now() / 1000)
    const params: CreateAuctionParams = {
      sellerAddress: wallet.address,
      rwaToken: lotTokenId,
      lotAmount: lotAmount.value,
      paymentToken: paymentTokenId,
      maxPrice: maxPrice.value,
      commitDeadline: BigInt(nowSeconds + windowMinutes.value * SECONDS_PER_MINUTE),
      gracePeriod: BigInt(graceHours.value * SECONDS_PER_HOUR),
      whitelistRoot: BigInt(DEMO_WHITELIST_ROOT_DECIMAL),
      operatorEncPubkey: hexToBytes32(DEMO_OPERATOR_ENC_PUBKEY_HEX),
    }

    setCreateStage({ stage: 'submitting' })
    const signWithFreighter: WalletSigner = async (transactionXdr) => {
      try {
        const signedResponse = await walletKit.signTransaction(transactionXdr, {
          networkPassphrase: NETWORK_PASSPHRASE,
          address: wallet.address,
        })
        return { ok: true, value: signedResponse.signedTxXdr }
      } catch {
        return { ok: false, error: 'declined' }
      }
    }
    const submitted = await submitCreateAuction(params, signWithFreighter)
    if (!submitted.ok) {
      setCreateStage({ stage: 'failed', failure: submitted.error })
      return
    }
    setCreateStage({ stage: 'created', txHash: submitted.value.txHash })
  }

  return (
    <AppShell crumb="Testnet" title="Create auction" backTo="/">
      <div className="mx-auto w-full max-w-[560px] px-5 pb-16 pt-2 sm:px-8">
        {wallet.status !== 'connected' ? (
          <div className="glass-soft grid justify-items-center gap-3.5 rounded-[22px] px-8 py-14 text-center">
            <span className="text-[17px] font-semibold">Connect your wallet to create an auction</span>
            <span className="max-w-[320px] text-sm leading-[1.55] text-muted-foreground">
              The seller signs once to open the auction and escrow the lot. Your wallet must hold
              the lot asset and a trustline for it.
            </span>
            <Button variant="cta" onClick={() => void connectWallet()}>
              Connect Freighter
            </Button>
          </div>
        ) : createStage.stage === 'created' ? (
          <div className="glass-panel grid justify-items-center gap-3 rounded-[22px] px-8 py-12 text-center">
            <span className="text-[19px] font-semibold">Auction created</span>
            <span className="max-w-[340px] text-sm leading-[1.55] text-muted-foreground">
              The lot is escrowed and the auction is open for bids. It appears in the list within a
              few seconds.
            </span>
            <a
              href={`${STELLAR_EXPERT_TX_BASE}${createStage.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[12.5px] text-primary hover:underline"
            >
              {truncateHex(createStage.txHash)}
            </a>
            <div className="mt-2 flex gap-3">
              <Button variant="cta" asChild>
                <Link to="/">View auctions</Link>
              </Button>
              <Button variant="glass" onClick={() => setCreateStage({ stage: 'form' })}>
                Create another
              </Button>
            </div>
          </div>
        ) : (
          <div className="glass-panel grid gap-5 rounded-[22px] p-6">
            <FormField label="Lot asset">
              <GlassSegmentedControl
                ariaLabel="Lot asset"
                options={TOKEN_OPTIONS}
                value={lotTokenId}
                onChange={setLotTokenId}
              />
            </FormField>
            <FormField label={`Lot amount (${symbolForContractId(lotTokenId)})`}>
              <Input
                type="text"
                inputMode="numeric"
                value={lotAmountText}
                onChange={(changeEvent) => setLotAmountText(changeEvent.target.value)}
                placeholder="50000"
                aria-label="Lot amount"
                className="rounded-[12px] border-border bg-white/65 font-mono"
              />
            </FormField>
            <FormField label="Payment asset">
              <GlassSegmentedControl
                ariaLabel="Payment asset"
                options={TOKEN_OPTIONS}
                value={paymentTokenId}
                onChange={setPaymentTokenId}
              />
            </FormField>
            <FormField label={`Max price (${symbolForContractId(paymentTokenId)})`}>
              <Input
                type="text"
                inputMode="numeric"
                value={maxPriceText}
                onChange={(changeEvent) => setMaxPriceText(changeEvent.target.value)}
                placeholder="50000"
                aria-label="Max price"
                className="rounded-[12px] border-border bg-white/65 font-mono"
              />
            </FormField>
            <div className="flex gap-4">
              <FormField label="Bid window (minutes)">
                <Input
                  type="text"
                  inputMode="numeric"
                  value={windowMinutesText}
                  onChange={(changeEvent) => setWindowMinutesText(changeEvent.target.value)}
                  placeholder="30"
                  aria-label="Bid window in minutes"
                  className="rounded-[12px] border-border bg-white/65 font-mono"
                />
              </FormField>
              <FormField label="Grace period (hours)">
                <Input
                  type="text"
                  inputMode="numeric"
                  value={graceHoursText}
                  onChange={(changeEvent) => setGraceHoursText(changeEvent.target.value)}
                  placeholder="24"
                  aria-label="Grace period in hours"
                  className="rounded-[12px] border-border bg-white/65 font-mono"
                />
              </FormField>
            </div>

            <span className="rounded-[13px] border border-border-soft bg-white/45 px-3.5 py-2.75 text-[12px] leading-[1.5] text-muted-foreground">
              New auctions use the demo operator key and KYC whitelist, so the demo operator can
              settle them and only whitelisted accounts can win. The max price is escrowed by each
              bidder as a uniform deposit.
            </span>

            {createStage.stage === 'form' && createStage.validationMessage && (
              <BidErrorNotice message={createStage.validationMessage} />
            )}
            {createStage.stage === 'failed' && (
              <BidErrorNotice message={describeCreateAuctionFailure(createStage.failure)} />
            )}

            <div className="flex gap-3">
              <Button variant="glass" asChild>
                <Link to="/">Cancel</Link>
              </Button>
              <Button
                variant="cta"
                className="flex-1"
                disabled={createStage.stage === 'submitting'}
                onClick={() => void runCreate()}
              >
                {createStage.stage === 'submitting' ? 'Creating…' : 'Create auction'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[10.5px] uppercase tracking-[0.14em] text-ink-faint">{label}</span>
      {children}
    </label>
  )
}
