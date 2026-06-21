// Operator settlement flow. Per the chosen architecture (real settle from a
// CLI-generated proof), the heavy zero-knowledge work runs in the prover CLI,
// which keeps the operator's decryption key and the 5.6MB proving key off the
// browser. The operator pastes the proof bundle here; the UI validates it and
// performs the real, Freighter-signed, on-chain settle. The contract cannot
// pay out without a valid proof, so secrecy and trustlessness hold together.
// sourceRef: design-handoff/hackathon-ui-with-glass-effects/project/
// SealedStellar.dc.html operator stepper.

import { useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useWallet } from '@/hooks/useWallet'
import { walletKit } from '@/lib/wallet-kit'
import { NETWORK_PASSPHRASE } from '@/config'
import {
  parseSettleBundle,
  submitSettle,
  type SettleBundle,
  type WalletSigner,
} from '@/lib/transactions'
import { describeSettleFailure, type SettleFailure } from '@/lib/errors'
import { formatTokenAmount, truncateAddress } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { AuctionView } from '@/lib/chain'

export type SettleResult = {
  winnerIndex: number
  winningPrice: bigint
  winnerAddress: string
  txHash: string
}

type OperatorStepperProps = {
  auction: AuctionView
  filledSlots: number
  onSettled: (result: SettleResult) => void
}

type NodeState = 'pending' | 'active' | 'done' | 'error'

// The exact CLI pipeline that produces the bundle, shown so the operator can
// reproduce it. sourceRef: prover/ scripts + scripts/e2e.sh operator phase.
const CLI_PIPELINE =
  'operator-decrypt.js → build-input.js → format-args.js → build-settle-bundle.js'

export function OperatorStepper({ auction, filledSlots, onSettled }: OperatorStepperProps) {
  const { wallet, connectWallet } = useWallet()
  const [bundleText, setBundleText] = useState('')
  const [loadedBundle, setLoadedBundle] = useState<SettleBundle | null>(null)
  const [bundleError, setBundleError] = useState<string | null>(null)
  const [settlePhase, setSettlePhase] = useState<'idle' | 'settling' | 'failed'>('idle')
  const [settleError, setSettleError] = useState<SettleFailure | null>(null)

  const loadBundle = () => {
    const parsed = parseSettleBundle(bundleText, auction.id)
    if (!parsed.ok) {
      setLoadedBundle(null)
      setBundleError(parsed.error)
      return
    }
    setBundleError(null)
    setLoadedBundle(parsed.value)
  }

  const runSettle = async () => {
    if (!loadedBundle) {
      return
    }
    if (wallet.status !== 'connected') {
      await connectWallet()
      return
    }
    const settlerAddress = wallet.address
    setSettlePhase('settling')
    setSettleError(null)

    const signWithFreighter: WalletSigner = async (transactionXdr) => {
      try {
        const signedResponse = await walletKit.signTransaction(transactionXdr, {
          networkPassphrase: NETWORK_PASSPHRASE,
          address: settlerAddress,
        })
        return { ok: true, value: signedResponse.signedTxXdr }
      } catch {
        return { ok: false, error: 'declined' }
      }
    }

    const result = await submitSettle(loadedBundle, settlerAddress, signWithFreighter)
    if (!result.ok) {
      setSettlePhase('failed')
      setSettleError(result.error)
      return
    }
    onSettled({
      winnerIndex: loadedBundle.winnerIndex,
      winningPrice: loadedBundle.winningPrice,
      winnerAddress: loadedBundle.winnerAddress,
      txHash: result.value.txHash,
    })
  }

  const isSettling = settlePhase === 'settling'
  const proveState: NodeState = loadedBundle ? 'done' : bundleText.trim() ? 'active' : 'pending'
  const settleNodeState: NodeState =
    settlePhase === 'failed' ? 'error' : loadedBundle ? 'active' : 'pending'

  return (
    <div className="glass-panel rounded-[22px] p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <span className="text-[17px] font-semibold">Run settlement</span>
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint">
          Operator · {truncateAddress(auction.seller)}
        </span>
      </div>

      <StepRow state="done" title="Decrypt bids and build the proof (CLI)">
        <p className="text-[12.5px] text-muted-foreground">
          {filledSlots} sealed bids. Run the prover pipeline, which keeps the decryption key and
          proving key off the browser:
        </p>
        <code className="mt-2 block rounded-lg bg-foreground/5 px-3 py-2 font-mono text-[11.5px] text-foreground/80">
          {CLI_PIPELINE}
        </code>
      </StepRow>

      <StepRow state={proveState} title="Load the proof bundle">
        <p className="text-[12.5px] text-muted-foreground">
          Paste the JSON from build-settle-bundle.js. The contract rebuilds the public inputs from
          storage and verifies the proof; no bid amount is ever revealed.
        </p>
        <textarea
          value={bundleText}
          onChange={(changeEvent) => setBundleText(changeEvent.target.value)}
          placeholder="Paste the settle bundle JSON…"
          spellCheck={false}
          className="mt-3 min-h-[78px] w-full resize-y rounded-xl border border-border bg-white/60 px-3.5 py-3 font-mono text-[12px] shadow-[inset_0_1px_3px_rgba(40,38,52,.08)] outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/14"
        />
        {bundleError && (
          <p className="mt-2 flex items-start gap-2 text-[12.5px] text-destructive">
            <span className="mt-1.25 size-1.5 flex-none rounded-full bg-destructive" />
            {bundleError}
          </p>
        )}
        {loadedBundle && (
          <p className="mt-2 text-[12.5px] text-muted-foreground">
            Loaded: winner slot {loadedBundle.winnerIndex + 1}, clearing price{' '}
            <span className="font-mono text-foreground">
              {formatTokenAmount(loadedBundle.winningPrice)} {auction.paymentSymbol}
            </span>
            .
          </p>
        )}
        <div className="mt-3">
          <Button variant="glass" size="sm" disabled={!bundleText.trim()} onClick={loadBundle}>
            {loadedBundle ? 'Re-check bundle' : 'Load bundle'}
          </Button>
        </div>
      </StepRow>

      <StepRow state={settleNodeState} title="Settle on chain" isLast>
        <p className="text-[12.5px] text-muted-foreground">
          {isSettling
            ? 'Confirming settlement on chain…'
            : 'One signature settles the auction. The contract verifies the proof and moves tokens atomically.'}
        </p>
        {settleError && (
          <p className="mt-2 flex items-start gap-2 text-[12.5px] text-destructive">
            <span className="mt-1.25 size-1.5 flex-none rounded-full bg-destructive" />
            {describeSettleFailure(settleError)}
          </p>
        )}
        <div className="mt-3">
          <Button
            variant="cta"
            disabled={!loadedBundle || isSettling}
            onClick={() => void runSettle()}
          >
            {isSettling
              ? 'Settling…'
              : wallet.status === 'connected'
                ? 'Confirm settlement in your wallet'
                : 'Connect wallet to settle'}
          </Button>
        </div>
      </StepRow>
    </div>
  )
}

