// Place-bid dialog: amount, the real sealing pipeline, sealed confirmation,
// and distinct failure sentences, on the glass surface. The amount and salt
// exist only in this component's state, are never rendered after the amount
// stage, never logged, and never sent anywhere except inside the Poseidon
// commitment and the operator-encrypted box.
// sourceRef: design-handoff/hackathon-ui-with-glass-effects/project/
// SealedStellar.dc.html bid dialog.

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { BidErrorNotice } from '@/components/auction/BidErrorNotice'
import { SealLockIcon } from '@/components/auction/SealLockIcon'
import { SealMedallion } from '@/components/auction/SealMedallion'
import { SealingSteps } from '@/components/auction/SealingSteps'
import { useWallet } from '@/hooks/useWallet'
import { sealBid } from '@/lib/crypto'
import { describeBidFailure, type BidFailure } from '@/lib/errors'
import { commitmentToTruncatedHex, formatTokenAmount } from '@/lib/format'
import { getAuction, type AuctionView } from '@/lib/chain'
import { submitPlaceBid, type WalletSigner } from '@/lib/transactions'
import { walletKit } from '@/lib/wallet-kit'
import { NETWORK_PASSPHRASE } from '@/config'
import { DEMO_WHITELIST_MEMBERS, DEMO_WHITELIST_ROOT_DECIMAL } from '@/lib/demo-whitelist'

type DialogStage =
  | { stage: 'amount'; validationMessage?: string }
  | { stage: 'sealing'; completedSteps: number }
  | { stage: 'sealed'; slotNumber: number | undefined; commitment: bigint; txHash: string }
  | { stage: 'failed'; failure: BidFailure }

type PlaceBidDialogProps = {
  auction: AuctionView
  open: boolean
  onClose: () => void
}

// Glass dialog surface: the strong frosted panel, the pop shadow, no opaque
// background (bg-transparent removes DialogContent's default fill so the
// glass shows through).
const DIALOG_CONTENT_CLASS =
  'glass-panel-strong bg-transparent rounded-[24px] gap-4 p-6 max-w-[440px] shadow-[0_30px_70px_rgba(40,38,52,.28)]'

