// Faucet control next to the wallet button. It opens a small dialog with two
// ways to fund a wallet for the testnet demo:
//   1. Testnet XLM via friendbot (account creation and fees), the same external
//      faucet as before, prefilled with the connected address.
//   2. Test tokens (tUSDC + tBENJI) via the faucet service: this signs the one
//      trustline the wallet needs, then mints. Only the wallet owner can sign its
//      own trustline, so a single Freighter signature is required; the issuer key
//      lives only in the faucet service, never in the browser.
// Addresses are public keys, not sensitive data. Testnet only.

import * as React from 'react'
import { Coins, Droplet, Loader2 } from 'lucide-react'

import { KNOWN_TOKENS, NETWORK_PASSPHRASE } from '@/config'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useWallet } from '@/hooks/useWallet'
import { walletKit } from '@/lib/wallet-kit'
import {
  describeFaucetClientError,
  requestTestTokens,
  type TestTokenGrant,
} from '@/lib/faucet'
import type { WalletSigner } from '@/lib/transactions'

const FRIENDBOT_BASE_URL = 'https://friendbot.stellar.org'

type RequestStatus = 'idle' | 'working' | 'done' | 'error'

const TOKEN_SUMMARY = KNOWN_TOKENS.map((token) => token.symbol).join(' + ')

export function FaucetButton() {
  const { wallet } = useWallet()
  const [open, setOpen] = React.useState(false)
  const [status, setStatus] = React.useState<RequestStatus>('idle')
  const [errorMessage, setErrorMessage] = React.useState('')
  const [grants, setGrants] = React.useState<TestTokenGrant[]>([])

  const isConnected = wallet.status === 'connected'
  const xlmFaucetUrl = isConnected ? `${FRIENDBOT_BASE_URL}/?addr=${wallet.address}` : FRIENDBOT_BASE_URL

  function resetOnOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (nextOpen) {
      setStatus('idle')
      setErrorMessage('')
      setGrants([])
    }
  }

  async function handleAddTestTokens() {
    if (wallet.status !== 'connected') {
      return
    }
    const address = wallet.address
    setStatus('working')
    setErrorMessage('')

    // Sign the trustline through the connected wallet. sourceRef:
    // web/src/components/auction/PlaceBidDialog.tsx signWithFreighter.
    const signWithFreighter: WalletSigner = async (transactionXdr) => {
      try {
        const signedResponse = await walletKit.signTransaction(transactionXdr, {
          networkPassphrase: NETWORK_PASSPHRASE,
          address,
        })
        return { ok: true, value: signedResponse.signedTxXdr }
      } catch {
        return { ok: false, error: 'declined' }
      }
    }

    const outcome = await requestTestTokens(address, signWithFreighter)
    if (outcome.ok) {
      setGrants(outcome.value)
      setStatus('done')
      return
    }
    setErrorMessage(describeFaucetClientError(outcome.error))
    setStatus('error')
  }

  const grantedSymbols = grants.map((grant) => grant.symbol).join(' + ')

  return (
    <Dialog open={open} onOpenChange={resetOnOpenChange}>
      <DialogTrigger asChild>
        <Button variant="glass" size="sm" className="rounded-xl" title="Get testnet funds">
          <Droplet aria-hidden="true" />
          <span className="hidden sm:inline">Faucet</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Get testnet funds</DialogTitle>
          <DialogDescription>
            Fund a wallet to try the demo. Everything here is testnet only, no real assets.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="glass-soft flex items-center justify-between gap-3 rounded-xl p-4">
            <div className="min-w-0">
              <p className="font-medium">Testnet XLM</p>
              <p className="text-sm text-muted-foreground">
                Creates the account and pays transaction fees (friendbot).
              </p>
            </div>
            <Button variant="glass" size="sm" className="shrink-0 rounded-xl" asChild>
              <a href={xlmFaucetUrl} target="_blank" rel="noreferrer">
                <Droplet aria-hidden="true" />
                <span>Get XLM</span>
              </a>
            </Button>
          </div>

          <div className="glass-soft flex flex-col gap-3 rounded-xl p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">Test tokens</p>
                <p className="text-sm text-muted-foreground">
                  {TOKEN_SUMMARY}: adds the trustlines and mints them to your wallet.
                </p>
              </div>
              <Button
                variant="cta"
                size="sm"
                className="shrink-0 rounded-xl"
                onClick={handleAddTestTokens}
                disabled={!isConnected || status === 'working'}
              >
                {status === 'working' ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden="true" />
                    <span>Working</span>
                  </>
                ) : (
                  <>
                    <Coins aria-hidden="true" />
                    <span>Add tokens</span>
                  </>
                )}
              </Button>
            </div>

            {!isConnected && (
              <p className="text-sm text-muted-foreground">Connect your wallet first to add test tokens.</p>
            )}
            {status === 'working' && (
              <p className="text-sm text-muted-foreground">
                Approve the trustline in Freighter, then the mint runs. This can take a few seconds.
              </p>
            )}
            {status === 'done' && (
              <p className="text-sm text-emerald-600">
                Added {grantedSymbols || TOKEN_SUMMARY} to your wallet. You can place a bid now.
              </p>
            )}
            {status === 'error' && <p className="text-sm text-destructive">{errorMessage}</p>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
