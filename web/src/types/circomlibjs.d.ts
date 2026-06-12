// Minimal typings for the circomlibjs surface this app uses (the package
// ships no types). Poseidon inputs are field elements; outputs come back in
// the library's internal representation and convert through F.toObject.
declare module 'circomlibjs' {
  export type PoseidonFieldElement = Uint8Array

  export interface PoseidonField {
    toObject(element: PoseidonFieldElement): bigint
  }

  export interface Poseidon {
    (inputs: ReadonlyArray<bigint | number | string>): PoseidonFieldElement
    F: PoseidonField
  }

  export function buildPoseidon(): Promise<Poseidon>
}
