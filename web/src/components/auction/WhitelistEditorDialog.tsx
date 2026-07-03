// Whitelist editor for create-auction: the seller sets which wallets are KYC
// approved to win this auction. Addresses come in three ways, all one per line:
// upload a .txt, paste a whole list, or type one at a time. The dialog validates
// each address, dedupes, shows the running list with remove, and confirms the
// set for this auction. The parent computes the Merkle root from it, registers
// the members on chain, and creates the auction against that root.
// sourceRef: web/src/components/auction/TokenPickerDialog.tsx (glass dialog),
// web/src/lib/whitelist-tree.ts (the root this list produces).

import { useState, type ChangeEvent } from 'react'
import { StrKey } from '@stellar/stellar-sdk'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { BidErrorNotice } from '@/components/auction/BidErrorNotice'
import { MAX_WHITELIST_MEMBERS } from '@/lib/whitelist-tree'

type WhitelistEditorDialogProps = {
  open: boolean
  initialMembers: readonly string[]
  onConfirm: (members: string[]) => void
  onClose: () => void
}

const DIALOG_CONTENT_CLASS =
  'glass-panel-strong bg-[#fbfaf7] rounded-[24px] gap-4 p-6 max-w-[480px] shadow-[0_36px_80px_rgba(40,38,52,.38)]'

// Splits pasted or uploaded text into valid Stellar addresses (one per line),
// counting the lines that are not valid so the caller can report them.
function parseAddressLines(rawText: string): { valid: string[]; invalidCount: number } {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const valid: string[] = []
  let invalidCount = 0
  for (const line of lines) {
    if (StrKey.isValidEd25519PublicKey(line)) {
      valid.push(line)
    } else {
      invalidCount += 1
    }
  }
  return { valid, invalidCount }
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-6)}`
}

export function WhitelistEditorDialog({
  open,
  initialMembers,
  onConfirm,
  onClose,
}: WhitelistEditorDialogProps) {
  const [members, setMembers] = useState<string[]>([...initialMembers])
  const [entryText, setEntryText] = useState('')
  const [notice, setNotice] = useState<string | undefined>(undefined)

  const addFromText = (rawText: string) => {
    const parsed = parseAddressLines(rawText)
    if (parsed.valid.length === 0) {
      setNotice(
        parsed.invalidCount > 0
          ? 'None of those lines are valid Stellar addresses (they start with G).'
          : 'Enter at least one address.',
      )
      return
    }
    setMembers((current) => {
      const seen = new Set(current)
      const merged = current.slice()
      for (const address of parsed.valid) {
        if (!seen.has(address)) {
          seen.add(address)
          merged.push(address)
        }
      }
      return merged.slice(0, MAX_WHITELIST_MEMBERS)
    })
    const skipped = parsed.invalidCount > 0 ? ` ${parsed.invalidCount} invalid line(s) skipped.` : ''
    setNotice(`Added ${parsed.valid.length} address(es).${skipped}`)
    setEntryText('')
  }

  const handleUpload = async (changeEvent: ChangeEvent<HTMLInputElement>) => {
    const file = changeEvent.target.files?.[0]
    changeEvent.target.value = '' // allow re-selecting the same file
    if (!file) {
      return
    }
    addFromText(await file.text())
  }

  const removeMember = (address: string) => {
    setMembers((current) => current.filter((existing) => existing !== address))
    setNotice(undefined)
  }

  const confirmAndClose = () => {
    if (members.length === 0) {
      setNotice('Add at least one whitelisted address before confirming.')
      return
    }
    onConfirm(members)
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className={DIALOG_CONTENT_CLASS}>
        <DialogHeader>
          <DialogTitle className="text-[19px] font-semibold tracking-[-0.01em]">
            Whitelist for this auction
          </DialogTitle>
          <DialogDescription className="text-[12.5px] text-muted-foreground">
            Only these wallets are KYC approved to win. Add addresses one per line: upload a .txt,
            paste a list, or type one at a time.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <textarea
            value={entryText}
            onChange={(changeEvent) => setEntryText(changeEvent.target.value)}
            placeholder={'G... one address per line'}
            spellCheck={false}
            className="min-h-[76px] w-full resize-y rounded-[12px] border border-border bg-[#f3f1ec] px-3.5 py-2.5 font-mono text-[12px] shadow-[inset_0_1px_2px_rgba(40,38,52,.06)] outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/14"
          />
          <div className="flex gap-2">
            <Button variant="cta" disabled={entryText.trim() === ''} onClick={() => addFromText(entryText)}>
              Add to list
            </Button>
            <label className="inline-flex cursor-pointer items-center rounded-[11px] border border-border bg-[#f3f1ec] px-4 py-2 text-[13px] font-semibold hover:bg-[#eef1fb]">
              <input type="file" accept=".txt,text/plain" className="hidden" onChange={(changeEvent) => void handleUpload(changeEvent)} />
              Upload .txt
            </label>
          </div>
          {notice !== undefined && (
            <span className="text-[11.5px] leading-[1.5] text-muted-foreground">{notice}</span>
          )}
        </div>

        <div className="grid gap-2 border-t border-border pt-4">
          <span className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
            Whitelisted ({members.length})
          </span>
          {members.length === 0 ? (
            <BidErrorNotice message="No addresses yet. Add at least one." />
          ) : (
            <div className="grid max-h-[220px] gap-1.5 overflow-y-auto pr-0.5">
              {members.map((address) => (
                <div
                  key={address}
                  className="flex items-center justify-between gap-3 rounded-[11px] border border-border bg-[#f3f1ec] px-3 py-2"
                >
                  <span className="font-mono text-[12px]" title={address}>
                    {shortAddress(address)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeMember(address)}
                    aria-label={`Remove ${address}`}
                    className="text-[12px] font-medium text-destructive transition hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <Button variant="glass" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="cta" className="flex-1" disabled={members.length === 0} onClick={confirmAndClose}>
            Confirm whitelist ({members.length})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
