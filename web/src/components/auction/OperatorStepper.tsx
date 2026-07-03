// Operator settlement flow, one button. "Reveal the winner" asks /api/reveal to
// decrypt the sealed bids server-side (the operator box secret stays on the
// server, no session file to load), then the browser rebuilds the whitelist
// path and runs the Groth16 prover with snarkjs, and the operator signs the real
// settle in their wallet. The contract cannot pay out without a valid proof, so
// secrecy and trustlessness hold. A CLI-generated proof can still be pasted if
// browser proving stalls.
// sourceRef: web/src/lib/reveal.ts, web/src/lib/operator.ts, web/api/reveal.ts.

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
import { proveSettleFromRevealedBids, type OperatorPhase } from '@/lib/operator'
import { requestReveal } from '@/lib/reveal'
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

// Phase -> progress percent and label for the reveal + in-browser prover.
const PHASE_PERCENT: Record<OperatorPhase, number> = {
  fetching: 15,
  decrypting: 40,
  building: 60,
  proving: 85,
  done: 100,
}
const PHASE_LABEL: Record<OperatorPhase, string> = {
  fetching: 'Revealing the sealed bids…',
  decrypting: 'Checking the revealed bids…',
  building: 'Building the circuit input…',
  proving: 'Generating the Groth16 proof…',
  done: 'Proof ready',
}

