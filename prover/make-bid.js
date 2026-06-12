#!/usr/bin/env node
// Bidder-side material for one sealed bid (plan section 2.2):
//   commitment = Poseidon3(price, salt, auctionId)  (circomlibjs)
//   ciphertext = nonce(24) || ephemeralPub(32) || box(price(8 BE) || salt(31))
// encrypted to the operator's box public key. The salt and price are written
// to the bid file only (the bidder's local backup); neither is printed.
//
// Usage: node make-bid.js --price <int> --auction-id <int> \
//   --operator-pub <hex32> --out <bid.json>
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const nacl = require('tweetnacl');

const { createPoseidonHasher, computeBidCommitment } = require('../circuits/test/helpers.js');

// Frozen ciphertext layout, mirrored in operator-decrypt.js.
const NONCE_BYTES = 24;
const EPHEMERAL_PUB_BYTES = 32;
const PRICE_BYTES = 8;
const SALT_BYTES = 31;

function parseCliArguments(argv) {
  const options = {};
  const flagNames = ['--price', '--auction-id', '--operator-pub', '--out'];
  for (let argIndex = 2; argIndex < argv.length; argIndex += 2) {
    const flagName = argv[argIndex];
    const flagValue = argv[argIndex + 1];
    if (!flagNames.includes(flagName) || flagValue === undefined) {
      return {
        ok: false,
        reason:
          'usage: node make-bid.js --price <int> --auction-id <int> --operator-pub <hex32> --out <bid.json>',
      };
    }
    options[flagName.slice(2).replace('-id', 'Id').replace('-pub', 'Pub')] = flagValue;
  }
  for (const requiredName of ['price', 'auctionId', 'operatorPub', 'out']) {
    if (!options[requiredName]) {
      return { ok: false, reason: `missing required flag for ${requiredName}` };
    }
  }
  return { ok: true, value: options };
}

async function main() {
  const optionsResult = parseCliArguments(process.argv);
  if (!optionsResult.ok) {
    console.error(`[main] ${optionsResult.reason}`);
    process.exitCode = 1;
    return;
  }
  const options = optionsResult.value;

  const bidPrice = BigInt(options.price);
  if (bidPrice <= 0n || bidPrice > 0xffffffffffffffffn) {
    console.error('[main] price must be a positive integer below 2^64');
    process.exitCode = 1;
    return;
  }
  const auctionId = BigInt(options.auctionId);
  const operatorPublicKey = Buffer.from(options.operatorPub, 'hex');
  if (operatorPublicKey.length !== EPHEMERAL_PUB_BYTES) {
    console.error('[main] operator public key must be 32 hex bytes');
    process.exitCode = 1;
    return;
  }

  const saltBytes = crypto.randomBytes(SALT_BYTES);
  const saltValue = BigInt(`0x${saltBytes.toString('hex')}`);

  const hasher = await createPoseidonHasher();
  const commitment = computeBidCommitment(hasher, bidPrice, saltValue, auctionId);

  const plainPayload = Buffer.alloc(PRICE_BYTES + SALT_BYTES);
  plainPayload.writeBigUInt64BE(bidPrice, 0);
  saltBytes.copy(plainPayload, PRICE_BYTES);

  const ephemeralKeyPair = nacl.box.keyPair();
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const boxBytes = nacl.box(
    plainPayload,
    nonce,
    operatorPublicKey,
    ephemeralKeyPair.secretKey,
  );
  const encryptedBid = Buffer.concat([
    nonce,
    Buffer.from(ephemeralKeyPair.publicKey),
    Buffer.from(boxBytes),
  ]);

  const bidDocument = {
    auctionId: auctionId.toString(),
    priceDecimal: bidPrice.toString(),
    saltDecimal: saltValue.toString(),
    commitmentDecimal: commitment.toString(),
    encryptedBidHex: encryptedBid.toString('hex'),
  };
  try {
    fs.writeFileSync(options.out, `${JSON.stringify(bidDocument, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch (writeError) {
    console.error(`[main] cannot write bid file: ${writeError.message}`);
    process.exitCode = 1;
    return;
  }
  // Commitment and ciphertext are public on-chain material; price and salt
  // stay in the file.
  console.log(
    `[main] bid material ready (ciphertext ${encryptedBid.length} bytes, commitment computed)`,
  );
}

main();
