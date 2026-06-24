// Minimal typings for the snarkjs surface the browser prover uses (the
// package ships no types). groth16.fullProve runs the witness generator
// (wasm) and the Groth16 prover (zkey) and returns the proof + public signals.
declare module 'snarkjs' {
  export type Groth16Proof = {
    pi_a: string[]
    pi_b: string[][]
    pi_c: string[]
    protocol: string
    curve: string
  }

  export const groth16: {
    fullProve(
      input: Record<string, unknown>,
      wasmFile: string,
      zkeyFile: string,
    ): Promise<{ proof: Groth16Proof; publicSignals: string[] }>
    verify(
      verificationKey: Record<string, unknown>,
      publicSignals: string[],
      proof: Groth16Proof,
    ): Promise<boolean>
  }
}
