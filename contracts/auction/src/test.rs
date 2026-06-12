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
// Fixture provenance. Generated 2026-06-12 by
// circuits/scripts/make-contract-fixture.js plus snarkjs prove and
// prover/format-args.js (files build/contract_fixture_meta.json and
// build/contract_args.json). The proof is REAL: it verifies the honest
// 5-bid story (prices 1200, 3500, 990, 2750, 3100; winner slot 1 at 3500)
// for auction_id 1, whitelist root below, winner address key bytes 0x42
// repeated. The demo proof is the equally real days 3-4 proof bound to
// auction_id 42; it is valid groth16 material for a DIFFERENT statement.
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
const WINNING_PRICE: i128 = 3500;

const CONTRACT_PROOF_A_HEX: &str = "28b088f15fa510c121a25754d20b34cc632283c724d56612f5424e26be36a2a6211fb4d23f0502fce3cd1ec430f872debe7c4c40ec78a0f63081307dfcab339a";
const CONTRACT_PROOF_B_HEX: &str = "2810972e80175b85e1f9c33520f9f6751442159b640ac274a6630be646819c9b077a4d4127014627d6de559e591b87112c0c55655e511e1afd627dd7a0e17f2b0b30e42bc490e25cb7663bda4121cf1c4c5b9a8956b730e07527dd845a36374b28c52b3339722ff49ec6c1bef642ba7c16150aa32ccb520ff5aafa65751916c9";
const CONTRACT_PROOF_C_HEX: &str = "2bcb0396fc724ee7705149a895e271d2c8d8cb7cb4b869d0fccf4417555d924e248c9c657b4528b12328b73e88e105193b795b0b6dc661e6746d6e7fc8c71b53";

const DEMO_PROOF_A_HEX: &str = "11fea3651da0a8d6f2ca69258d69d5ff00def1ec2b805885b1a8e2428f8a31081aec23593dc119dbd77147f24677d432489b2883d2750760d29297d202061af9";
const DEMO_PROOF_B_HEX: &str = "1758e4ccc065464a88c02cfdbde7eb1701a0f5bf2f5949631d50637386a133262c6166c7ddb4797e7e8ec083b3acc96998cd6853e4e2639455aa71bb04f337c827fd288ba3989d11d31839d970ce2dde945c714d0e4fe14dc8f5d1483db3c47a063e307a50c7f3263ced41784b0084301101de7d18bef44170bf8dbb20755449";
const DEMO_PROOF_C_HEX: &str = "1673213ec142a5e23aeef4694907532358cf902d627a7654223eba191f88e225281ac550933ac1c81661db34578cb04bbf6c2b3fce837cecab545565fd7ba4cf";

const VKEY_ALPHA_HEX: &str = "2d4d9aa7e302d9df41749d5507949d05dbea33fbb16c643b22f599a2be6df2e214bedd503c37ceb061d8ec60209fe345ce89830a19230301f076caff004d1926";
const VKEY_BETA_HEX: &str = "0967032fcbf776d1afc985f88877f182d38480a653f2decaa9794cbc3bf3060c0e187847ad4c798374d0d6732bf501847dd68bc0e071241e0213bc7fc13db7ab304cfbd1e08a704a99f5e847d93f8c3caafddec46b7a0d379da69a4d112346a71739c1b1a457a8c7313123d24d2f9192f896b7c63eea05a9d57f06547ad0cec8";
const VKEY_GAMMA_HEX: &str = "198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa";
const VKEY_DELTA_HEX: &str = "2e84d23ae4882d960c5adcf7f4cb3f9072ca640f4870a9dccff17b00ec1104e32f870d1e0cca2a4785f563bcfed8cdc89d4d213b4c1129bd4b6c265526dc9fd303c2e47fb70bffb173318a00525f92384c4554487bcfa4c3b46d6c6dc7df1ed50a0fa3dadfe1d42977c9fc12d32913ba49d58c14eebee12344b4e7e0f3b3676e";
const VKEY_IC_HEX: [&str; 14] = [
    "2c3cd3c22b09c7537412e20afc202e96b1aef351efe186f130e5b25faa28aa462de886c95dd50a08d25032faa4ba3b342c90f55fad3819ed1a5ef9fb78a024e7",
    "1dfa7137721e579b4de7f535ea66febd1e4a3e19e0eb986f38c51aff5c04d520175c9314aee67b0b6df76439adec4198e6856d608e10125a0c4783bf2244f84b",
    "15a0654ec33991aea86c839cb3bcecb400da9a1f65581df721a8714b1453db8618ebf92b70b096bf394e9d52071ecb50d9871673c071c0dc137fd4c6e5674340",
    "1597b655982023c67d5bcdea238496975fc503da9401cbb30a4aa4155f02b5a6069063355a81e6b12d82425e79881d3997947cab89ec3375b86636d2704f5a05",
    "25d9ca455c18a9dfced69bea7d281ced2acc19c883cd3b5a2010059cadf9cb962a367786863a4b3a57676b5e11abfb0a1ac85ff34c7099a4e4604aafd681a7f9",
    "2ec63a30689ec28cde33687717516839eac01e0e0fed9d6ff25e050439a4ba97073715bfffc260902c71257cc5c9620461cda7e4cf5500dea67d2a8a19236159",
    "075001d21ca6299ccb0f0c37a7a7d2e946ad00067bb1776620f61193e7e431c613caac9830406f17dbba0c789c819126e7e58c068a12acc1898ed42f398b5d93",
    "22ff329862ebd61f957c8e584484b53f398a501e61cfc497570812a005152c0012c9344df9efca10bbf42e9656e903b95162fff6f2115089dc095bcd314e4a2f",
    "0161f0eef235fc406827df82be754d585cc74948667af09cae8d7bdb6273e4b9083e461c2a2f1f68b70f47adf15c5e4b7f7fc49edb1b7cfbfb08f5b854b45ca8",
    "03768ba25a40e8a2bee8c0025ec12131196775cae6eef196018d9700557dc5f909f11bb50028ede74a2395dd9aa2afedcdf92bd722536541ee61189a939b72ea",
    "05ea4bb47012e83ee8b4fabb41da8f61796b9b133245baafc97925240e7110b90e760bd487cd13c4e0c1ac7822c56e8e7b9a99dae8df6748a2c8e5fd10dfab1e",
    "01312b05dcabf6e6572fed1f48f05489240cb699fcb3ab28be370ca2ad7fa1c62762a94413de6e8e582c509b73924759d8e5d74a3f1a1b02e5ad7c0408dac2a0",
    "0607361e3ccba4d8653acc36eb1a1b98b9c28cc28b7e5d024c1d5c3d2bf8889b1c0ca23fee3ac0c910a71a3671fc3506390844aee0229d70b72c973eda89e388",
    "23f2e8211ca973619582060b7de10a4787b9b16f4155b551f338f301c0ad77532126a6faafa8a42692b627d6a05d0a1a8a280fd100198c6dcb9ade64cb30feb4",
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
