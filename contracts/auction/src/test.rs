#![cfg(test)]
extern crate std;

use num_bigint::BigUint;
use soroban_sdk::{
    testutils::{Address as AddressTestUtils, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, Bytes, BytesN, Env, Vec, U256,
};

use crate::{
    address_leaf, AuctionError, AuctionStatus, SealedAuction, SealedAuctionClient, VerifierProof,
};

// ---------------------------------------------------------------------------
// Fixture provenance. Regenerated 2026-06-13 (Vickrey ceremony) by
// circuits/scripts/make-contract-fixture.js plus snarkjs prove and
// prover/format-args.js (files build/contract_fixture_meta.json and
// build/contract_args.json). The proof is REAL: it verifies the honest
// 5-bid story (prices 1200, 3500, 990, 2750, 3100; winner slot 1, public
// clearing price 3100 = the second-highest bid; the winning bid stays
// private) for auction_id 1, whitelist root below, winner address key
// bytes 0x42 repeated. The demo proof is the equally real demo-fixture
// proof bound to auction_id 42; valid groth16 material for a DIFFERENT
// statement.
// ---------------------------------------------------------------------------

// Mirrors WINNER_PUBKEY_BYTE in circuits/scripts/make-contract-fixture.js.
const WINNER_PUBKEY_BYTE: u8 = 0x42;

const COMMITMENT_DECIMALS: [&str; 5] = [
    "20879951420426332997064664141669667329363317804622556945105591368743376150405",
    "12380138003843549010236672833079779433720825481519455728529226797870800602695",
    "8719253196487838832083634100634403751576237250567612042914223393552214071793",
    "9191534303447760569342038944463954184503813949636075845941826061236953684916",
    "6217380532169512160086643059421877825669537638060096121779524973034396746279",
];
const WHITELIST_ROOT_DECIMAL: &str =
    "9759254546157675694769496200661537147794632714209423066807692630320119748457";
// Poseidon2 leaf for the 0x42-repeated key; the on-chain address_leaf
// computation must reproduce this exact value (cross-language check).
const WINNER_LEAF_DECIMAL: &str =
    "16194320903767483366234864223076020169782038881049200692067095461144836594391";
const WINNER_INDEX: u32 = 1;
// Vickrey clearing price: the second-highest bid (3100), not the winning
// bid (3500), which never becomes public.
const WINNING_PRICE: i128 = 3100;

const CONTRACT_PROOF_A_HEX: &str = "00eaa47457f9eb97cb20990f279235e40ceea2e280cd2b2fdaff7adac63baefe26b04cd5107107619147d3a927d71d2c3ee3564014510eb3e47c3c5be7a43ffa";
const CONTRACT_PROOF_B_HEX: &str = "0d6cc4f59b75d0a243ef48edbae38d68dcdb47851f304c03b0b18063b79bfc910d92ebbe1d312c5a5c2e474cdcad6b9e1cbedb015c323d91fb28a3aea15f158c0f3df4da7fb36f4a50254b3998a1f8240887a166e66093dbc22da8d0c46226cc2320a8e365b92edcc2ba79cd214d651431bbdd7901a167404946b99cdf4f69e5";
const CONTRACT_PROOF_C_HEX: &str = "273ef24f58facb702cb1d9282512c064e47ce63d50b00241552e2718f0df005c0cc7131a88bfe95fecf2af220582a4380c8f7409b897b22021bca61c29e04375";

const DEMO_PROOF_A_HEX: &str = "0ebdcc2862d1692c0210046322e99471ec147ad939fd04166a1b548be89e80d5139cfad34c89e638b5701080b09f403c1779536d48e3bd8e767bf327605b89b7";
const DEMO_PROOF_B_HEX: &str = "28ab9f868823edd4dde3bd2ddea92db279598eb55a8ad601a9225c5d82083f6524c615d06e9963f0e55b53f9c6042cac37ba22361012721c4520a03c08c44dd71740951056c3aa3db9fcece0128622c7046aed52920f39fff96b6bd323e1478d0bb126d129c21e0c3bbc85ce5a8ba41f975256683a6236e11e04e4d371e06281";
const DEMO_PROOF_C_HEX: &str = "0337b1ff10c74eda1b2ab4c04ba8b90d92c15c00a68531d69fb90c33f64f5f9c22003d90ebab4b6c783bdf36238691ab1ed13177036ecc6c4b29a081a187c55e";

const VKEY_ALPHA_HEX: &str = "2d4d9aa7e302d9df41749d5507949d05dbea33fbb16c643b22f599a2be6df2e214bedd503c37ceb061d8ec60209fe345ce89830a19230301f076caff004d1926";
const VKEY_BETA_HEX: &str = "0967032fcbf776d1afc985f88877f182d38480a653f2decaa9794cbc3bf3060c0e187847ad4c798374d0d6732bf501847dd68bc0e071241e0213bc7fc13db7ab304cfbd1e08a704a99f5e847d93f8c3caafddec46b7a0d379da69a4d112346a71739c1b1a457a8c7313123d24d2f9192f896b7c63eea05a9d57f06547ad0cec8";
const VKEY_GAMMA_HEX: &str = "198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa";
const VKEY_DELTA_HEX: &str = "09625c7f689bf060fb900dd04cf9afefc33a9803e655e628b2ee18086d4fe7520aa755cc8ece80514ec0173ea12c4ceff15f4f802d23b88986ccbf84f44e7bfc2557c7a523f55f4961e53f865629105fcad368d37ece3f1d6244e96061a765fa11db0ce57c735af2337c1ea9896731c6179db995ff68831b9c4212a084d5f2d9";
const VKEY_IC_HEX: [&str; 14] = [
    "04fe54d0ebedea458b7d41e6b525789c254aa050c126850d9be84f30ccabe0ee02e792ed2b8153439805b7edd61c5a7d87ad6064d6881dc1e4b0d7507218e904",
    "087410cb9c1dc6e19751a4ed066cbd2463828f98f149c4ee4c5626ab3093b7e2290909ee2dd15972e716b81d998cbd200dd83d6f465ac530a1d42fd45a21356c",
    "02b9ecc98a241ed1c995eb7c58fbb0af0dea21e54530196e53f31538b3d22fb629edf9689606f23252a57ecb42bc4e1ed3c811daf5d31748f8fd1fb416a5945d",
    "174c4170e9958cffb75f897c01085e2c9f1b3f6961c02de382f3ff85c2a09cf8097962332e63ea478ff18c5132ff350b4a1687f80de33ccbf3c2ef6d7ec20ec1",
    "0747726fdf74450d28ed2aa95037c08b01070bd2646df3b4bfae72da520a0b5210d8518903128f7c4699de06442be6291c4438333a5ed961ba24c5ee7221ee56",
    "03f718900bbea157ed511d2e38589606057d459e26dccc08d1cb27237e338ae214b47b55c28e32ec80a0de0d96c84b1dd811b7f51dd0a7d7e669f8d092d5b464",
    "02641b1ab5f17b22ddbe81651f6bfabf63188b39618cc4cf4c2e51a426b002150b2bec323b727ac348733de9295cce8080b687faee4dd88e3abf58457e59d7f0",
    "2c3dd2640be194441e530ee2683e2314a2f616d00613db6f667438ccb5b341a51890d4181515c5879f4943839c57332fb64bc39afe23594eeab3d376b1c31547",
    "236457a5884e45fe76ad88294e3f156b7941113c1b550467d9e3c062c347eefb0b4c38164ba5703da72875d5b22d7a7a8513a0a67458b335419af1759133e9aa",
    "0652d9b993f09c19deccbff146cb8ed1023c8ed1102f8f0c972540352674738f03f121736df38d1020869686e070371505715141999fad42c08d37ca34b36c91",
    "0b915f0ba9ccd9867c810f2afdbb09495e87c41fbb230cab8fc7a6af6c6882b21261f1773ebaaaee74ed909e3d47c13b5f0b7b5ee3733c42d8baa704c18fabea",
    "2ee1e6756fd5838c2f30370a0150077832b0163ffe58706e92473e5b5a01c38f0ca96361b0d1eb07a1c6fa871a19a6770e3f1f0b9932bc3f28546cad031fe474",
    "160431357c57614473c25b69f98ca5fe719387ac4da776985c06eb9ea45f023d0196b0ecdf080cee9fdf8aedc36ead557ce5ec7f0d4f251167925ae87b31411d",
    "035552fa42c2094fd93b5ed77243b3a17cf01a1f9f4014e42dc15c54dbece57521fd2d1c04a21c21952917e744d7cd85e53ec4fa13465924d05bbb16c336188e",
];

const START_TIME: u64 = 1_750_000_000;
const COMMIT_DEADLINE: u64 = START_TIME + 1_000;
const GRACE_PERIOD: u64 = 500;
const MAX_PRICE: i128 = 5_000;
const LOT_AMOUNT: i128 = 100;
const SELLER_RWA_SUPPLY: i128 = 1_000;
const BIDDER_FUNDING: i128 = 20_000;

fn bytesn_64(env: &Env, hex_text: &str) -> BytesN<64> {
    let decoded = hex::decode(hex_text).expect("fixture hex");
    let array: [u8; 64] = decoded.try_into().expect("64 bytes");
    BytesN::from_array(env, &array)
}

fn bytesn_128(env: &Env, hex_text: &str) -> BytesN<128> {
    let decoded = hex::decode(hex_text).expect("fixture hex");
    let array: [u8; 128] = decoded.try_into().expect("128 bytes");
    BytesN::from_array(env, &array)
}

fn decimal_to_u256(env: &Env, decimal_text: &str) -> U256 {
    let parsed = BigUint::parse_bytes(decimal_text.as_bytes(), 10).expect("fixture decimal");
    let raw_bytes = parsed.to_bytes_be();
    let mut padded = [0u8; 32];
    padded[32 - raw_bytes.len()..].copy_from_slice(&raw_bytes);
    U256::from_be_bytes(env, &Bytes::from_array(env, &padded))
}

fn real_verification_key(env: &Env) -> sealedstellar_verifier::VerificationKey {
    let mut ic_points: Vec<BytesN<64>> = vec![env];
    for ic_hex in VKEY_IC_HEX.iter() {
        ic_points.push_back(bytesn_64(env, ic_hex));
    }
    sealedstellar_verifier::VerificationKey {
        alpha: bytesn_64(env, VKEY_ALPHA_HEX),
        beta: bytesn_128(env, VKEY_BETA_HEX),
        gamma: bytesn_128(env, VKEY_GAMMA_HEX),
        delta: bytesn_128(env, VKEY_DELTA_HEX),
        ic: ic_points,
    }
}

fn contract_proof(env: &Env) -> VerifierProof {
    VerifierProof {
        a: bytesn_64(env, CONTRACT_PROOF_A_HEX),
        b: bytesn_128(env, CONTRACT_PROOF_B_HEX),
        c: bytesn_64(env, CONTRACT_PROOF_C_HEX),
    }
}

fn demo_proof(env: &Env) -> VerifierProof {
    VerifierProof {
        a: bytesn_64(env, DEMO_PROOF_A_HEX),
        b: bytesn_128(env, DEMO_PROOF_B_HEX),
        c: bytesn_64(env, DEMO_PROOF_C_HEX),
    }
}

fn deterministic_winner_address(env: &Env) -> Address {
    // Contract-type strkey (C...): the leaf mapping hashes the 32-byte tail
    // of the ScAddress XDR either way, and the test ledger can mint SAC
    // balances to contract addresses without trustline entries.
    let strkey = stellar_strkey::Contract([WINNER_PUBKEY_BYTE; 32]).to_string();
    Address::from_str(env, &strkey)
}

struct TestWorld {
    env: Env,
    auction_client: SealedAuctionClient<'static>,
    seller: Address,
    bidders: std::vec::Vec<Address>,
    rwa_token: Address,
    payment_token: Address,
    payment_asset: StellarAssetClient<'static>,
}

fn setup_world() -> TestWorld {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|ledger_info| ledger_info.timestamp = START_TIME);

    let verifier_id = env.register(
        sealedstellar_verifier::Groth16Verifier,
        (real_verification_key(&env),),
    );
    let auction_id = env.register(SealedAuction, (verifier_id,));
    let auction_client = SealedAuctionClient::new(&env, &auction_id);

    let rwa_admin = Address::generate(&env);
    let payment_admin = Address::generate(&env);
    let rwa_contract = env.register_stellar_asset_contract_v2(rwa_admin);
    let payment_contract = env.register_stellar_asset_contract_v2(payment_admin);
    let rwa_asset = StellarAssetClient::new(&env, &rwa_contract.address());
    let payment_asset = StellarAssetClient::new(&env, &payment_contract.address());

    let seller = Address::generate(&env);
    rwa_asset.mint(&seller, &SELLER_RWA_SUPPLY);

    // Slot 1 must be the deterministic winner the proof was generated for.
    let mut bidders = std::vec::Vec::new();
    for slot_index in 0..5 {
        let bidder = if slot_index == WINNER_INDEX as usize {
            deterministic_winner_address(&env)
        } else {
            Address::generate(&env)
        };
        payment_asset.mint(&bidder, &BIDDER_FUNDING);
        bidders.push(bidder);
    }

    TestWorld {
        rwa_token: rwa_contract.address(),
        payment_token: payment_contract.address(),
        env,
        auction_client,
        seller,
        bidders,
        payment_asset,
    }
}

