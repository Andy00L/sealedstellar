// Place-bid dialog: amount, sealing pipeline, sealed confirmation, distinct
// failure sentences. The amount and salt exist only in this component's
// state and are never rendered after the amount stage, never logged, and
// never sent anywhere except inside the Poseidon commitment and the
// operator-encrypted box.
// sourceRef: design-handoff/stellar/project/ss-flows.jsx PlaceBidDialogDemo.

import { useState } from 'react'
import { Check } from 'lucide-react'

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
import { SealingSteps } from '@/components/auction/SealingSteps'
import { useWallet } from '@/hooks/useWallet'
import { sealBid } from '@/lib/crypto'
import { describeBidFailure, type BidFailure } from '@/lib/errors'
import { commitmentToTruncatedHex, formatTokenAmount } from '@/lib/format'
import { getAuction, type AuctionView } from '@/lib/chain'
import { submitPlaceBid, type WalletSigner } from '@/lib/transactions'
import { walletKit } from '@/lib/wallet-kit'
import { NETWORK_PASSPHRASE } from '@/config'

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

export function PlaceBidDialog({ auction, open, onClose }: PlaceBidDialogProps) {
  const { wallet } = useWallet()
  const [dialogStage, setDialogStage] = useState<DialogStage>({ stage: 'amount' })
  const [amountText, setAmountText] = useState('')

  const depositText = `${formatTokenAmount(auction.maxPrice)} ${auction.paymentSymbol}`
  const sealingIsRunning = dialogStage.stage === 'sealing'

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
    const parsedAmount = parseAmount(amountText)
    if (!parsedAmount.ok) {
      setDialogStage({ stage: 'amount', validationMessage: parsedAmount.message })
      return
    }
    if (parsedAmount.value > auction.maxPrice) {
      setDialogStage({
        stage: 'amount',
        validationMessage: `Above the max price of ${depositText}`,
      })
      return
    }

    // Step 1+2+3: salt, Poseidon commitment, box encryption (all local).
    setDialogStage({ stage: 'sealing', completedSteps: 0 })
    const sealed = await sealBid(parsedAmount.value, auction.id, auction.operatorEncPubkey)
    if (!sealed.ok) {
      setDialogStage({
        stage: 'failed',
        failure: { kind: 'sealing_failed', detail: sealed.error.detail },
      })
      return
    }
    setDialogStage({ stage: 'sealing', completedSteps: 3 })

    // Step 4: one wallet signature; step 5: submit and confirm.
    const signWithFreighter: WalletSigner = async (transactionXdr) => {
      try {
        const signedResponse = await walletKit.signTransaction(transactionXdr, {
          networkPassphrase: NETWORK_PASSPHRASE,
          address: wallet.address,
        })
        setDialogStage({ stage: 'sealing', completedSteps: 4 })
        return { ok: true, value: signedResponse.signedTxXdr }
      } catch {
        return { ok: false, error: 'declined' }
      }
    }
    const submitted = await submitPlaceBid(
      auction.id,
      wallet.address,
      sealed.value.commitment,
      sealed.value.encryptedBid,
      signWithFreighter,
    )
    if (!submitted.ok) {
      setDialogStage({ stage: 'failed', failure: submitted.error })
      return
    }

    // Confirmation shows the slot the bid landed in (1-based, per the grid).
    const refreshed = await getAuction(auction.id)
    const slotIndex = refreshed.ok
      ? refreshed.value.bids.findIndex(
          (placedBid) => placedBid.commitment === sealed.value.commitment,
        )
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
      <DialogContent
        className="max-w-[380px] gap-4 rounded-xl border-border-soft p-6 shadow-pop"
        showCloseButton={!sealingIsRunning}
      >
        {dialogStage.stage === 'amount' && (
          <>
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold tracking-[-0.01em]">
                Place a sealed bid
              </DialogTitle>
              <DialogDescription className="sr-only">
                Enter your bid amount; it is hashed and encrypted before anything leaves this tab.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <span className="text-[13.5px] font-medium">Your bid</span>
              <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3.5 py-1 focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/14">
                <Input
                  type="text"
                  inputMode="numeric"
                  autoFocus
                  value={amountText}
                  onChange={(changeEvent) => setAmountText(changeEvent.target.value)}
                  placeholder="0"
                  className="border-0 p-0 font-mono text-base shadow-none tabular-nums focus-visible:ring-0"
                  aria-label="Bid amount"
                />
                <span className="text-[13px] font-medium text-muted-foreground">
                  {auction.paymentSymbol}
                </span>
              </div>
              <span className="font-mono text-[12.5px] text-muted-foreground tabular-nums">
                max price {depositText}
              </span>
            </div>
            {dialogStage.validationMessage && (
              <BidErrorNotice message={dialogStage.validationMessage} />
            )}
            <div className="flex items-start gap-2.5 rounded-md bg-primary-soft px-3.5 py-3">
              <span className="mt-px text-primary">
                <SealLockIcon size={15} />
              </span>
              <span className="text-[13px] leading-[1.5] text-muted-foreground">
                Your amount is hashed and encrypted; only the operator can open it after close. It
                never appears on chain.
              </span>
            </div>
            <span className="text-[13px] text-muted-foreground">
              You lock a <b className="text-foreground">{depositText} deposit</b>, the same as
              every other bidder
            </span>
            <Button className="w-full" onClick={() => void runSealAndPlace()}>
              Seal and place bid
            </Button>
          </>
        )}

        {dialogStage.stage === 'sealing' && (
          <>
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold tracking-[-0.01em]">
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
              <DialogTitle className="text-lg font-semibold tracking-[-0.01em]">
                Bid sealed
              </DialogTitle>
              <DialogDescription className="sr-only">
                Your sealed bid is on chain.
              </DialogDescription>
            </DialogHeader>
            <div className="grid justify-items-center gap-2.5 py-2">
              <span className="grid size-[54px] animate-land place-items-center rounded-full bg-primary-soft text-primary">
                <Check size={24} strokeWidth={3} aria-hidden="true" />
              </span>
              <span className="text-[17px] font-semibold">
                {dialogStage.slotNumber !== undefined
                  ? `You hold slot ${dialogStage.slotNumber}`
                  : 'Your bid is sealed on chain'}
              </span>
              <span className="font-mono text-[13.5px] tabular-nums">
                {commitmentToTruncatedHex(dialogStage.commitment)}
              </span>
            </div>
            <span className="rounded-md border border-border-soft bg-background px-3.5 py-2.75 text-[13px] leading-[1.5] text-muted-foreground">
              Closing this tab forfeits your local copy of the bid; the operator can still open it
              from chain after close.
            </span>
            <Button variant="outline" className="w-full" onClick={resetAndClose}>
              Back to the room
            </Button>
          </>
        )}

        {dialogStage.stage === 'failed' && (
          <>
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold tracking-[-0.01em]">
                Bid not placed
              </DialogTitle>
              <DialogDescription className="sr-only">
                The bid did not land; the reason is below.
              </DialogDescription>
            </DialogHeader>
            <BidErrorNotice message={describeBidFailure(dialogStage.failure, depositText)} />
            <div className="flex gap-2.5">
              <Button
                className="flex-1"
                onClick={() => setDialogStage({ stage: 'amount' })}
              >
                Try again
              </Button>
              <Button variant="outline" className="flex-1" onClick={resetAndClose}>
                Back to the room
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
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
