// The demo KYC whitelist: the public account ids the demo auctions gate on, and
// the Poseidon Merkle root they rebuild to. These are PUBLIC Stellar account ids
// (G addresses), not secrets. They already appear on chain in every bid event,
// and each auction's root is public, so listing them here leaks nothing new.
//
// Keeping the member list in the app is the point: it lets the same-origin
// auto-settler (web/api/settle.ts) rebuild a winner's Merkle membership path with
// no OPERATOR_WHITELIST env var for anyone to configure. The zero-knowledge proof
// still hides WHICH member won; publishing the eligible set only reveals who could
// have bid, which is fine for a public testnet demo. A production operator would
// hold this member list privately server-side instead of shipping it in the app.
//
// This module is intentionally dependency-free: no Vite import.meta, no browser
// globals, no other imports. That lets the Node serverless function import it with
// a plain relative path, and keeps it the single source both surfaces read from.
//
// sourceRef: secrets/whitelist-demo.json (built by prover/build-whitelist.js). The
// order below is the tree-leaf order used to compute the root; do not reorder it,
// or the rebuilt root stops matching. web/api/settle.ts verifies the rebuilt root
// against each auction's on-chain root before it proves anything.

// Poseidon Merkle root of the members below, tree depth 10, as a decimal string.
// sourceRef: secrets/whitelist-demo.json rootDecimal.
export const DEMO_WHITELIST_ROOT_DECIMAL =
  '5172224275804351315414901861729184676010438551683667636100386119102665402371'

// The whitelisted demo accounts, in tree-leaf order.
// sourceRef: secrets/whitelist-demo.json members[].address.
export const DEMO_WHITELIST_MEMBERS: readonly string[] = [
  'GBVBAPDDM6TSSFHSYS3YBY373V6KJK7Z7IMNEKNDAFGAVAVXNJBZD6KM',
  'GDDHJQ64WPTNS7W6ZP2CTNUHI6RRGRHTZPBIAHRSRWKDVBHVAW6RFWW7',
  'GDFEOXY7447MY35USQDTP4TGHHQSNLQ7WCV6GBI3YQEOZM2TWOAMYCRE',
  'GDIVCF6NSGSOXSFOU7H4DUDLOYMERGDKZWMPNVQM6VFNVR26B67FJQBH',
  'GDPUSGQJ4V4PVSK7DFB6KTXLF5OCFIHMZTCVR5EW57OV3KP54JM7S6TE',
  'GC23LXDJALF6PQKAFO3IWCHWSBLTQJBODNOD4FGFUC4KEHBQHNQQBXNK',
]