fn create_standard_auction(world: &TestWorld) -> u64 {
    world.auction_client.create_auction(
        &world.seller,
        &world.rwa_token,
        &LOT_AMOUNT,
        &world.payment_token,
        &MAX_PRICE,
        &COMMIT_DEADLINE,
        &GRACE_PERIOD,
        &decimal_to_u256(&world.env, WHITELIST_ROOT_DECIMAL),
        &BytesN::from_array(&world.env, &[7u8; 32]),
    )
}

fn place_fixture_bids(world: &TestWorld, auction_id: u64) {
    for (slot_index, bidder) in world.bidders.iter().enumerate() {
        world.auction_client.place_bid(
            &auction_id,
            bidder,
            &decimal_to_u256(&world.env, COMMITMENT_DECIMALS[slot_index]),
            &Bytes::from_array(&world.env, &[0xAB; 79]),
        );
    }
}

fn warp_to(world: &TestWorld, timestamp: u64) {
    world
        .env
        .ledger()
        .with_mut(|ledger_info| ledger_info.timestamp = timestamp);
}

fn token_balance(env: &Env, token: &Address, holder: &Address) -> i128 {
    TokenClient::new(env, token).balance(holder)
}

// ---------------------------------------------------------------------------
// Poseidon compatibility checks (decision 1, GO of 2026-06-12)
// ---------------------------------------------------------------------------