export function OperatorStepper({ auction, filledSlots, onSettled }: OperatorStepperProps) {
  const { wallet, connectWallet } = useWallet()
  const [provePhase, setProvePhase] = useState<OperatorPhase | null>(null)
  const [provePercent, setProvePercent] = useState(0)
  const [proveError, setProveError] = useState<string | null>(null)
  const [alreadySettled, setAlreadySettled] = useState(false)
  const [bundle, setBundle] = useState<SettleBundle | null>(null)
  const [showPaste, setShowPaste] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [settlePhase, setSettlePhase] = useState<'idle' | 'settling' | 'failed'>('idle')
  const [settleError, setSettleError] = useState<SettleFailure | null>(null)

  const isRevealing = provePhase !== null && bundle === null

  const runReveal = async () => {
    setProveError(null)
    setAlreadySettled(false)
    setBundle(null)
    setProvePhase('fetching')
    setProvePercent(PHASE_PERCENT.fetching)

    const revealed = await requestReveal(auction.id)
    if (!revealed.ok) {
      setProveError(revealed.error)
      setProvePhase(null)
      setProvePercent(0)
      return
    }
    if (revealed.value.kind === 'already_settled') {
      // Someone settled it first; the room's polling reveals the result shortly.
      setAlreadySettled(true)
      setProvePhase(null)
      setProvePercent(0)
      return
    }

    setProvePhase('decrypting')
    setProvePercent(PHASE_PERCENT.decrypting)
    const result = await proveSettleFromRevealedBids(
      auction,
      revealed.value.bids,
      revealed.value.members,
      (phase) => {
        setProvePhase(phase)
        setProvePercent(PHASE_PERCENT[phase])
      },
    )
    if (!result.ok) {
      setProveError(result.error)
      setProvePhase(null)
      setProvePercent(0)
      return
    }
    setBundle(result.value)
    setProvePercent(100)
  }

  const loadPastedBundle = () => {
    const parsed = parseSettleBundle(pasteText, auction.id)
    if (!parsed.ok) {
      setPasteError(parsed.error)
      return
    }
    setPasteError(null)
    setBundle(parsed.value)
  }

  const runSettle = async () => {
    if (!bundle) {
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

    const result = await submitSettle(bundle, settlerAddress, signWithFreighter)
    if (!result.ok) {
      setSettlePhase('failed')
      setSettleError(result.error)
      return
    }
    onSettled({
      winnerIndex: bundle.winnerIndex,
      winningPrice: bundle.winningPrice,
      winnerAddress: bundle.winnerAddress,
      txHash: result.value.txHash,
    })
  }

  const isSettling = settlePhase === 'settling'
  const revealState: NodeState = proveError ? 'error' : bundle ? 'done' : 'active'
  const settleState: NodeState = settlePhase === 'failed' ? 'error' : bundle ? 'active' : 'pending'

  return (
    <div className="glass-panel rounded-[22px] p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <span className="text-[17px] font-semibold">Run settlement</span>
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint">
          Operator · {truncateAddress(auction.seller)}
        </span>
      </div>

      <StepRow state={revealState} title="Reveal the winner">
        <p className="text-[12.5px] text-muted-foreground">
          Decrypts the {filledSlots} sealed bids on the server, then builds the Groth16 proof in
          your browser. No file to load.
        </p>

        {provePhase && (
          <div className="mt-3.5">
            <div className="h-[9px] overflow-hidden rounded-full bg-foreground/7 shadow-[inset_0_1px_2px_rgba(40,38,52,.1)]">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,rgba(43,95,217,.55),#2b5fd9_50%,rgba(43,95,217,.55))] bg-[length:200%_100%] shadow-[0_0_10px_rgba(43,95,217,.5)] transition-[width] duration-300 animate-shimmer"
                style={{ width: `${provePercent}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between">
              <span className="font-mono text-[11.5px] text-muted-foreground">
                {PHASE_LABEL[provePhase]}
              </span>
              <span className="font-mono text-[11.5px] text-primary">{Math.round(provePercent)}%</span>
            </div>
          </div>
        )}

        {bundle && (
          <p className="mt-2.5 text-[12.5px] text-muted-foreground">
            Winner slot {bundle.winnerIndex + 1}, clearing price{' '}
            <span className="font-mono text-foreground">
              {formatTokenAmount(bundle.winningPrice)} {auction.paymentSymbol}
            </span>
            .
          </p>
        )}
        {proveError && <FieldError message={proveError} />}
        {alreadySettled && (
          <p className="mt-2 text-[12.5px] text-muted-foreground">
            This auction is already settled. The result will appear in a moment.
          </p>
        )}

        {!bundle && (
          <div className="mt-3">
            <Button variant="cta" disabled={isRevealing} onClick={() => void runReveal()}>
              {isRevealing ? 'Revealing…' : 'Reveal the winner'}
            </Button>
          </div>
        )}

        <div className="mt-3 text-[11.5px] text-muted-foreground">
          Stalled?{' '}
          <button
            type="button"
            onClick={() => setShowPaste((previous) => !previous)}
            className="cursor-pointer text-primary underline underline-offset-2"
          >
            Paste a CLI proof
          </button>
        </div>
        {showPaste && (
          <div className="mt-2.5">
            <textarea
              value={pasteText}
              onChange={(changeEvent) => setPasteText(changeEvent.target.value)}
              placeholder="Paste the bundle JSON from build-settle-bundle.js…"
              spellCheck={false}
              className="min-h-[70px] w-full resize-y rounded-xl border border-border bg-white/60 px-3.5 py-2.5 font-mono text-[12px] shadow-[inset_0_1px_3px_rgba(40,38,52,.08)] outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/14"
            />
            {pasteError && <FieldError message={pasteError} />}
            <Button
              variant="glass"
              size="sm"
              className="mt-2"
              disabled={!pasteText.trim()}
              onClick={loadPastedBundle}
            >
              Use pasted proof
            </Button>
          </div>
        )}
      </StepRow>

      <StepRow state={settleState} title="Settle on chain" isLast>
        <p className="text-[12.5px] text-muted-foreground">
          {isSettling
            ? 'Confirming settlement on chain…'
            : 'One signature settles the auction. The contract verifies the proof and moves tokens atomically.'}
        </p>
        {settleError && <FieldError message={describeSettleFailure(settleError)} />}
        <div className="mt-3">
          <Button variant="cta" disabled={!bundle || isSettling} onClick={() => void runSettle()}>
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

function FieldError({ message }: { message: string }) {
  return (
    <p className="mt-2 flex items-start gap-2 text-[12.5px] text-destructive">
      <span className="mt-1.25 size-1.5 flex-none rounded-full bg-destructive" />
      {message}
    </p>
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