function StepRow({
  state,
  title,
  isLast = false,
  children,
}: {
  state: NodeState
  title: string
  isLast?: boolean
  children: ReactNode
}) {
  return (
    <div className={cn('flex gap-4', state === 'pending' && 'opacity-55')}>
      <div className="flex flex-col items-center">
        <StepNode state={state} />
        {!isLast && (
          <div className="my-1 w-0.5 flex-1 bg-[linear-gradient(rgba(43,95,217,.5),rgba(43,95,217,.12))]" />
        )}
      </div>
      <div className={cn('flex-1', !isLast && 'pb-5')}>
        <div className="text-[15px] font-semibold">{title}</div>
        <div className="mt-1">{children}</div>
      </div>
    </div>
  )
}

function StepNode({ state }: { state: NodeState }) {
  if (state === 'done') {
    return (
      <span className="grid size-7 flex-none place-items-center rounded-full bg-[linear-gradient(180deg,#3f72e8,#2b5fd9)] text-white shadow-[0_4px_12px_rgba(43,95,217,.3)]">
        <Check size={14} strokeWidth={3} aria-hidden="true" />
      </span>
    )
  }
  if (state === 'active') {
    return (
      <span className="grid size-7 flex-none place-items-center rounded-full border-[1.6px] border-primary bg-primary/12 shadow-[0_0_0_4px_rgba(43,95,217,.12)]">
        <span className="size-2 rounded-full bg-primary" />
      </span>
    )
  }
  if (state === 'error') {
    return (
      <span className="grid size-7 flex-none place-items-center rounded-full border-[1.6px] border-destructive bg-destructive/12 text-[13px] font-bold text-destructive">
        !
      </span>
    )
  }
  return (
    <span className="grid size-7 flex-none place-items-center rounded-full border-[1.6px] border-foreground/14 bg-foreground/5">
      <span className="size-2 rounded-full bg-foreground/25" />
    </span>
  )
}