#[test]
fn poseidon_matches_circomlib_vector() {
    let env = Env::default();
    // circom Poseidon([1, 2]), the standard circomlib vector.
    // sourceRef: ~/ref/rs-soroban-poseidon/src/tests/poseidon.rs and
    // circomlibjs buildPoseidon; decimal
    // 7853200120776062878684798364095072458815029376092732009249414926327459813530
    let expected = decimal_to_u256(
        &env,
        "7853200120776062878684798364095072458815029376092732009249414926327459813530",
    );
    let inputs = vec![&env, U256::from_u32(&env, 1), U256::from_u32(&env, 2)];
    let computed = soroban_poseidon::poseidon_hash::<3, soroban_sdk::crypto::bn254::Bn254Fr>(
        &env, &inputs,
    );
    assert_eq!(computed, expected);
}

#[test]
fn address_leaf_matches_js_fixture() {
    let env = Env::default();
    let winner = deterministic_winner_address(&env);
    let computed_leaf = address_leaf(&env, &winner);
    assert_eq!(computed_leaf, decimal_to_u256(&env, WINNER_LEAF_DECIMAL));
}

// ---------------------------------------------------------------------------
// Happy paths with conservation checks
// ---------------------------------------------------------------------------

#[test]
fn settle_happy_path_with_real_proof_and_sum_check() {
    let world = setup_world();
    let auction_id = create_standard_auction(&world);
    assert_eq!(auction_id, 1);
    place_fixture_bids(&world, auction_id);

    let contract_address = world.auction_client.address.clone();
    let deposits_held = token_balance(&world.env, &world.payment_token, &contract_address);
    assert_eq!(deposits_held, MAX_PRICE * 5);

    warp_to(&world, COMMIT_DEADLINE);
    let winner = deterministic_winner_address(&world.env);
    world.auction_client.settle(
        &auction_id,
        &WINNER_INDEX,
        &WINNING_PRICE,
        &winner,
        &contract_proof(&world.env),
    );

    // Conservation to the stroop: the contract holds nothing afterwards.
    assert_eq!(
        token_balance(&world.env, &world.payment_token, &contract_address),
        0
    );
    assert_eq!(
        token_balance(&world.env, &world.rwa_token, &contract_address),
        0
    );
    // Seller: clearing price in, lot out.
    assert_eq!(
        token_balance(&world.env, &world.payment_token, &world.seller),
        WINNING_PRICE
    );
    assert_eq!(
        token_balance(&world.env, &world.rwa_token, &world.seller),
        SELLER_RWA_SUPPLY - LOT_AMOUNT
    );
    // Winner: paid exactly winning_price net, holds the lot.
    assert_eq!(
        token_balance(&world.env, &world.payment_token, &winner),
        BIDDER_FUNDING - WINNING_PRICE
    );
    assert_eq!(
        token_balance(&world.env, &world.rwa_token, &winner),
        LOT_AMOUNT
    );
    // Losers: whole deposit back, no lot.
    for (slot_index, bidder) in world.bidders.iter().enumerate() {
        if slot_index != WINNER_INDEX as usize {
            assert_eq!(
                token_balance(&world.env, &world.payment_token, bidder),
                BIDDER_FUNDING
            );
        }
    }

    let auction_view = world.auction_client.get_auction(&auction_id);
    assert_eq!(auction_view.status, AuctionStatus::Settled);
}

