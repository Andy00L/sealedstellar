#!/usr/bin/env node
// format-args.js: converts snarkjs Groth16 artifacts (vkey.json, proof.json,
// public.json, curve bn128) into the byte layout the SealedStellar Soroban
// verifier expects, emitted as stellar CLI JSON argument strings.
//
// Byte layout sourceRef: rs-soroban-sdk@caddc8c367e8fd66a2a5962bcb0ca4850c23bf4a
// soroban-sdk/src/crypto/bn254.rs doc comments:
//   G1Affine: 64 bytes, be_bytes(X) || be_bytes(Y), flag bits unset.
//   G2Affine: 128 bytes, be_bytes(X) || be_bytes(Y), each Fp2 coordinate
//             encoded as be_bytes(c1) || be_bytes(c0).
// snarkjs emits each G2 coordinate as [c0, c1] (ffjavascript F2 order), so
// packG2 swaps the limbs. If on-chain verification ever fails while snarkjs
// verifies locally, audit this swap first (SEALEDSTELLAR_BUILD_PLAN.md
// section 6).
//
// Usage:
//   node format-args.js --vkey <vkey.json> --proof <proof.json> \
//     --public <public.json> --out <args.json>
// Vkey-only mode (deploy-time, before any proof exists):
//   node format-args.js --vkey <vkey.json> --out <args.json>

'use strict';

const fs = require('fs');

// sourceRef: ffjavascript src/bn128.js (snarkjs dependency): q is the BN254
// base field modulus, r the scalar field modulus.
const BN254_BASE_FIELD_MODULUS =
  21888242871839275222246405745257275088696311157297823662689037894645226208583n;
const BN254_SCALAR_FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function parseFieldElement(decimalText, fieldModulus, label) {
  if (typeof decimalText !== 'string' || decimalText.length === 0) {
    return { ok: false, reason: `${label}: missing decimal string` };
  }
  let parsed;
  try {
    parsed = BigInt(decimalText);
  } catch (conversionError) {
    return { ok: false, reason: `${label}: not a decimal integer: ${decimalText}` };
  }
  if (parsed < 0n) {
    return { ok: false, reason: `${label}: negative value rejected` };
  }
  if (parsed >= fieldModulus) {
    return { ok: false, reason: `${label}: value is not below the field modulus` };
  }
  return { ok: true, value: parsed };
}

function toBigEndianHex32(fieldValue) {
  // 32 bytes = 64 hex characters, zero padded on the left.
  return fieldValue.toString(16).padStart(64, '0');
}

function packG1(coordinates, label) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return { ok: false, reason: `${label}: expected [x, y, z] decimal array` };
  }
  if (coordinates.length >= 3 && coordinates[2] !== '1') {
    return {
      ok: false,
      reason: `${label}: expected affine z == "1", got "${coordinates[2]}"`,
    };
  }
  const xResult = parseFieldElement(coordinates[0], BN254_BASE_FIELD_MODULUS, `${label}.x`);
  if (!xResult.ok) {
    return xResult;
  }
  const yResult = parseFieldElement(coordinates[1], BN254_BASE_FIELD_MODULUS, `${label}.y`);
  if (!yResult.ok) {
    return yResult;
  }
  return { ok: true, value: toBigEndianHex32(xResult.value) + toBigEndianHex32(yResult.value) };
}

function packG2(coordinates, label) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return { ok: false, reason: `${label}: expected [[x_c0, x_c1], [y_c0, y_c1], z] array` };
  }
  if (
    coordinates.length >= 3 &&
    !(Array.isArray(coordinates[2]) && coordinates[2][0] === '1' && coordinates[2][1] === '0')
  ) {
    return { ok: false, reason: `${label}: expected affine z == ["1", "0"]` };
  }
  const limbLabels = [
    [`${label}.x.c0`, coordinates[0][0]],
    [`${label}.x.c1`, coordinates[0][1]],
    [`${label}.y.c0`, coordinates[1][0]],
    [`${label}.y.c1`, coordinates[1][1]],
  ];
  const parsedLimbs = {};
  for (const [limbLabel, limbText] of limbLabels) {
    const limbResult = parseFieldElement(limbText, BN254_BASE_FIELD_MODULUS, limbLabel);
    if (!limbResult.ok) {
      return limbResult;
    }
    parsedLimbs[limbLabel] = limbResult.value;
  }
  // Limb swap: host wants c1 || c0 per coordinate (see header comment).
  const packedHex =
    toBigEndianHex32(parsedLimbs[`${label}.x.c1`]) +
    toBigEndianHex32(parsedLimbs[`${label}.x.c0`]) +
    toBigEndianHex32(parsedLimbs[`${label}.y.c1`]) +
    toBigEndianHex32(parsedLimbs[`${label}.y.c0`]);
  return { ok: true, value: packedHex };
}

