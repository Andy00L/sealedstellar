#![no_std]
// SealedStellar whitelist registry: an additive, standalone contract that maps a
// KYC whitelist Merkle root to the member addresses behind it. The auction
// contract stores only the root; the off-chain settle flow needs the members to
// rebuild the Merkle path and prove the winner's membership. A seller registers
// their auction's members here (one call, alongside create_auction) so any later
// reveal can read them back on-chain, with no external service.
//
// No auth and no on-chain root check: the root is the public commitment and the
// settle proof is the real integrity guard. A wrong registration only makes that
// root unsettleable (self-correcting); it can never forge a win. Registration is
// immutable per root (first write wins), so a correct list cannot be overwritten,
// and a root cannot be known before its members exist (it is their Poseidon
// hash), so it cannot be front-run. sourceRef: contracts/auction/src/lib.rs
// (whitelist_root, storage + TTL conventions), web/src/lib/operator.ts (the path
// rebuild that consumes these members).

use soroban_sdk::{contract, contractimpl, contracttype, vec, Address, Env, Vec, U256};

// A whitelist should outlive its auction's window and grace. The auction caps
// TTL extension at 3,000,000 ledgers; a fixed lifetime well under that, and long
// enough for any demo grace period, keeps a root's members readable at settle.
// sourceRef: contracts/auction/src/lib.rs MAX_TTL_EXTENSION_LEDGERS.
const TTL_LEDGERS: u32 = 1_000_000; // about 58 days at the 5 second close cadence

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    // The member addresses registered for a whitelist Merkle root (public data).
    Members(U256),
}

#[contract]
pub struct WhitelistRegistry;

#[contractimpl]
impl WhitelistRegistry {
    /// Records the member addresses behind a whitelist root. Idempotent and
    /// immutable per root: the first registration for a root wins and later
    /// calls for the same root are a no-op, so a correct list is never
    /// overwritten. Needs no auth (see the module note).
    pub fn register(env: Env, root: U256, members: Vec<Address>) {
        let key = DataKey::Members(root);
        if env.storage().persistent().has(&key) {
            return;
        }
        env.storage().persistent().set(&key, &members);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_LEDGERS, TTL_LEDGERS);
        env.storage().instance().extend_ttl(TTL_LEDGERS, TTL_LEDGERS);
    }

    /// Returns the members registered for a root, or an empty vector when the
    /// root was never registered. The caller then falls back to its built-in
    /// whitelist. sourceRef: web/api/reveal.ts reads this at reveal time.
    pub fn get_members(env: Env, root: U256) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::Members(root))
            .unwrap_or_else(|| vec![&env])
    }
}