#[test]
fn refund_all_returns_every_deposit_and_the_lot() {
    let world = setup_world();
    let auction_id = create_standard_auction(&world);
    place_fixture_bids(&world, auction_id);

    warp_to(&world, COMMIT_DEADLINE + GRACE_PERIOD);
    world.auction_client.refund_all(&auction_id);

    let contract_address = world.auction_client.address.clone();
    assert_eq!(
        token_balance(&world.env, &world.payment_token, &contract_address),
        0
    );
    assert_eq!(
        token_balance(&world.env, &world.rwa_token, &contract_address),
        0
    );
    assert_eq!(
        token_balance(&world.env, &world.rwa_token, &world.seller),
        SELLER_RWA_SUPPLY
    );
    for bidder in world.bidders.iter() {
        assert_eq!(
            token_balance(&world.env, &world.payment_token, bidder),
            BIDDER_FUNDING
        );
    }
    assert_eq!(
        world.auction_client.get_auction(&auction_id).status,
        AuctionStatus::Refunded
    );
}

#[test]
fn refund_works_with_zero_bids() {
    let world = setup_world();
    let auction_id = create_standard_auction(&world);
    warp_to(&world, COMMIT_DEADLINE + GRACE_PERIOD);
    world.auction_client.refund_all(&auction_id);
    assert_eq!(
        token_balance(&world.env, &world.rwa_token, &world.seller),
        SELLER_RWA_SUPPLY
    );
}

// ---------------------------------------------------------------------------
// Proof binding: replay and invalid material
// ---------------------------------------------------------------------------

#[test]
fn cross_auction_replay_proof_rejected() {
    let world = setup_world();
    let first_auction = create_standard_auction(&world);
    place_fixture_bids(&world, first_auction);
    // Second auction with identical commitments and bidders; only the
    // auction id differs, and the id is rebuilt from storage, never taken
    // from the caller.
    let second_auction = create_standard_auction(&world);
    assert_eq!(second_auction, 2);
    place_fixture_bids(&world, second_auction);

    warp_to(&world, COMMIT_DEADLINE);
    let winner = deterministic_winner_address(&world.env);

    // The real proof settles auction 1.
    world.auction_client.settle(
        &first_auction,
        &WINNER_INDEX,
        &WINNING_PRICE,
        &winner,
        &contract_proof(&world.env),
    );
    // Replaying it on auction 2 must fail the pairing check.
    let replay_result = world.auction_client.try_settle(
        &second_auction,
        &WINNER_INDEX,
        &WINNING_PRICE,
        &winner,
        &contract_proof(&world.env),
    );
    assert_eq!(replay_result, Err(Ok(AuctionError::ProofInvalid)));
}

