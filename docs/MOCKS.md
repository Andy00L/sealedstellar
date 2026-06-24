# Honest-mocks ledger

What is real and what is mocked in SealedStellar. Mirrored into the README
before submission (plan section 9). Updated 2026-06-12.

1. tBENJI and tUSDC are Stellar Asset Contract tokens we issued on testnet;
   no real Franklin Templeton or Circle assets are involved.
   - Issuer (throwaway testnet key, alias token-issuer):
     GDYLKSRXQZ7Y2Y44HDKVXB74WSXFRZRMGHKGG5XXO7ZFOWU7HWVYRR3G
   - tBENJI SAC: CDUTXMK5MGOXSBUPZNQZ6J5RCQEVC4MOMYW72WXVUWV5W7OCXJIGJUGN
   - tUSDC SAC: CDIKPNCUSBHSTGD5GZKKHPK6BVE732BUCKQ3EPLYMSLUSHEZPAFTNPVX
2. The auction operator learns bid values after close in order to build the
   proof. Bid privacy holds against the public and the other bidders; the
   proof makes the OUTCOME trustless, not the operator's view. Trustless
   alternatives (MPC decryption, timelock encryption) are future work.
3. The Groth16 proving key (circuits/build/aw_final.zkey, 5436794 bytes,
   committed to the repo) comes from a single-contribution development
   ceremony. It is trusted-setup weak by construction: whoever holds the
   contribution randomness could forge proofs. A production deployment needs
   a real multi-party ceremony.
4. The whitelist is a demo Poseidon Merkle tree of test addresses standing in
   for an issuer's KYC registry (depth 10, up to 1024 members).
5. The bidder count is fixed at 8 slots per auction in v1 (circuit size).
6. Proofs are generated IN THE BROWSER. The operator loads their session (box
   key plus whitelist members, client-side only), the app fetches the sealed
   bids from chain, decrypts them, rebuilds the whitelist Merkle path, builds
   the circuit input, and runs the Groth16 prover (snarkjs with the circuit
   wasm and the ~5.6 MB proving key) in the tab, then settles with one wallet
   signature. Verified end to end on testnet: a browser-generated proof
   verified true on chain and settled auction 7 (tx 2085aa97eab48047af2da16e7
   17b8e5f1d47ef26aa88cd3b25932afecabd54eb). A CLI-generated proof can be
   pasted as a fallback if browser proving stalls
   (prover/build-settle-bundle.js).
7. Bidder IDENTITIES are public: place_bid transactions are signed and the
   BidPlaced events name the bidder. What stays hidden is every bid AMOUNT,
   the winner's included: settlement reveals only the Vickrey clearing
   price (the second-highest bid, by construction a losing bid's value).
   "Losing bidders are never identified" in the whitelist design means the
   proof never links losers to the KYC tree, not that their participation
   is invisible.
8. Settlement liveness depends on every ciphertext being decryptable: a
   bidder who posts garbage ciphertext (or a seller who sets a wrong
   operator key) makes the winner proof impossible, and the auction falls
   back to refund_all after the grace period, deposits and lot returned.
   This griefing costs the attacker nothing at hackathon scale.
   Production-grade fixes (verifiable encryption of the bid inside the
   proof, or a reveal-or-slash bond) are listed as future work.
9. Vickrey degenerate rule (b): an auction with fewer than two
   positive-price bids has no second price, cannot settle, and ends
   through refund_all (deposits and lot returned). A production deployment
   would instead add a seller reserve price as an extra public input so
   single-bidder auctions can clear at the reserve.
10. Operational incident (2026-06-12): the operator box secret keys for
    standing-instance auctions 1 to 5 lived only in /tmp run directories
    and were lost when /tmp was wiped. Auction 3 settled while its key
    still existed; auctions 1, 4, and 5 stay on chain as refund-only
    display data because their ciphertexts can no longer be decrypted,
    which is exactly the liveness property item 8 describes. Operator keys
    and whitelist member files now live in the gitignored secrets/
    directory of the working clone (docs/DECISIONS.md 2026-06-12). Losing
    an operator key after bids exist still means refund-only, by design.
