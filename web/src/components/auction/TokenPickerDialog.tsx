// Token picker for create-auction: a glass dialog listing the tokens the wallet
// already holds (with balances), plus a field to paste any token by contract id
// or CODE:ISSUER. Picking one hands it back to the form, which adds it to the
// asset selectors. This component is presentational: the parent loads the wallet
// assets in the click handler that opens the dialog and passes them in as state,
// so no data-fetching effect lives here.
// sourceRef: web/src/components/auction/PlaceBidDialog.tsx (glass dialog surface),
// web/src/lib/wallet-assets.ts (WalletAsset, resolveCustomToken).

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
import {
  describeWalletAssetsError,
  resolveCustomToken,
  type WalletAsset,
} from '@/lib/wallet-assets'

export type TokenPickerState =
  | { phase: 'loading' }
  | { phase: 'ready'; assets: WalletAsset[] }
  | { phase: 'error'; message: string }

type TokenPickerDialogProps = {
  open: boolean
  state: TokenPickerState
  existingContractIds: readonly string[]
  onRetry: () => void
  onPick: (token: WalletAsset) => void
  onClose: () => void
}

// Glass dialog surface: strong frosted panel, no opaque fill so the glass shows
// through. sourceRef: PlaceBidDialog DIALOG_CONTENT_CLASS.
const DIALOG_CONTENT_CLASS =
  'glass-panel-strong bg-[#fbfaf7] rounded-[24px] gap-4 p-6 max-w-[460px] shadow-[0_36px_80px_rgba(40,38,52,.38)]'

function shortContractId(contractId: string): string {
  return `${contractId.slice(0, 6)}…${contractId.slice(-4)}`
}

export function TokenPickerDialog({
  open,
  state,
  existingContractIds,
  onRetry,
  onPick,
  onClose,
}: TokenPickerDialogProps) {
  const [manualInput, setManualInput] = useState('')
  const [manualError, setManualError] = useState<string | undefined>(undefined)

  const addedContractIds = new Set(existingContractIds)

  const handleManualAdd = () => {
    const resolved = resolveCustomToken(manualInput)
    if (!resolved.ok) {
      setManualError(describeWalletAssetsError(resolved.error))
      return
    }
    setManualError(undefined)
    setManualInput('')
    onPick(resolved.value)
  }

  const closeAndReset = () => {
    setManualInput('')
    setManualError(undefined)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && closeAndReset()}>
      <DialogContent className={DIALOG_CONTENT_CLASS}>
        <DialogHeader>
          <DialogTitle className="text-[19px] font-semibold tracking-[-0.01em]">
            Add a token
          </DialogTitle>
          <DialogDescription className="text-[12.5px] text-muted-foreground">
            Pick a token your wallet holds, or paste any token by contract id.
          </DialogDescription>
        </DialogHeader>

        {state.phase === 'loading' && (
          <span className="rounded-[13px] border border-border bg-[#f3f1ec] px-3.5 py-3 text-[12.5px] text-muted-foreground">
            Reading your wallet balances…
          </span>
        )}

        {state.phase === 'error' && (
          <div className="grid gap-2.5">
            <BidErrorNotice message={state.message} />
            <Button variant="glass" onClick={onRetry}>
              Try again
            </Button>
          </div>
        )}

        {state.phase === 'ready' && (
          <div className="grid max-h-[280px] gap-2 overflow-y-auto pr-0.5">
            {state.assets.length === 0 ? (
              <span className="rounded-[13px] border border-border bg-[#f3f1ec] px-3.5 py-3 text-[12.5px] text-muted-foreground">
                No issued tokens in this wallet. Paste one below to auction it.
              </span>
            ) : (
              state.assets.map((asset) => {
                const isAdded = addedContractIds.has(asset.contractId)
                return (
                  <button
                    key={asset.contractId}
                    type="button"
                    onClick={() => onPick(asset)}
                    disabled={isAdded}
                    className="flex items-center justify-between gap-3 rounded-[13px] border border-border bg-[#f3f1ec] px-3.5 py-2.75 text-left transition hover:border-primary/50 hover:bg-primary-soft disabled:cursor-default disabled:opacity-60"
                  >
                    <span className="flex flex-col">
                      <span className="font-mono text-[14px] font-medium">{asset.symbol}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {shortContractId(asset.contractId)}
                      </span>
                    </span>
                    <span className="text-right">
                      {asset.balanceDisplay !== '' && (
                        <span className="block font-mono text-[13px] tabular-nums">
                          {asset.balanceDisplay}
                        </span>
                      )}
                      {isAdded && (
                        <span className="block text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                          added
                        </span>
                      )}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        )}

        <div className="grid gap-2 border-t border-border pt-4">
          <span className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
            Paste a token
          </span>
          <div className="flex gap-2">
            <Input
              type="text"
              value={manualInput}
              onChange={(changeEvent) => setManualInput(changeEvent.target.value)}
              placeholder="C... or CODE:ISSUER"
              aria-label="Token contract id or code and issuer"
              className="rounded-[12px] border-border bg-[#f3f1ec] font-mono text-[12.5px] shadow-[inset_0_1px_2px_rgba(40,38,52,.06)]"
            />
            <Button variant="cta" onClick={handleManualAdd} disabled={manualInput.trim() === ''}>
              Add
            </Button>
          </div>
          {manualError !== undefined && <BidErrorNotice message={manualError} />}
          <span className="text-[11.5px] leading-[1.5] text-muted-foreground">
            The token needs its Soroban contract deployed on testnet before it can be auctioned.
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