#[test]
fn settle_rejects_proof_for_a_different_statement() {
    let world = setup_world();
    let auction_id = create_standard_auction(&world);
    place_fixture_bids(&world, auction_id);
    warp_to(&world, COMMIT_DEADLINE);
    // The days 3-4 demo proof is valid groth16 material for auction 42 with
    // different commitments: well formed, wrong statement.
    let result = world.auction_client.try_settle(
        &auction_id,
        &WINNER_INDEX,
        &WINNING_PRICE,
        &deterministic_winner_address(&world.env),
        &demo_proof(&world.env),
    );
    assert_eq!(result, Err(Ok(AuctionError::ProofInvalid)));
}

#[test]
fn settle_rejects_tampered_proof_bytes() {
    let world = setup_world();
    let auction_id = create_standard_auction(&world);
    place_fixture_bids(&world, auction_id);
    warp_to(&world, COMMIT_DEADLINE);

    let mut tampered = contract_proof(&world.env);
    let mut c_bytes = tampered.c.to_array();
    c_bytes[63] ^= 0x01;
    tampered.c = BytesN::from_array(&world.env, &c_bytes);

    let result = world.auction_client.try_settle(
        &auction_id,
        &WINNER_INDEX,
        &WINNING_PRICE,
        &deterministic_winner_address(&world.env),
        &tampered,
    );
    // A corrupted point is rejected by the host curve checks: a call
    // failure, deliberately distinct from a clean pairing false.
    assert_eq!(result, Err(Ok(AuctionError::VerifierCallFailed)));
}

// ---------------------------------------------------------------------------
// create_auction error paths
// ---------------------------------------------------------------------------

#[test]
fn create_rejects_bad_amounts_and_times() {
    let world = setup_world();
    let root = decimal_to_u256(&world.env, WHITELIST_ROOT_DECIMAL);
    let operator_key = BytesN::from_array(&world.env, &[7u8; 32]);

    let zero_lot = world.auction_client.try_create_auction(
        &world.seller,
        &world.rwa_token,
        &0,
        &world.payment_token,
        &MAX_PRICE,
        &COMMIT_DEADLINE,
        &GRACE_PERIOD,
        &root,
        &operator_key,
    );
    assert_eq!(zero_lot, Err(Ok(AuctionError::LotAmountNotPositive)));

    let zero_max = world.auction_client.try_create_auction(
        &world.seller,
        &world.rwa_token,
        &LOT_AMOUNT,
        &world.payment_token,
        &0,
        &COMMIT_DEADLINE,
        &GRACE_PERIOD,
        &root,
        &operator_key,
    );
    assert_eq!(zero_max, Err(Ok(AuctionError::MaxPriceNotPositive)));

    let oversized_max = world.auction_client.try_create_auction(
        &world.seller,
        &world.rwa_token,
        &LOT_AMOUNT,
        &world.payment_token,
        &((u64::MAX as i128) + 1),
        &COMMIT_DEADLINE,
        &GRACE_PERIOD,
        &root,
        &operator_key,
    );
    assert_eq!(oversized_max, Err(Ok(AuctionError::MaxPriceExceeds64Bits)));

    let past_deadline = world.auction_client.try_create_auction(
        &world.seller,
        &world.rwa_token,
        &LOT_AMOUNT,
        &world.payment_token,
        &MAX_PRICE,
        &START_TIME,
        &GRACE_PERIOD,
        &root,
        &operator_key,
    );
    assert_eq!(past_deadline, Err(Ok(AuctionError::DeadlineNotInFuture)));

    let zero_grace = world.auction_client.try_create_auction(
        &world.seller,
        &world.rwa_token,
        &LOT_AMOUNT,
        &world.payment_token,
        &MAX_PRICE,
        &COMMIT_DEADLINE,
        &0,
        &root,
        &operator_key,
    );
    assert_eq!(zero_grace, Err(Ok(AuctionError::GracePeriodZero)));
}

#[test]
fn create_escrows_the_lot() {
    let world = setup_world();
    let auction_id = create_standard_auction(&world);
    let contract_address = world.auction_client.address.clone();
    assert_eq!(auction_id, 1);
    assert_eq!(
        token_balance(&world.env, &world.rwa_token, &contract_address),
        LOT_AMOUNT
    );
    assert_eq!(
        token_balance(&world.env, &world.rwa_token, &world.seller),
        SELLER_RWA_SUPPLY - LOT_AMOUNT
    );
}

// ---------------------------------------------------------------------------
// place_bid error paths
// ---------------------------------------------------------------------------

