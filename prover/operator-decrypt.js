#!/usr/bin/env node
// Operator-side decryption of the on-chain bid ciphertexts. Each decrypted
// (price, salt) pair is verified by recomputing the Poseidon commitment
// against the on-chain value before it is accepted. Decrypted values are
// written to the output file only; nothing secret is printed.
//
// Usage: node operator-decrypt.js --secret-file <keyfile.json> \
//   --bids-file <events.json> --out <decrypted.json>
'use strict';

const fs = require('fs');
const nacl = require('tweetnacl');

const { createPoseidonHasher, computeBidCommitment } = require('../circuits/test/helpers.js');

// Frozen ciphertext layout, mirrored from make-bid.js.
const NONCE_BYTES = 24;
const EPHEMERAL_PUB_BYTES = 32;
const PRICE_BYTES = 8;
const SALT_BYTES = 31;

function parseCliArguments(argv) {
  const options = {};
  const flagNames = ['--secret-file', '--bids-file', '--out'];
  for (let argIndex = 2; argIndex < argv.length; argIndex += 2) {
    const flagName = argv[argIndex];
    const flagValue = argv[argIndex + 1];
    if (!flagNames.includes(flagName) || flagValue === undefined) {
      return {
        ok: false,
        reason:
          'usage: node operator-decrypt.js --secret-file <keyfile.json> --bids-file <events.json> --out <decrypted.json>',
      };
    }
    options[flagName.slice(2).replace('-file', 'File')] = flagValue;
  }
  for (const requiredName of ['secretFile', 'bidsFile', 'out']) {
    if (!options[requiredName]) {
      return { ok: false, reason: `missing required flag for ${requiredName}` };
    }
  }
  return { ok: true, value: options };
}

function decryptOneBid(encryptedBidHex, operatorSecretKey) {
  const encryptedBid = Buffer.from(encryptedBidHex, 'hex');
  const minimumLength = NONCE_BYTES + EPHEMERAL_PUB_BYTES + PRICE_BYTES + SALT_BYTES;
  if (encryptedBid.length < minimumLength) {
    return { ok: false, reason: `ciphertext too short: ${encryptedBid.length} bytes` };
  }
  const nonce = encryptedBid.subarray(0, NONCE_BYTES);
  const ephemeralPublicKey = encryptedBid.subarray(NONCE_BYTES, NONCE_BYTES + EPHEMERAL_PUB_BYTES);
  const boxBytes = encryptedBid.subarray(NONCE_BYTES + EPHEMERAL_PUB_BYTES);
  const opened = nacl.box.open(boxBytes, nonce, ephemeralPublicKey, operatorSecretKey);
  if (!opened) {
    return { ok: false, reason: 'box authentication failed' };
  }
  const openedBuffer = Buffer.from(opened);
  if (openedBuffer.length !== PRICE_BYTES + SALT_BYTES) {
    return { ok: false, reason: `unexpected payload length ${openedBuffer.length}` };
  }
  const price = openedBuffer.readBigUInt64BE(0);
  const saltValue = BigInt(`0x${openedBuffer.subarray(PRICE_BYTES).toString('hex')}`);
  return { ok: true, value: { price, saltValue } };
}

async function main() {
  const optionsResult = parseCliArguments(process.argv);
  if (!optionsResult.ok) {
    console.error(`[main] ${optionsResult.reason}`);
    process.exitCode = 1;
    return;
  }
  const options = optionsResult.value;

  let keyDocument;
  let eventsDocument;
  try {
    keyDocument = JSON.parse(fs.readFileSync(options.secretFile, 'utf8'));
    eventsDocument = JSON.parse(fs.readFileSync(options.bidsFile, 'utf8'));
  } catch (readError) {
    console.error(`[main] cannot read inputs: ${readError.message}`);
    process.exitCode = 1;
    return;
  }
  const operatorSecretKey = Buffer.from(keyDocument.secretKeyHex, 'hex');
  const auctionId = BigInt(eventsDocument.auctionId);

  const hasher = await createPoseidonHasher();
  const decryptedBids = [];
  for (const eventBid of eventsDocument.bids) {
    const decryptResult = decryptOneBid(eventBid.encryptedBidHex, operatorSecretKey);
    if (!decryptResult.ok) {
      console.error(`[main] slot ${eventBid.slotIndex}: ${decryptResult.reason}`);
      process.exitCode = 1;
      return;
    }
    const { price, saltValue } = decryptResult.value;
    const recomputedCommitment = computeBidCommitment(hasher, price, saltValue, auctionId);
    if (recomputedCommitment.toString() !== eventBid.commitmentDecimal) {
      console.error(
        `[main] slot ${eventBid.slotIndex}: decrypted payload does not match the on-chain commitment`,
      );
      process.exitCode = 1;
      return;
    }
    decryptedBids.push({
      slotIndex: eventBid.slotIndex,
      bidder: eventBid.bidder,
      commitmentDecimal: eventBid.commitmentDecimal,
      priceDecimal: price.toString(),
      saltDecimal: saltValue.toString(),
    });
  }

  const outputDocument = { auctionId: auctionId.toString(), bids: decryptedBids };
  try {
    fs.writeFileSync(options.out, `${JSON.stringify(outputDocument, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch (writeError) {
    console.error(`[main] cannot write ${options.out}: ${writeError.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `[main] decrypted ${decryptedBids.length} bids, all commitments verified against chain`,
  );
}

main();
