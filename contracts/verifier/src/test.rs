#![cfg(test)]
extern crate std;

use num_bigint::BigUint;
use soroban_sdk::{BytesN, Env, Vec, U256};

use crate::{Groth16Verifier, Groth16VerifierClient, Proof, VerifierError, VerificationKey};

// Fixture provenance: generated 2026-06-11 by the Phase 0 spike in /tmp/spike
// (multiplier_spike.circom: private factorLeft * factorRight == public
// product; witness 3 * 11 = 33), snarkjs 0.7.6, curve bn128,
// powersOfTau28_hez_final_14.ptau (blake2b verified). Decimal strings copied
// verbatim from the spike build/vkey.json and build/proof.json. Regenerate by
// rerunning the plan section 5 Phase 0 spike commands.

const ALPHA_X: &str = "20491192805390485299153009773594534940189261866228447918068658471970481763042";
const ALPHA_Y: &str = "9383485363053290200918347156157836566562967994039712273449902621266178545958";

const BETA_X_C0: &str = "6375614351688725206403948262868962793625744043794305715222011528459656738731";
const BETA_X_C1: &str = "4252822878758300859123897981450591353533073413197771768651442665752259397132";
const BETA_Y_C0: &str = "10505242626370262277552901082094356697409835680220590971873171140371331206856";
const BETA_Y_C1: &str = "21847035105528745403288232691147584728191162732299865338377159692350059136679";

const GAMMA_X_C0: &str = "10857046999023057135944570762232829481370756359578518086990519993285655852781";
const GAMMA_X_C1: &str = "11559732032986387107991004021392285783925812861821192530917403151452391805634";
const GAMMA_Y_C0: &str = "8495653923123431417604973247489272438418190587263600148770280649306958101930";
const GAMMA_Y_C1: &str = "4082367875863433681332203403145435568316851327593401208105741076214120093531";

const DELTA_X_C0: &str = "20298055375359246453550435242520149601843343735642675880816944818115446111546";
const DELTA_X_C1: &str = "21750319278958126062912389071832537915962630753922819100296084779152404219072";
const DELTA_Y_C0: &str = "15150107786200188695384176832514483475076667865152183915135582183240730498468";
const DELTA_Y_C1: &str = "11801941487797344750703998953860786724941969724327058566905271670935872999673";

const IC0_X: &str = "6819801395408938350212900248749732364821477541620635511814266536599629892365";
const IC0_Y: &str = "9092252330033992554755034971584864587974280972948086568597554018278609861372";
const IC1_X: &str = "17882351432929302592725330552407222299541667716607588771282887857165175611387";
const IC1_Y: &str = "18907419617206324833977586007131055763810739835484972981819026406579664278293";

const PROOF_A_X: &str = "1930305718772080458660788338709817947747415581784827540666830228432332634667";
const PROOF_A_Y: &str = "5800954213724766307476020995620307819958632723747739379182226983036942487144";

const PROOF_B_X_C0: &str = "11301039612326017526678361139459603754105669011229468980941436395749447625572";
const PROOF_B_X_C1: &str = "17376912577435191032823204583649373981108679437865325038487278092304337013941";
const PROOF_B_Y_C0: &str = "15799475427669972708524955679777701507284398692872052399638811628065604419786";
const PROOF_B_Y_C1: &str = "7986921037096376027854932795889094372855400550349389094676030658540149207413";

const PROOF_C_X: &str = "20770426916119793970428680904384934863348559210091552274883315573194683190510";
const PROOF_C_Y: &str = "3087231544322887912370514102747068564223598717957734633550954869308038058782";

// Expected public signal: product = 33 (from the spike build/public.json).
const PUBLIC_PRODUCT: u32 = 33;

fn decimal_to_be_32(decimal_text: &str) -> [u8; 32] {
    let parsed = BigUint::parse_bytes(decimal_text.as_bytes(), 10)
        .expect("fixture is a decimal integer");
    let raw_bytes = parsed.to_bytes_be();
    assert!(raw_bytes.len() <= 32, "fixture exceeds 32 bytes");
    let mut padded = [0u8; 32];
    padded[32 - raw_bytes.len()..].copy_from_slice(&raw_bytes);
    padded
}