#[test]
fn bid_error_paths() {
    let world = setup_world();
    let ciphertext = Bytes::from_array(&world.env, &[0xAB; 79]);
    let commitment_one = decimal_to_u256(&world.env, COMMITMENT_DECIMALS[0]);

    let unknown = world.auction_client.try_place_bid(
        &99,
        &world.bidders[0],
        &commitment_one,
        &ciphertext,
    );
    assert_eq!(unknown, Err(Ok(AuctionError::AuctionNotFound)));

    let auction_id = create_standard_auction(&world);

    let zero_commitment = world.auction_client.try_place_bid(
        &auction_id,
        &world.bidders[0],
        &U256::from_u32(&world.env, 0),
        &ciphertext,
    );
    assert_eq!(
        zero_commitment,
        Err(Ok(AuctionError::CommitmentIsEmptyMarker))
    );

    let oversized = world.auction_client.try_place_bid(
        &auction_id,
        &world.bidders[0],
        &commitment_one,
        &Bytes::from_array(&world.env, &[0xCD; 257]),
    );
    assert_eq!(oversized, Err(Ok(AuctionError::EncryptedBidTooLarge)));

    world
        .auction_client
        .place_bid(&auction_id, &world.bidders[0], &commitment_one, &ciphertext);
    let duplicate = world.auction_client.try_place_bid(
        &auction_id,
        &world.bidders[1],
        &commitment_one,
        &ciphertext,
    );
    assert_eq!(duplicate, Err(Ok(AuctionError::DuplicateCommitment)));

    // Fill the remaining 7 slots, then the 9th bid must fail.
    for extra_index in 0..7u32 {
        let filler = Address::generate(&world.env);
        world.payment_asset.mint(&filler, &BIDDER_FUNDING);
        world.auction_client.place_bid(
            &auction_id,
            &filler,
            &U256::from_u32(&world.env, 1_000 + extra_index),
            &ciphertext,
        );
    }
    let ninth_bidder = Address::generate(&world.env);
    world.payment_asset.mint(&ninth_bidder, &BIDDER_FUNDING);
    let ninth = world.auction_client.try_place_bid(
        &auction_id,
        &ninth_bidder,
        &U256::from_u32(&world.env, 9_999),
        &ciphertext,
    );
    assert_eq!(ninth, Err(Ok(AuctionError::BidsFull)));

    let late_auction = create_standard_auction(&world);
    warp_to(&world, COMMIT_DEADLINE);
    let late = world.auction_client.try_place_bid(
        &late_auction,
        &world.bidders[0],
        &commitment_one,
        &ciphertext,
    );
    assert_eq!(late, Err(Ok(AuctionError::BidAfterDeadline)));
}

#[test]
fn bid_rejects_after_settlement_and_records_auth() {
    let world = setup_world();
    let auction_id = create_standard_auction(&world);
    // env.auths() reflects only the most recent invocation, so the auth
    // assertion runs directly after the first bidder's own call.
    world.auction_client.place_bid(
        &auction_id,
        &world.bidders[0],
        &decimal_to_u256(&world.env, COMMITMENT_DECIMALS[0]),
        &Bytes::from_array(&world.env, &[0xAB; 79]),
    );
    let recorded_auths = world.env.auths();
    assert!(recorded_auths
        .iter()
        .any(|(authorizer, _invocation)| *authorizer == world.bidders[0]));

    for (slot_index, bidder) in world.bidders.iter().enumerate().skip(1) {
        world.auction_client.place_bid(
            &auction_id,
            bidder,
            &decimal_to_u256(&world.env, COMMITMENT_DECIMALS[slot_index]),
            &Bytes::from_array(&world.env, &[0xAB; 79]),
        );
    }

    warp_to(&world, COMMIT_DEADLINE);
    world.auction_client.settle(
        &auction_id,
        &WINNER_INDEX,
        &WINNING_PRICE,
        &deterministic_winner_address(&world.env),
        &contract_proof(&world.env),
    );

    let after_settle = world.auction_client.try_place_bid(
        &auction_id,
        &world.bidders[0],
        &U256::from_u32(&world.env, 4_242),
        &Bytes::from_array(&world.env, &[0xAB; 79]),
    );
    assert_eq!(after_settle, Err(Ok(AuctionError::AlreadySettled)));
}

// ---------------------------------------------------------------------------
// settle error paths
// ---------------------------------------------------------------------------

#[test]
fn settle_error_paths() {
    let world = setup_world();
    let winner = deterministic_winner_address(&world.env);
    let proof = contract_proof(&world.env);

    let unknown = world
        .auction_client
        .try_settle(&99, &WINNER_INDEX, &WINNING_PRICE, &winner, &proof);
    assert_eq!(unknown, Err(Ok(AuctionError::AuctionNotFound)));

    let auction_id = create_standard_auction(&world);
    place_fixture_bids(&world, auction_id);

    let too_early = world
        .auction_client
        .try_settle(&auction_id, &WINNER_INDEX, &WINNING_PRICE, &winner, &proof);
    assert_eq!(too_early, Err(Ok(AuctionError::SettleBeforeDeadline)));

    warp_to(&world, COMMIT_DEADLINE);

    let out_of_range = world
        .auction_client
        .try_settle(&auction_id, &5, &WINNING_PRICE, &winner, &proof);
    assert_eq!(out_of_range, Err(Ok(AuctionError::WinnerIndexOutOfRange)));

    let zero_price = world
        .auction_client
        .try_settle(&auction_id, &WINNER_INDEX, &0, &winner, &proof);
    assert_eq!(zero_price, Err(Ok(AuctionError::WinningPriceNotPositive)));

    let above_max = world.auction_client.try_settle(
        &auction_id,
        &WINNER_INDEX,
        &(MAX_PRICE + 1),
        &winner,
        &proof,
    );
    assert_eq!(above_max, Err(Ok(AuctionError::WinningPriceExceedsMax)));

    let wrong_address = world.auction_client.try_settle(
        &auction_id,
        &WINNER_INDEX,
        &WINNING_PRICE,
        &world.bidders[0],
        &proof,
    );
    assert_eq!(wrong_address, Err(Ok(AuctionError::WinnerAddressMismatch)));

    world
        .auction_client
        .settle(&auction_id, &WINNER_INDEX, &WINNING_PRICE, &winner, &proof);
    let second_settle = world
        .auction_client
        .try_settle(&auction_id, &WINNER_INDEX, &WINNING_PRICE, &winner, &proof);
    assert_eq!(second_settle, Err(Ok(AuctionError::AlreadySettled)));
}

