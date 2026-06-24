// Copies the circuit witness wasm and the Groth16 proving key into
// web/public/circuit so the browser prover (snarkjs) can fetch them at
// runtime. Run automatically by predev/prebuild. The copies are gitignored
// (derived from circuits/build, which is the committed source of truth).
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const circuitBuildDir = resolve(scriptDir, '../../circuits/build')
const outputDir = resolve(scriptDir, '../public/circuit')

// [source relative to circuits/build, destination name under public/circuit]
const CIRCUIT_ASSETS = [
  ['auction_winner_js/auction_winner.wasm', 'auction_winner.wasm'],
  ['aw_final.zkey', 'auction_winner.zkey'],
]

await mkdir(outputDir, { recursive: true })
for (const [sourceRelative, destinationName] of CIRCUIT_ASSETS) {
  const sourcePath = resolve(circuitBuildDir, sourceRelative)
  await stat(sourcePath) // fail loudly if the build artifact is missing
  await copyFile(sourcePath, resolve(outputDir, destinationName))
  console.log(`[copy-circuit] ${destinationName}`)
}