// G1 layout: be_bytes(X) || be_bytes(Y).
// sourceRef: rs-soroban-sdk@caddc8c soroban-sdk/src/crypto/bn254.rs
fn g1_fixture(env: &Env, x_decimal: &str, y_decimal: &str) -> BytesN<64> {
    let mut packed = [0u8; 64];
    packed[..32].copy_from_slice(&decimal_to_be_32(x_decimal));
    packed[32..].copy_from_slice(&decimal_to_be_32(y_decimal));
    BytesN::from_array(env, &packed)
}

// G2 layout: each Fp2 coordinate is be_bytes(c1) || be_bytes(c0), so the
// snarkjs [c0, c1] limb order is swapped here. If on-chain verification ever
// fails while snarkjs verifies locally, audit this swap first (plan section 6).
// sourceRef: rs-soroban-sdk@caddc8c soroban-sdk/src/crypto/bn254.rs
fn g2_fixture(
    env: &Env,
    x_c0_decimal: &str,
    x_c1_decimal: &str,
    y_c0_decimal: &str,
    y_c1_decimal: &str,
) -> BytesN<128> {
    let mut packed = [0u8; 128];
    packed[..32].copy_from_slice(&decimal_to_be_32(x_c1_decimal));
    packed[32..64].copy_from_slice(&decimal_to_be_32(x_c0_decimal));
    packed[64..96].copy_from_slice(&decimal_to_be_32(y_c1_decimal));
    packed[96..].copy_from_slice(&decimal_to_be_32(y_c0_decimal));
    BytesN::from_array(env, &packed)
}

fn fixture_verification_key(env: &Env) -> VerificationKey {
    VerificationKey {
        alpha: g1_fixture(env, ALPHA_X, ALPHA_Y),
        beta: g2_fixture(env, BETA_X_C0, BETA_X_C1, BETA_Y_C0, BETA_Y_C1),
        gamma: g2_fixture(env, GAMMA_X_C0, GAMMA_X_C1, GAMMA_Y_C0, GAMMA_Y_C1),
        delta: g2_fixture(env, DELTA_X_C0, DELTA_X_C1, DELTA_Y_C0, DELTA_Y_C1),
        ic: Vec::from_array(
            env,
            [
                g1_fixture(env, IC0_X, IC0_Y),
                g1_fixture(env, IC1_X, IC1_Y),
            ],
        ),
    }
}

fn fixture_proof(env: &Env) -> Proof {
    Proof {
        a: g1_fixture(env, PROOF_A_X, PROOF_A_Y),
        b: g2_fixture(
            env,
            PROOF_B_X_C0,
            PROOF_B_X_C1,
            PROOF_B_Y_C0,
            PROOF_B_Y_C1,
        ),
        c: g1_fixture(env, PROOF_C_X, PROOF_C_Y),
    }
}

fn register_verifier(env: &Env) -> Groth16VerifierClient<'_> {
    let contract_id = env.register(Groth16Verifier, (fixture_verification_key(env),));
    Groth16VerifierClient::new(env, &contract_id)
}

#[test]
fn verify_accepts_valid_proof() {
    let env = Env::default();
    let client = register_verifier(&env);

    let signals = Vec::from_array(&env, [U256::from_u32(&env, PUBLIC_PRODUCT)]);
    assert_eq!(client.verify(&fixture_proof(&env), &signals), true);
}

#[test]
fn verify_rejects_wrong_public_signal() {
    let env = Env::default();
    let client = register_verifier(&env);

    // 34 instead of 33: well formed, must fail the pairing check.
    let signals = Vec::from_array(&env, [U256::from_u32(&env, PUBLIC_PRODUCT + 1)]);
    assert_eq!(client.verify(&fixture_proof(&env), &signals), false);
}

#[test]
fn verify_rejects_signal_count_mismatch() {
    let env = Env::default();
    let client = register_verifier(&env);

    let signals = Vec::from_array(
        &env,
        [
            U256::from_u32(&env, PUBLIC_PRODUCT),
            U256::from_u32(&env, 1),
        ],
    );
    let result = client.try_verify(&fixture_proof(&env), &signals);
    assert_eq!(result, Err(Ok(VerifierError::PublicInputCountMismatch)));
}
