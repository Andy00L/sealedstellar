#![no_std]
// Groth16 verifier over the BN254 host functions (CAP-0074 pairing, CAP-0080
// arithmetic; live on Stellar testnet since Protocols 25/26).
//
// Adapted from the BLS12-381 example contract:
// sourceRef: ~/ref/soroban-examples-main/groth16_verifier/src/lib.rs
// Changes versus that example, per SEALEDSTELLAR_BUILD_PLAN.md section 5
// (days 1-2): curve swapped to BN254, the verification key is stored once at
// deploy time through the constructor instead of being passed on every call,
// and verify reads it from instance storage.
//
// Byte encodings (sourceRef: rs-soroban-sdk@caddc8c367e8fd66a2a5962bcb0ca4850c23bf4a
// soroban-sdk/src/crypto/bn254.rs doc comments):
//   G1Affine: 64 bytes, be_bytes(X) || be_bytes(Y), flag bits unset.
//   G2Affine: 128 bytes, be_bytes(X) || be_bytes(Y), each Fp2 coordinate
//             encoded as be_bytes(c1) || be_bytes(c0).
//   Fr: U256 scalar, reduced mod the BN254 scalar field by the host.
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    symbol_short, vec, BytesN, Env, Symbol, Vec, U256,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VerifierError {
    /// Instance storage holds no verification key. Should be unreachable
    /// because the constructor stores one, but kept distinct so a storage
    /// archival or migration bug is identifiable.
    VerificationKeyMissing = 1,
    /// The number of supplied public signals does not match the circuit the
    /// stored verification key was generated for (expected ic.len() - 1).
    PublicInputCountMismatch = 2,
}

#[derive(Clone)]
#[contracttype]
pub struct VerificationKey {
    pub alpha: BytesN<64>,
    pub beta: BytesN<128>,
    pub gamma: BytesN<128>,
    pub delta: BytesN<128>,
    pub ic: Vec<BytesN<64>>,
}

#[derive(Clone)]
#[contracttype]
pub struct Proof {
    pub a: BytesN<64>,
    pub b: BytesN<128>,
    pub c: BytesN<64>,
}

// Instance storage key for the verification key stored by the constructor.
const VERIFICATION_KEY_KEY: Symbol = symbol_short!("VK");

#[contract]
pub struct Groth16Verifier;

#[contractimpl]
impl Groth16Verifier {
    /// Stores the circuit verification key exactly once, at deploy time.
    pub fn __constructor(env: Env, verification_key: VerificationKey) {
        env.storage()
            .instance()
            .set(&VERIFICATION_KEY_KEY, &verification_key);
    }

    /// Returns Ok(true) when the proof verifies against the stored key and
    /// the supplied public signals, Ok(false) when the proof is well formed
    /// but does not verify, and a distinct error per malformed-input mode.
    pub fn verify(
        env: Env,
        proof: Proof,
        pub_signals: Vec<U256>,
    ) -> Result<bool, VerifierError> {
        let verification_key: VerificationKey = env
            .storage()
            .instance()
            .get(&VERIFICATION_KEY_KEY)
            .ok_or(VerifierError::VerificationKeyMissing)?;

        if pub_signals.len() + 1 != verification_key.ic.len() {
            return Err(VerifierError::PublicInputCountMismatch);
        }

        let bn254 = env.crypto().bn254();

        // vk_x = ic[0] + sum(pub_signals[i] * ic[i + 1])
        let ic_base = match verification_key.ic.get(0) {
            Some(first_ic) => first_ic,
            None => return Err(VerifierError::PublicInputCountMismatch),
        };
        let mut vk_x = Bn254G1Affine::from_bytes(ic_base);
        for (signal, ic_bytes) in pub_signals
            .iter()
            .zip(verification_key.ic.iter().skip(1))
        {
            let ic_point = Bn254G1Affine::from_bytes(ic_bytes);
            let scaled_ic = bn254.g1_mul(&ic_point, &Bn254Fr::from_u256(signal));
            vk_x = bn254.g1_add(&vk_x, &scaled_ic);
        }

        // Groth16 acceptance: e(-A, B) * e(alpha, beta) * e(vk_x, gamma)
        // * e(C, delta) == 1, identical structure to the BLS12-381 example.
        let negated_a = -Bn254G1Affine::from_bytes(proof.a);
        let g1_terms = vec![
            &env,
            negated_a,
            Bn254G1Affine::from_bytes(verification_key.alpha),
            vk_x,
            Bn254G1Affine::from_bytes(proof.c),
        ];
        let g2_terms = vec![
            &env,
            Bn254G2Affine::from_bytes(proof.b),
            Bn254G2Affine::from_bytes(verification_key.beta),
            Bn254G2Affine::from_bytes(verification_key.gamma),
            Bn254G2Affine::from_bytes(verification_key.delta),
        ];

        Ok(bn254.pairing_check(g1_terms, g2_terms))
    }
}

mod test;