#[test]
fn settle_rejects_after_refund() {
    let world = setup_world();
    let auction_id = create_standard_auction(&world);
    place_fixture_bids(&world, auction_id);
    warp_to(&world, COMMIT_DEADLINE + GRACE_PERIOD);
    world.auction_client.refund_all(&auction_id);

    let result = world.auction_client.try_settle(
        &auction_id,
        &WINNER_INDEX,
        &WINNING_PRICE,
        &deterministic_winner_address(&world.env),
        &contract_proof(&world.env),
    );
    assert_eq!(result, Err(Ok(AuctionError::AlreadyRefunded)));
}

// ---------------------------------------------------------------------------
// refund_all error paths
// ---------------------------------------------------------------------------

#[test]
fn refund_error_paths() {
    let world = setup_world();

    let unknown = world.auction_client.try_refund_all(&99);
    assert_eq!(unknown, Err(Ok(AuctionError::AuctionNotFound)));

    let auction_id = create_standard_auction(&world);
    place_fixture_bids(&world, auction_id);

    warp_to(&world, COMMIT_DEADLINE + GRACE_PERIOD - 1);
    let too_early = world.auction_client.try_refund_all(&auction_id);
    assert_eq!(too_early, Err(Ok(AuctionError::RefundTooEarly)));

    warp_to(&world, COMMIT_DEADLINE + GRACE_PERIOD);
    world.auction_client.refund_all(&auction_id);
    let second_refund = world.auction_client.try_refund_all(&auction_id);
    assert_eq!(second_refund, Err(Ok(AuctionError::AlreadyRefunded)));
}

#[test]
fn refund_rejects_after_settle() {
    let world = setup_world();
    let auction_id = create_standard_auction(&world);
    place_fixture_bids(&world, auction_id);
    warp_to(&world, COMMIT_DEADLINE);
    world.auction_client.settle(
        &auction_id,
        &WINNER_INDEX,
        &WINNING_PRICE,
        &deterministic_winner_address(&world.env),
        &contract_proof(&world.env),
    );
    warp_to(&world, COMMIT_DEADLINE + GRACE_PERIOD);
    let result = world.auction_client.try_refund_all(&auction_id);
    assert_eq!(result, Err(Ok(AuctionError::AlreadySettled)));
}

// ---------------------------------------------------------------------------
// Audit fix coverage (2026-06-12 finding 1): a trapping rwa token must never
// block deposit refunds, and the lot stays reclaimable.
// ---------------------------------------------------------------------------

// Minimal token double with a breakable transfer. No auth checks: this is a
// test-only stand-in for a malicious or broken seller token.
mod breakable_token {
    use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

    #[contracttype]
    #[derive(Clone)]
    pub enum TokenKey {
        Broken,
        Balance(Address),
    }

    #[contract]
    pub struct BreakableToken;

    #[contractimpl]
    impl BreakableToken {
        pub fn set_balance(env: Env, holder: Address, amount: i128) {
            env.storage()
                .persistent()
                .set(&TokenKey::Balance(holder), &amount);
        }

        pub fn set_broken(env: Env, broken: bool) {
            env.storage().instance().set(&TokenKey::Broken, &broken);
        }

        pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
            let is_broken: bool = env
                .storage()
                .instance()
                .get(&TokenKey::Broken)
                .unwrap_or(false);
            if is_broken {
                panic!("BreakableToken: transfers disabled");
            }
            let from_balance: i128 = env
                .storage()
                .persistent()
                .get(&TokenKey::Balance(from.clone()))
                .unwrap_or(0);
            let to_balance: i128 = env
                .storage()
                .persistent()
                .get(&TokenKey::Balance(to.clone()))
                .unwrap_or(0);
            assert!(from_balance >= amount, "BreakableToken: underfunded");
            env.storage()
                .persistent()
                .set(&TokenKey::Balance(from), &(from_balance - amount));
            env.storage()
                .persistent()
                .set(&TokenKey::Balance(to), &(to_balance + amount));
        }

        pub fn balance(env: Env, id: Address) -> i128 {
            env.storage()
                .persistent()
                .get(&TokenKey::Balance(id))
                .unwrap_or(0)
        }
    }
}

struct BreakableWorld {
    world: TestWorld,
    auction_id: u64,
    rwa_address: Address,
}