function buildVerificationKeyArg(vkeyJson) {
  if (vkeyJson.protocol !== 'groth16' || vkeyJson.curve !== 'bn128') {
    return {
      ok: false,
      reason: `vkey: expected protocol groth16 over bn128, got ${vkeyJson.protocol} over ${vkeyJson.curve}`,
    };
  }
  const alphaResult = packG1(vkeyJson.vk_alpha_1, 'vk_alpha_1');
  if (!alphaResult.ok) {
    return alphaResult;
  }
  const betaResult = packG2(vkeyJson.vk_beta_2, 'vk_beta_2');
  if (!betaResult.ok) {
    return betaResult;
  }
  const gammaResult = packG2(vkeyJson.vk_gamma_2, 'vk_gamma_2');
  if (!gammaResult.ok) {
    return gammaResult;
  }
  const deltaResult = packG2(vkeyJson.vk_delta_2, 'vk_delta_2');
  if (!deltaResult.ok) {
    return deltaResult;
  }
  if (!Array.isArray(vkeyJson.IC) || vkeyJson.IC.length < 1) {
    return { ok: false, reason: 'vkey: IC array missing or empty' };
  }
  const icHexValues = [];
  for (let icIndex = 0; icIndex < vkeyJson.IC.length; icIndex += 1) {
    const icResult = packG1(vkeyJson.IC[icIndex], `IC[${icIndex}]`);
    if (!icResult.ok) {
      return icResult;
    }
    icHexValues.push(icResult.value);
  }
  return {
    ok: true,
    value: {
      alpha: alphaResult.value,
      beta: betaResult.value,
      gamma: gammaResult.value,
      delta: deltaResult.value,
      ic: icHexValues,
    },
  };
}

function buildProofArg(proofJson) {
  if (proofJson.protocol !== 'groth16' || proofJson.curve !== 'bn128') {
    return {
      ok: false,
      reason: `proof: expected protocol groth16 over bn128, got ${proofJson.protocol} over ${proofJson.curve}`,
    };
  }
  const aResult = packG1(proofJson.pi_a, 'pi_a');
  if (!aResult.ok) {
    return aResult;
  }
  const bResult = packG2(proofJson.pi_b, 'pi_b');
  if (!bResult.ok) {
    return bResult;
  }
  const cResult = packG1(proofJson.pi_c, 'pi_c');
  if (!cResult.ok) {
    return cResult;
  }
  return { ok: true, value: { a: aResult.value, b: bResult.value, c: cResult.value } };
}

function buildPubSignalsArg(publicJson) {
  if (!Array.isArray(publicJson)) {
    return { ok: false, reason: 'public.json: expected an array of decimal strings' };
  }
  const signals = [];
  for (let signalIndex = 0; signalIndex < publicJson.length; signalIndex += 1) {
    const signalResult = parseFieldElement(
      publicJson[signalIndex],
      BN254_SCALAR_FIELD_MODULUS,
      `public[${signalIndex}]`,
    );
    if (!signalResult.ok) {
      return signalResult;
    }
    // The contract takes Vec<U256>; the stellar CLI parses U256 from decimal
    // strings, so the validated decimal text is passed through unchanged.
    signals.push(publicJson[signalIndex]);
  }
  return { ok: true, value: signals };
}

