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
6. Whether proofs are generated in the browser or by the CLI prover for the
   demo video is decided on days 10-12; if any demo proof comes from the CLI,
   this file will say so.