export function PlaceBidDialog({ auction, open, onClose }: PlaceBidDialogProps) {
  const { wallet } = useWallet()
  const [dialogStage, setDialogStage] = useState<DialogStage>({ stage: 'amount' })
  const [amountText, setAmountText] = useState('')

  const depositText = `${formatTokenAmount(auction.maxPrice)} ${auction.paymentSymbol}`
  const sealingIsRunning = dialogStage.stage === 'sealing'
  // Warn a connected bidder whose wallet is not on this auction's KYC whitelist:
  // it can bid, but a winning bid from it cannot be settled (refund only). Only
  // the demo whitelist members are known app-side, so scope the check to that root.
  const usesDemoWhitelist = auction.whitelistRoot === BigInt(DEMO_WHITELIST_ROOT_DECIMAL)
  const showWhitelistWarning =
    usesDemoWhitelist && wallet.status === 'connected' && !DEMO_WHITELIST_MEMBERS.includes(wallet.address)

  const resetAndClose = () => {
    if (sealingIsRunning) {
      return
    }
    setDialogStage({ stage: 'amount' })
    setAmountText('')
    onClose()
  }

  const runSealAndPlace = async () => {
    if (wallet.status !== 'connected') {
      return
    }
    const bidderAddress = wallet.address
    const parsedAmount = parseAmount(amountText)
    if (!parsedAmount.ok) {
      setDialogStage({ stage: 'amount', validationMessage: parsedAmount.message })
      return
    }
    if (parsedAmount.value > auction.maxPrice) {
      setDialogStage({ stage: 'amount', validationMessage: `Above the max price of ${depositText}` })
      return
    }

    // Step 1+2+3: salt, Poseidon commitment, box encryption (all local).
    setDialogStage({ stage: 'sealing', completedSteps: 0 })
    const sealed = await sealBid(parsedAmount.value, auction.id, auction.operatorEncPubkey)
    if (!sealed.ok) {
      setDialogStage({ stage: 'failed', failure: { kind: 'sealing_failed', detail: sealed.error.detail } })
      return
    }
    setDialogStage({ stage: 'sealing', completedSteps: 3 })

    // Step 4: one wallet signature; step 5: submit and confirm.
    const signWithFreighter: WalletSigner = async (transactionXdr) => {
      try {
        const signedResponse = await walletKit.signTransaction(transactionXdr, {
          networkPassphrase: NETWORK_PASSPHRASE,
          address: bidderAddress,
        })
        return { ok: true, value: signedResponse.signedTxXdr }
      } catch {
        return { ok: false, error: 'declined' }
      }
    }
    const submitted = await submitPlaceBid(
      auction.id,
      bidderAddress,
      sealed.value.commitment,
      sealed.value.encryptedBid,
      signWithFreighter,
      () => setDialogStage({ stage: 'sealing', completedSteps: 4 }),
    )
    if (!submitted.ok) {
      setDialogStage({ stage: 'failed', failure: submitted.error })
      return
    }

    // Confirmation shows the slot the bid landed in (1-based, per the grid).
    const refreshed = await getAuction(auction.id)
    const slotIndex = refreshed.ok
      ? refreshed.value.bids.findIndex((placedBid) => placedBid.commitment === sealed.value.commitment)
      : -1
    setDialogStage({
      stage: 'sealed',
      slotNumber: slotIndex >= 0 ? slotIndex + 1 : undefined,
      commitment: sealed.value.commitment,
      txHash: submitted.value.txHash,
    })
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && resetAndClose()}>
      <DialogContent className={DIALOG_CONTENT_CLASS} showCloseButton={!sealingIsRunning}>
        {dialogStage.stage === 'amount' && (
          <>
            <DialogHeader>
              <DialogTitle className="text-[19px] font-semibold tracking-[-0.01em]">
                Place a sealed bid
              </DialogTitle>
              <DialogDescription className="text-[12.5px] text-muted-foreground">
                {formatTokenAmount(auction.lotAmount)} {auction.lotSymbol} · pay{' '}
                {auction.paymentSymbol}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <span className="text-[10.5px] uppercase tracking-[0.14em] text-ink-faint">
                Your bid ({auction.paymentSymbol})
              </span>
              <div className="flex items-center gap-2 rounded-[14px] border border-border bg-white/65 px-4 shadow-[inset_0_1px_3px_rgba(40,38,52,.08)] focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/14">
                <Input
                  type="text"
                  inputMode="numeric"
                  autoFocus
                  value={amountText}
                  onChange={(changeEvent) => setAmountText(changeEvent.target.value)}
                  placeholder="0"
                  className="h-auto border-0 bg-transparent p-0 py-3.5 font-mono text-[26px] font-medium shadow-none tabular-nums focus-visible:ring-0"
                  aria-label="Bid amount"
                />
                <span className="font-mono text-sm text-ink-faint">{auction.paymentSymbol}</span>
              </div>
            </div>
            {dialogStage.validationMessage && (
              <BidErrorNotice message={dialogStage.validationMessage} />
            )}
            <div className="flex gap-2.5">
              <InfoTile label="Max price" value={formatTokenAmount(auction.maxPrice)} />
              <InfoTile label="Deposit" value={depositText} />
            </div>
            <div className="flex items-start gap-2.5 rounded-[13px] border border-primary/18 bg-[linear-gradient(160deg,rgba(43,95,217,.08),rgba(43,95,217,.04))] px-3.5 py-3">
              <span className="mt-px text-primary">
                <SealLockIcon size={15} />
              </span>
              <span className="text-[12.5px] leading-[1.5] text-muted-foreground">
                You escrow the <b className="text-foreground">max price ({depositText})</b> as a
                uniform deposit. Your real bid is smaller and stays sealed; the deposit leaks
                nothing.
              </span>
            </div>
            {showWhitelistWarning && (
              <div className="rounded-[13px] border border-destructive/25 bg-destructive/[0.06] px-3.5 py-3 text-[12.5px] leading-[1.5] text-foreground">
                <b className="text-destructive">This wallet is not whitelisted.</b> It can seal a
                bid, but it is not KYC-approved to win. If this turns out to be the top bid, the
                auction cannot be settled and only refunds after the grace period. Bid from a
                whitelisted wallet to win.
              </div>
            )}
            <div className="flex gap-3">
              <Button variant="glass" onClick={resetAndClose}>
                Cancel
              </Button>
              <Button variant="cta" className="flex-1" onClick={() => void runSealAndPlace()}>
                Seal bid
              </Button>
            </div>
          </>
        )}

        {dialogStage.stage === 'sealing' && (
          <>
            <DialogHeader>
              <DialogTitle className="text-[19px] font-semibold tracking-[-0.01em]">
                Sealing your bid
              </DialogTitle>
              <DialogDescription className="sr-only">
                The sealing pipeline is running; each step completes in order.
              </DialogDescription>
            </DialogHeader>
            <SealingSteps completedSteps={dialogStage.completedSteps} />
            <span className="text-[12.5px] text-ink-faint">
              Your salt and amount live only in this tab
            </span>
          </>
        )}

        {dialogStage.stage === 'sealed' && (
          <>
            <DialogHeader>
              <DialogTitle className="text-[19px] font-semibold tracking-[-0.01em]">
                Your bid is sealed
              </DialogTitle>
              <DialogDescription className="sr-only">Your sealed bid is on chain.</DialogDescription>
            </DialogHeader>
            <div className="grid justify-items-center gap-2.5 py-2 text-center">
              <SealMedallion size={58} className="animate-land" />
              <span className="text-[17px] font-semibold">
                {dialogStage.slotNumber !== undefined
                  ? `You hold slot ${dialogStage.slotNumber} of 8`
                  : 'Your bid is sealed on chain'}
              </span>
              <span className="font-mono text-[13.5px] tabular-nums text-muted-foreground">
                {commitmentToTruncatedHex(dialogStage.commitment)}
              </span>
            </div>
            <span className="rounded-[13px] border border-border-soft bg-white/45 px-3.5 py-2.75 text-[12.5px] leading-[1.5] text-muted-foreground">
              No one can read its value, not even the seller. The operator can still open it from
              chain after close.
            </span>
            <Button variant="cta" onClick={resetAndClose}>
              Done
            </Button>
          </>
        )}

        {dialogStage.stage === 'failed' && (
          <>
            <DialogHeader>
              <DialogTitle className="text-[19px] font-semibold tracking-[-0.01em]">
                Bid not sent
              </DialogTitle>
              <DialogDescription className="sr-only">
                The bid did not land; the reason is below.
              </DialogDescription>
            </DialogHeader>
            <BidErrorNotice message={describeBidFailure(dialogStage.failure, depositText)} />
            <div className="flex gap-3">
              <Button variant="glass" onClick={resetAndClose}>
                Close
              </Button>
              <Button variant="cta" className="flex-1" onClick={() => setDialogStage({ stage: 'amount' })}>
                Try again
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 rounded-xl border border-foreground/6 bg-white/45 px-3.5 py-3">
      <div className="text-[10px] uppercase tracking-[0.1em] text-ink-faint">{label}</div>
      <div className="mt-0.75 font-mono text-[14px]">{value}</div>
    </div>
  )
}

type ParsedAmount = { ok: true; value: bigint } | { ok: false; message: string }

function parseAmount(amountText: string): ParsedAmount {
  const trimmedText = amountText.trim().replaceAll(',', '')
  if (!/^\d+$/.test(trimmedText)) {
    return { ok: false, message: 'Enter a whole number of token units' }
  }
  const parsedValue = BigInt(trimmedText)
  if (parsedValue <= 0n) {
    return { ok: false, message: 'Your bid must be above zero' }
  }
  return { ok: true, value: parsedValue }
}