function readJsonFile(filePath, label) {
  let rawText;
  try {
    rawText = fs.readFileSync(filePath, 'utf8');
  } catch (readError) {
    return { ok: false, reason: `${label}: cannot read ${filePath}: ${readError.message}` };
  }
  try {
    return { ok: true, value: JSON.parse(rawText) };
  } catch (parseError) {
    return { ok: false, reason: `${label}: ${filePath} is not valid JSON: ${parseError.message}` };
  }
}

function parseCliArguments(argv) {
  const options = {};
  const flagNames = ['--vkey', '--proof', '--public', '--out'];
  for (let argIndex = 2; argIndex < argv.length; argIndex += 2) {
    const flagName = argv[argIndex];
    const flagValue = argv[argIndex + 1];
    if (!flagNames.includes(flagName) || flagValue === undefined) {
      return { ok: false, reason: `usage: node format-args.js --vkey <vkey.json> --proof <proof.json> --public <public.json> --out <args.json>` };
    }
    options[flagName.slice(2)] = flagValue;
  }
  for (const requiredName of ['vkey', 'out']) {
    if (!options[requiredName]) {
      return { ok: false, reason: `missing required flag --${requiredName}` };
    }
  }
  // proof and public travel together: either both (full mode) or neither
  // (vkey-only mode used at deploy time).
  if (Boolean(options.proof) !== Boolean(options.public)) {
    return { ok: false, reason: 'flags --proof and --public must be supplied together' };
  }
  return { ok: true, value: options };
}

function main() {
  const optionsResult = parseCliArguments(process.argv);
  if (!optionsResult.ok) {
    console.error(`[main] ${optionsResult.reason}`);
    process.exitCode = 1;
    return;
  }
  const options = optionsResult.value;

  const vkeyFile = readJsonFile(options.vkey, 'vkey');
  if (!vkeyFile.ok) {
    console.error(`[main] ${vkeyFile.reason}`);
    process.exitCode = 1;
    return;
  }
  const verificationKeyResult = buildVerificationKeyArg(vkeyFile.value);
  if (!verificationKeyResult.ok) {
    console.error(`[main] ${verificationKeyResult.reason}`);
    process.exitCode = 1;
    return;
  }

  const outputDocument = {
    verification_key: verificationKeyResult.value,
  };

  if (options.proof) {
    const proofFile = readJsonFile(options.proof, 'proof');
    if (!proofFile.ok) {
      console.error(`[main] ${proofFile.reason}`);
      process.exitCode = 1;
      return;
    }
    const publicFile = readJsonFile(options.public, 'public');
    if (!publicFile.ok) {
      console.error(`[main] ${publicFile.reason}`);
      process.exitCode = 1;
      return;
    }
    const proofResult = buildProofArg(proofFile.value);
    if (!proofResult.ok) {
      console.error(`[main] ${proofResult.reason}`);
      process.exitCode = 1;
      return;
    }
    const pubSignalsResult = buildPubSignalsArg(publicFile.value);
    if (!pubSignalsResult.ok) {
      console.error(`[main] ${pubSignalsResult.reason}`);
      process.exitCode = 1;
      return;
    }
    if (pubSignalsResult.value.length + 1 !== verificationKeyResult.value.ic.length) {
      console.error(
        `[main] public signal count ${pubSignalsResult.value.length} does not match vkey IC length ${verificationKeyResult.value.ic.length} (expected IC length = signals + 1)`,
      );
      process.exitCode = 1;
      return;
    }
    outputDocument.proof = proofResult.value;
    outputDocument.pub_signals = pubSignalsResult.value;
  }

  try {
    fs.writeFileSync(options.out, `${JSON.stringify(outputDocument, null, 2)}\n`, 'utf8');
  } catch (writeError) {
    console.error(`[main] cannot write ${options.out}: ${writeError.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`[main] wrote ${options.out}`);
  console.log('[main] deploy (constructor) argument:');
  console.log(`  --verification_key '${JSON.stringify(outputDocument.verification_key)}'`);
  if (outputDocument.proof) {
    console.log('[main] invoke arguments:');
    console.log(`  -- verify --proof '${JSON.stringify(outputDocument.proof)}' --pub_signals '${JSON.stringify(outputDocument.pub_signals)}'`);
  }
}

main();