fn setup_breakable_lot_auction() -> BreakableWorld {
    let world = setup_world();
    let rwa_address = world
        .env
        .register(breakable_token::BreakableToken, ());
    let breakable_client =
        breakable_token::BreakableTokenClient::new(&world.env, &rwa_address);
    breakable_client.set_balance(&world.seller, &SELLER_RWA_SUPPLY);

    let auction_id = world.auction_client.create_auction(
        &world.seller,
        &rwa_address,
        &LOT_AMOUNT,
        &world.payment_token,
        &MAX_PRICE,
        &COMMIT_DEADLINE,
        &GRACE_PERIOD,
        &decimal_to_u256(&world.env, WHITELIST_ROOT_DECIMAL),
        &BytesN::from_array(&world.env, &[7u8; 32]),
    );
    place_fixture_bids(&world, auction_id);
    BreakableWorld {
        world,
        auction_id,
        rwa_address,
    }
}

#[test]
fn refund_returns_deposits_even_if_lot_transfer_traps() {
    let breakable = setup_breakable_lot_auction();
    let world = &breakable.world;
    let breakable_client =
        breakable_token::BreakableTokenClient::new(&world.env, &breakable.rwa_address);

    breakable_client.set_broken(&true);
    warp_to(world, COMMIT_DEADLINE + GRACE_PERIOD);
    world.auction_client.refund_all(&breakable.auction_id);

    // Every deposit is back even though the lot leg trapped.
    for bidder in world.bidders.iter() {
        assert_eq!(
            token_balance(&world.env, &world.payment_token, bidder),
            BIDDER_FUNDING
        );
    }
    let view = world.auction_client.get_auction(&breakable.auction_id);
    assert_eq!(view.status, AuctionStatus::Refunded);
    assert!(!view.lot_reclaimed);
    // The lot is still parked in escrow.
    assert_eq!(
        breakable_client.balance(&world.auction_client.address),
        LOT_AMOUNT
    );

    // Reclaim while the token is still broken: distinct error.
    let still_broken = world.auction_client.try_reclaim_lot(&breakable.auction_id);
    assert_eq!(still_broken, Err(Ok(AuctionError::LotTransferFailed)));

    // Token recovers; the retry hands the lot back to the seller.
    breakable_client.set_broken(&false);
    world.auction_client.reclaim_lot(&breakable.auction_id);
    assert_eq!(breakable_client.balance(&world.seller), SELLER_RWA_SUPPLY);
    assert!(world
        .auction_client
        .get_auction(&breakable.auction_id)
        .lot_reclaimed);

    let second_reclaim = world.auction_client.try_reclaim_lot(&breakable.auction_id);
    assert_eq!(second_reclaim, Err(Ok(AuctionError::LotAlreadyReclaimed)));
}

#[test]
fn reclaim_rejects_open_and_settled_auctions() {
    let world = setup_world();
    let auction_id = create_standard_auction(&world);
    place_fixture_bids(&world, auction_id);

    let open_reclaim = world.auction_client.try_reclaim_lot(&auction_id);
    assert_eq!(
        open_reclaim,
        Err(Ok(AuctionError::ReclaimRequiresRefundedAuction))
    );

    warp_to(&world, COMMIT_DEADLINE);
    world.auction_client.settle(
        &auction_id,
        &WINNER_INDEX,
        &WINNING_PRICE,
        &deterministic_winner_address(&world.env),
        &contract_proof(&world.env),
    );
    let settled_reclaim = world.auction_client.try_reclaim_lot(&auction_id);
    assert_eq!(
        settled_reclaim,
        Err(Ok(AuctionError::ReclaimRequiresRefundedAuction))
    );
}

#[test]
fn refund_marks_lot_reclaimed_on_the_happy_path() {
    let world = setup_world();
    let auction_id = create_standard_auction(&world);
    place_fixture_bids(&world, auction_id);
    warp_to(&world, COMMIT_DEADLINE + GRACE_PERIOD);
    world.auction_client.refund_all(&auction_id);
    assert!(world.auction_client.get_auction(&auction_id).lot_reclaimed);
    let reclaim_after_success = world.auction_client.try_reclaim_lot(&auction_id);
    assert_eq!(
        reclaim_after_success,
        Err(Ok(AuctionError::LotAlreadyReclaimed))
    );
}

// ---------------------------------------------------------------------------
// get_auction
// ---------------------------------------------------------------------------

#[test]
fn get_auction_views_and_not_found() {
    let world = setup_world();
    let unknown = world.auction_client.try_get_auction(&99);
    assert_eq!(unknown, Err(Ok(AuctionError::AuctionNotFound)));

    let auction_id = create_standard_auction(&world);
    place_fixture_bids(&world, auction_id);
    let view = world.auction_client.get_auction(&auction_id);
    assert_eq!(view.seller, world.seller);
    assert_eq!(view.max_price, MAX_PRICE);
    assert_eq!(view.bids.len(), 5);
    assert_eq!(view.status, AuctionStatus::Open);
    assert_eq!(
        view.bids.get(WINNER_INDEX).map(|winning_bid| winning_bid.bidder),
        Some(deterministic_winner_address(&world.env))
    );
}
