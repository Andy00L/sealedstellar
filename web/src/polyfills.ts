// Browser polyfills, imported first in main.tsx so the globals exist before
// any dependency evaluates. circomlibjs (bid sealing) and parts of
// @stellar/stellar-sdk reference Node's Buffer and global, which the browser
// does not provide; without this the app crashes at module load with
// "Buffer is not defined".
import { Buffer } from 'buffer'

const globalScope = globalThis as typeof globalThis & {
  Buffer?: typeof Buffer
  global?: typeof globalThis
}
if (!globalScope.Buffer) {
  globalScope.Buffer = Buffer
}
if (!globalScope.global) {
  globalScope.global = globalThis
}
