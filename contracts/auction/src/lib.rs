#![no_std]
// SealedStellar auction contract: sealed-bid commitments, uniform deposits,
// proof-gated settlement. Implements SEALEDSTELLAR_BUILD_PLAN.md sections 2.7
// (lifecycle and replay rules) and 5 days 5-6 (interface), with the frozen
// public input order from docs/DECISIONS.md (2026-06-12).
use soroban_poseidon::poseidon_hash;
use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype,
    crypto::bn254::Bn254Fr, token, vec, xdr::ToXdr, Address, Bytes, BytesN, Env, U256, Vec,
};

// Bid slot cap; must equal the circuit's bidCount parameter.
// sourceRef: circuits/auction_winner.circom, component main = AuctionWinner(8, 10)
const MAX_BID_SLOTS: u32 = 8;
// Sanity cap for the tweetnacl box ciphertext emitted in the bid event. An
// encrypted (price, salt) payload is about 79 bytes; 256 leaves headroom
// without letting events bloat.
const MAX_ENCRYPTED_BID_BYTES: u32 = 256;
// Ledger close cadence and TTL bounds for storage lifetime extension.
// sourceRef: Stellar docs, 5 second target close time; the network caps an
// entry's TTL extension around six months of ledgers.
const SECONDS_PER_LEDGER: u64 = 5;
const LEDGERS_PER_DAY: u32 = 17_280;
const MAX_TTL_EXTENSION_LEDGERS: u32 = 3_000_000;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum AuctionError {
    AuctionNotFound = 1,
    LotAmountNotPositive = 2,
    MaxPriceNotPositive = 3,
    MaxPriceExceeds64Bits = 4,
    DeadlineNotInFuture = 5,
    GracePeriodZero = 6,
    AlreadySettled = 7,
    AlreadyRefunded = 8,
    BidAfterDeadline = 9,
    BidsFull = 10,
    DuplicateCommitment = 11,
    CommitmentIsEmptyMarker = 12,
    EncryptedBidTooLarge = 13,
    SettleBeforeDeadline = 14,
    WinnerIndexOutOfRange = 15,
    WinningPriceNotPositive = 16,
    WinningPriceExceedsMax = 17,
    WinnerAddressMismatch = 18,
    ProofInvalid = 19,
    VerifierCallFailed = 20,
    RefundTooEarly = 21,
    /// reclaim_lot is only meaningful after refund_all left the lot behind.
    ReclaimRequiresRefundedAuction = 22,
    /// The lot already reached the seller (during refund_all or a previous
    /// reclaim_lot call).
    LotAlreadyReclaimed = 23,
    /// The rwa token rejected the lot transfer again during reclaim_lot.
    LotTransferFailed = 24,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub enum AuctionStatus {
    Open,
    Settled,
    Refunded,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Bid {
    pub bidder: Address,
    pub commitment: U256,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Auction {
    pub seller: Address,
    pub rwa_token: Address,
    pub lot_amount: i128,
    pub payment_token: Address,
    pub max_price: i128,
    pub commit_deadline: u64,
    pub grace_period: u64,
    pub whitelist_root: U256,
    pub operator_enc_pubkey: BytesN<32>,
    pub status: AuctionStatus,
    pub bids: Vec<Bid>,
    /// True once the lot has left escrow toward the seller after a refund.
    /// Audit fix 2026-06-12 finding 1: a trapping rwa token must never block
    /// deposit refunds, so the lot leg is retryable instead of fatal.
    pub lot_reclaimed: bool,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Verifier,
    NextAuctionId,
    Auction(u64),
}

// Structural twin of the deployed verifier's Proof type. Cross-contract calls
// match on XDR structure and field names, not crate identity; a path
// dependency would link the verifier's wasm export symbols (__constructor,
// verify) into this contract and collide. Field names a, b, c mirror the
// deployed verifier ABI (canonical Groth16 point names) and cannot change
// without redeploying it. sourceRef: contracts/verifier/src/lib.rs
#[derive(Clone)]
#[contracttype]
pub struct VerifierProof {
    pub a: BytesN<64>,
    pub b: BytesN<128>,
    pub c: BytesN<64>,
}

// Minimal client for the deployed Groth16 verifier instance.
// sourceRef: contracts/verifier/src/lib.rs (verify signature)
#[contractclient(name = "VerifierClient")]
pub trait VerifierInterface {
    fn verify(env: Env, proof: VerifierProof, pub_signals: Vec<U256>) -> bool;
}

// Events. The bid event carries the tweetnacl ciphertext so the operator can
// recover bids after close without any off-chain channel (plan section 2.2).
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuctionCreated {
    #[topic]
    pub auction_id: u64,
    pub seller: Address,
    pub max_price: i128,
    pub commit_deadline: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BidPlaced {
    #[topic]
    pub auction_id: u64,
    pub slot_index: u32,
    pub bidder: Address,
    pub commitment: U256,
    pub encrypted_bid: Bytes,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuctionSettled {
    #[topic]
    pub auction_id: u64,
    pub winner: Address,
    pub winning_price: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuctionRefunded {
    #[topic]
    pub auction_id: u64,
    pub refunded_bids: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LotReturnFailed {
    #[topic]
    pub auction_id: u64,
    pub seller: Address,
    pub lot_amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LotReclaimed {
    #[topic]
    pub auction_id: u64,
    pub seller: Address,
    pub lot_amount: i128,
}

#[contract]
pub struct SealedAuction;

#[contractimpl]
impl SealedAuction {
    /// Stores the Groth16 verifier instance address once, at deploy time.
    pub fn __constructor(env: Env, verifier: Address) {
        env.storage().instance().set(&DataKey::Verifier, &verifier);
        env.storage().instance().set(&DataKey::NextAuctionId, &1u64);
    }

    /// Creates an auction and escrows the lot. Escrowing at creation (rather
    /// than at settle) means a settle can never fail on a missing seller
    /// balance, so funds can never get half-moved (decision 2026-06-12).
    #[allow(clippy::too_many_arguments)]
    pub fn create_auction(
        env: Env,
        seller: Address,
        rwa_token: Address,
        lot_amount: i128,
        payment_token: Address,
        max_price: i128,
        commit_deadline: u64,
        grace_period: u64,
        whitelist_root: U256,
        operator_enc_pubkey: BytesN<32>,
    ) -> Result<u64, AuctionError> {
        seller.require_auth();

        if lot_amount <= 0 {
            return Err(AuctionError::LotAmountNotPositive);
        }
        if max_price <= 0 {
            return Err(AuctionError::MaxPriceNotPositive);
        }
        // The circuit range-checks prices to 64 bits; a larger max_price
        // could never be proven and would strand deposits until refund.
        if max_price > u64::MAX as i128 {
            return Err(AuctionError::MaxPriceExceeds64Bits);
        }
        if commit_deadline <= env.ledger().timestamp() {
            return Err(AuctionError::DeadlineNotInFuture);
        }
        if grace_period == 0 {
            return Err(AuctionError::GracePeriodZero);
        }

        let auction_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextAuctionId)
            .unwrap_or(1u64);
        env.storage()
            .instance()
            .set(&DataKey::NextAuctionId, &(auction_id + 1));

        let escrow_address = env.current_contract_address();
        token::Client::new(&env, &rwa_token).transfer(&seller, &escrow_address, &lot_amount);

        let auction = Auction {
            seller: seller.clone(),
            rwa_token,
            lot_amount,
            payment_token,
            max_price,
            commit_deadline,
            grace_period,
            whitelist_root,
            operator_enc_pubkey,
            status: AuctionStatus::Open,
            bids: vec![&env],
            lot_reclaimed: false,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Auction(auction_id), &auction);

        // Audit fix 2026-06-12 finding 3: keep the auction entry and the
        // contract instance alive on the ledger for the whole auction
        // lifetime plus a day of margin, so archival cannot block settle or
        // refund_all.
        let lifetime_seconds = (commit_deadline - env.ledger().timestamp())
            .saturating_add(grace_period);
        let lifetime_ledgers_u64 = (lifetime_seconds / SECONDS_PER_LEDGER)
            .saturating_add(LEDGERS_PER_DAY as u64);
        let lifetime_ledgers = if lifetime_ledgers_u64 > MAX_TTL_EXTENSION_LEDGERS as u64 {
            MAX_TTL_EXTENSION_LEDGERS
        } else {
            lifetime_ledgers_u64 as u32
        };
        env.storage().persistent().extend_ttl(
            &DataKey::Auction(auction_id),
            lifetime_ledgers,
            lifetime_ledgers,
        );
        env.storage()
            .instance()
            .extend_ttl(lifetime_ledgers, lifetime_ledgers);

        AuctionCreated {
            auction_id,
            seller,
            max_price,
            commit_deadline,
        }
        .publish(&env);
        Ok(auction_id)
    }

    /// Records a sealed bid and locks the uniform max_price deposit. Every
    /// bidder deposits the same amount so the chain leaks nothing about the
    /// hidden price (plan section 2.3).
    pub fn place_bid(
        env: Env,
        auction_id: u64,
        bidder: Address,
        commitment: U256,
        encrypted_bid: Bytes,
    ) -> Result<(), AuctionError> {
        bidder.require_auth();

        let mut auction = load_auction(&env, auction_id)?;
        ensure_open(&auction)?;
        if env.ledger().timestamp() >= auction.commit_deadline {
            return Err(AuctionError::BidAfterDeadline);
        }
        if auction.bids.len() >= MAX_BID_SLOTS {
            return Err(AuctionError::BidsFull);
        }
        // Zero is the canonical empty-slot commitment the circuit recognizes
        // (docs/DECISIONS.md 2026-06-12); a real bid must never collide.
        if commitment == U256::from_u32(&env, 0) {
            return Err(AuctionError::CommitmentIsEmptyMarker);
        }
        for existing_bid in auction.bids.iter() {
            if existing_bid.commitment == commitment {
                return Err(AuctionError::DuplicateCommitment);
            }
        }
        if encrypted_bid.len() > MAX_ENCRYPTED_BID_BYTES {
            return Err(AuctionError::EncryptedBidTooLarge);
        }

        let escrow_address = env.current_contract_address();
        token::Client::new(&env, &auction.payment_token).transfer(
            &bidder,
            &escrow_address,
            &auction.max_price,
        );

        let slot_index = auction.bids.len();
        auction.bids.push_back(Bid {
            bidder: bidder.clone(),
            commitment: commitment.clone(),
        });
        env.storage()
            .persistent()
            .set(&DataKey::Auction(auction_id), &auction);

        BidPlaced {
            auction_id,
            slot_index,
            bidder,
            commitment,
            encrypted_bid,
        }
        .publish(&env);
        Ok(())
    }

    /// Settles the auction against a Groth16 proof. The public input vector
    /// is rebuilt from storage plus the caller arguments below; the caller
    /// can never supply the commitments or the auction id (plan section 2.7).
    /// Permissionless by design: the proof is the authority
    /// (docs/DECISIONS.md 2026-06-12).
    ///
    /// winning_price is the Vickrey CLEARING price: the highest bid among
    /// the non-winner slots (docs/DECISIONS.md 2026-06-13). The winner's own
    /// bid never becomes public; the proof attests the clearing price is
    /// the true second price. With fewer than two positive bids no valid
    /// proof exists and the auction can only end through refund_all.
    pub fn settle(
        env: Env,
        auction_id: u64,
        winner_index: u32,
        winning_price: i128,
        winner_address: Address,
        proof: VerifierProof,
    ) -> Result<(), AuctionError> {
        let mut auction = load_auction(&env, auction_id)?;
        ensure_open(&auction)?;
        if env.ledger().timestamp() < auction.commit_deadline {
            return Err(AuctionError::SettleBeforeDeadline);
        }
        if winner_index >= auction.bids.len() {
            return Err(AuctionError::WinnerIndexOutOfRange);
        }
        if winning_price <= 0 {
            return Err(AuctionError::WinningPriceNotPositive);
        }
        if winning_price > auction.max_price {
            return Err(AuctionError::WinningPriceExceedsMax);
        }
        let winner_bid = auction
            .bids
            .get(winner_index)
            .ok_or(AuctionError::WinnerIndexOutOfRange)?;
        // The argument is kept per the plan interface but storage is the
        // authority: the winner must be the bidder who owns the winning slot.
        if winner_bid.bidder != winner_address {
            return Err(AuctionError::WinnerAddressMismatch);
        }

        let pub_signals = build_public_signals(
            &env,
            &auction,
            auction_id,
            winner_index,
            winning_price,
            &winner_address,
        );

        let verifier: Address = env
            .storage()
            .instance()
            .get(&DataKey::Verifier)
            .ok_or(AuctionError::VerifierCallFailed)?;
        match VerifierClient::new(&env, &verifier).try_verify(&proof, &pub_signals) {
            Ok(Ok(true)) => {}
            Ok(Ok(false)) => return Err(AuctionError::ProofInvalid),
            // Conversion failures, contract errors, and host traps (for
            // example malformed curve points) are call failures, distinct
            // from a well-formed proof that simply does not verify.
            _ => return Err(AuctionError::VerifierCallFailed),
        }

        // Single state transition before any transfer; the invocation is
        // atomic, so a failed transfer rolls the flag back too.
        auction.status = AuctionStatus::Settled;
        env.storage()
            .persistent()
            .set(&DataKey::Auction(auction_id), &auction);

        let contract_address = env.current_contract_address();
        let payment = token::Client::new(&env, &auction.payment_token);
        payment.transfer(&contract_address, &auction.seller, &winning_price);
        let winner_deposit_refund = auction.max_price - winning_price;
        if winner_deposit_refund > 0 {
            payment.transfer(&contract_address, &winner_address, &winner_deposit_refund);
        }
        for (slot_index, losing_bid) in auction.bids.iter().enumerate() {
            if slot_index as u32 != winner_index {
                payment.transfer(&contract_address, &losing_bid.bidder, &auction.max_price);
            }
        }
        token::Client::new(&env, &auction.rwa_token).transfer(
            &contract_address,
            &winner_address,
            &auction.lot_amount,
        );

        AuctionSettled {
            auction_id,
            winner: winner_address,
            winning_price,
        }
        .publish(&env);
        Ok(())
    }

    /// Returns every deposit and the lot once the grace period has passed
    /// without a settle. Permissionless: the clock is the authority, and no
    /// path may strand funds (plan section 2.7).
    pub fn refund_all(env: Env, auction_id: u64) -> Result<(), AuctionError> {
        let mut auction = load_auction(&env, auction_id)?;
        ensure_open(&auction)?;
        let refund_unlock_time = auction.commit_deadline.saturating_add(auction.grace_period);
        if env.ledger().timestamp() < refund_unlock_time {
            return Err(AuctionError::RefundTooEarly);
        }

        auction.status = AuctionStatus::Refunded;
        env.storage()
            .persistent()
            .set(&DataKey::Auction(auction_id), &auction);

        let contract_address = env.current_contract_address();
        let payment = token::Client::new(&env, &auction.payment_token);
        for refunded_bid in auction.bids.iter() {
            payment.transfer(&contract_address, &refunded_bid.bidder, &auction.max_price);
        }

        // Audit fix 2026-06-12 finding 1: the lot-return leg must never be
        // able to block the deposit refunds above. A seller-supplied rwa
        // token that traps here leaves the lot parked in escrow, retryable
        // through reclaim_lot, while every bidder still gets refunded.
        let lot_return = token::Client::new(&env, &auction.rwa_token).try_transfer(
            &contract_address,
            &auction.seller,
            &auction.lot_amount,
        );
        if matches!(lot_return, Ok(Ok(()))) {
            auction.lot_reclaimed = true;
            env.storage()
                .persistent()
                .set(&DataKey::Auction(auction_id), &auction);
        } else {
            LotReturnFailed {
                auction_id,
                seller: auction.seller.clone(),
                lot_amount: auction.lot_amount,
            }
            .publish(&env);
        }

        AuctionRefunded {
            auction_id,
            refunded_bids: auction.bids.len(),
        }
        .publish(&env);
        Ok(())
    }

    /// Retries returning the lot to the seller after refund_all could not
    /// (for example the rwa token trapped at refund time). Permissionless:
    /// the lot can only ever move to the stored seller.
    pub fn reclaim_lot(env: Env, auction_id: u64) -> Result<(), AuctionError> {
        let mut auction = load_auction(&env, auction_id)?;
        if auction.status != AuctionStatus::Refunded {
            return Err(AuctionError::ReclaimRequiresRefundedAuction);
        }
        if auction.lot_reclaimed {
            return Err(AuctionError::LotAlreadyReclaimed);
        }

        let lot_return = token::Client::new(&env, &auction.rwa_token).try_transfer(
            &env.current_contract_address(),
            &auction.seller,
            &auction.lot_amount,
        );
        if !matches!(lot_return, Ok(Ok(()))) {
            return Err(AuctionError::LotTransferFailed);
        }
        auction.lot_reclaimed = true;
        env.storage()
            .persistent()
            .set(&DataKey::Auction(auction_id), &auction);

        LotReclaimed {
            auction_id,
            seller: auction.seller.clone(),
            lot_amount: auction.lot_amount,
        }
        .publish(&env);
        Ok(())
    }

    /// Read-only view of an auction, bids included (all public on chain).
    pub fn get_auction(env: Env, auction_id: u64) -> Result<Auction, AuctionError> {
        load_auction(&env, auction_id)
    }
}

fn load_auction(env: &Env, auction_id: u64) -> Result<Auction, AuctionError> {
    env.storage()
        .persistent()
        .get(&DataKey::Auction(auction_id))
        .ok_or(AuctionError::AuctionNotFound)
}

fn ensure_open(auction: &Auction) -> Result<(), AuctionError> {
    match auction.status {
        AuctionStatus::Open => Ok(()),
        AuctionStatus::Settled => Err(AuctionError::AlreadySettled),
        AuctionStatus::Refunded => Err(AuctionError::AlreadyRefunded),
    }
}

/// Rebuilds the 13-signal public input vector in the frozen order
/// (docs/DECISIONS.md 2026-06-12): auction_id, commitments[0..8] padded with
/// the zero empty-slot marker, winner_index, winning_price, whitelist_root,
/// winner_addr_hash.
fn build_public_signals(
    env: &Env,
    auction: &Auction,
    auction_id: u64,
    winner_index: u32,
    winning_price: i128,
    winner_address: &Address,
) -> Vec<U256> {
    let mut pub_signals: Vec<U256> = vec![env];
    pub_signals.push_back(U256::from_u128(env, auction_id as u128));
    for slot_index in 0..MAX_BID_SLOTS {
        match auction.bids.get(slot_index) {
            Some(slot_bid) => pub_signals.push_back(slot_bid.commitment.clone()),
            None => pub_signals.push_back(U256::from_u32(env, 0)),
        }
    }
    pub_signals.push_back(U256::from_u32(env, winner_index));
    // winning_price is positive and at most max_price (checked by settle),
    // and max_price fits 64 bits (checked at creation), so the cast is safe.
    pub_signals.push_back(U256::from_u128(env, winning_price as u128));
    pub_signals.push_back(auction.whitelist_root.clone());
    pub_signals.push_back(address_leaf(env, winner_address));
    pub_signals
}

/// Computes the whitelist leaf for an address: Poseidon over the two
/// big-endian 128-bit halves of the 32 raw address key bytes, exactly the
/// frozen mapping in docs/DECISIONS.md (2026-06-12) and helpers.js
/// computeAddressLeaf. The 32 bytes are the tail of the ScAddress XDR: the
/// ed25519 public key for accounts, the contract id for contracts.
/// sourceRef: stellar-xdr ScAddress definition.
///
/// Security invariant (audit 2026-06-12 finding 5): the whitelist tree pads
/// unused leaves with 0, and the circuit would accept a membership proof
/// for a 0 leaf. That is unreachable because this function is the only
/// source of winner_addr_hash and a Poseidon output is never 0; the caller
/// can never supply the leaf directly (plan section 2.7).
fn address_leaf(env: &Env, address: &Address) -> U256 {
    let address_xdr: Bytes = address.clone().to_xdr(env);
    let xdr_length = address_xdr.len();
    let key_bytes_slice = address_xdr.slice(xdr_length - 32..xdr_length);
    let mut key_bytes = [0u8; 32];
    key_bytes_slice.copy_into_slice(&mut key_bytes);

    let mut high_half = [0u8; 16];
    let mut low_half = [0u8; 16];
    high_half.copy_from_slice(&key_bytes[..16]);
    low_half.copy_from_slice(&key_bytes[16..]);

    let leaf_inputs = vec![
        env,
        U256::from_u128(env, u128::from_be_bytes(high_half)),
        U256::from_u128(env, u128::from_be_bytes(low_half)),
    ];
    poseidon_hash::<3, Bn254Fr>(env, &leaf_inputs)
}

mod test;
