#!/usr/bin/env node
// Fetches BidPlaced events for one auction from Soroban RPC and writes the
// public bid material (slot, bidder, commitment, ciphertext) sorted by slot.
// This is the operator's only data source besides the decryption key: bids
// are recovered from chain events, no off-chain channel (plan section 2.2).
//
// Usage: node fetch-bid-events.js --rpc <url> --contract <C...> \
//   --start-ledger <int> --auction-id <int> --out <events.json>
'use strict';

const fs = require('fs');
const StellarSdk = require('@stellar/stellar-sdk');

// Fixed topic emitted by the #[contractevent] BidPlaced struct (snake case
// of the struct name). sourceRef: contracts/auction/src/lib.rs.
const BID_PLACED_TOPIC = 'bid_placed';

function parseCliArguments(argv) {
  const options = {};
  const flagNames = ['--rpc', '--contract', '--start-ledger', '--auction-id', '--out'];
  for (let argIndex = 2; argIndex < argv.length; argIndex += 2) {
    const flagName = argv[argIndex];
    const flagValue = argv[argIndex + 1];
    if (!flagNames.includes(flagName) || flagValue === undefined) {
      return {
        ok: false,
        reason:
          'usage: node fetch-bid-events.js --rpc <url> --contract <C...> --start-ledger <int> --auction-id <int> --out <events.json>',
      };
    }
    const optionKey = flagName
      .slice(2)
      .replace('-ledger', 'Ledger')
      .replace('-id', 'Id');
    options[optionKey] = flagValue;
  }
  for (const requiredName of ['rpc', 'contract', 'startLedger', 'auctionId', 'out']) {
    if (!options[requiredName]) {
      return { ok: false, reason: `missing required flag for ${requiredName}` };
    }
  }
  return { ok: true, value: options };
}

// RPC implementations differ on whether topics and values arrive as parsed
// xdr objects or base64 strings; normalize both to native values.
function scValToNativeDefensive(rawValue) {
  if (typeof rawValue === 'string') {
    return StellarSdk.scValToNative(StellarSdk.xdr.ScVal.fromXDR(rawValue, 'base64'));
  }
  return StellarSdk.scValToNative(rawValue);
}

async function fetchAllEvents(server, contractId, startLedger) {
  // The RPC paginates by ledger range, not by matches: an empty page with a
  // cursor means "nothing in this chunk, keep scanning". Only a missing
  // cursor (or the page bound) ends the walk.
  const collected = [];
  let cursor;
  for (let pageIndex = 0; pageIndex < 30; pageIndex += 1) {
    const request = cursor
      ? { filters: [{ type: 'contract', contractIds: [contractId] }], cursor, limit: 200 }
      : {
          startLedger: Number(startLedger),
          filters: [{ type: 'contract', contractIds: [contractId] }],
          limit: 200,
        };
    const response = await server.getEvents(request);
    collected.push(...(response.events || []));
    if (!response.cursor) {
      break;
    }
    cursor = response.cursor;
  }
  return collected;
}

async function main() {
  const optionsResult = parseCliArguments(process.argv);
  if (!optionsResult.ok) {
    console.error(`[main] ${optionsResult.reason}`);
    process.exitCode = 1;
    return;
  }
  const options = optionsResult.value;
  const wantedAuctionId = BigInt(options.auctionId);

  const server = new StellarSdk.rpc.Server(options.rpc);
  let rawEvents;
  try {
    rawEvents = await fetchAllEvents(server, options.contract, options.startLedger);
  } catch (rpcError) {
    console.error(`[main] getEvents failed: ${rpcError.message}`);
    process.exitCode = 1;
    return;
  }

  const bids = [];
  for (const rawEvent of rawEvents) {
    const topics = (rawEvent.topic || []).map(scValToNativeDefensive);
    if (topics.length < 2 || topics[0] !== BID_PLACED_TOPIC) {
      continue;
    }
    if (BigInt(topics[1]) !== wantedAuctionId) {
      continue;
    }
    const eventData = scValToNativeDefensive(rawEvent.value);
    bids.push({
      slotIndex: Number(eventData.slot_index),
      bidder: eventData.bidder,
      commitmentDecimal: BigInt(eventData.commitment).toString(),
      encryptedBidHex: Buffer.from(eventData.encrypted_bid).toString('hex'),
    });
  }
  bids.sort((firstBid, secondBid) => firstBid.slotIndex - secondBid.slotIndex);

  const outputDocument = { auctionId: wantedAuctionId.toString(), bids };
  try {
    fs.writeFileSync(options.out, `${JSON.stringify(outputDocument, null, 2)}\n`, 'utf8');
  } catch (writeError) {
    console.error(`[main] cannot write ${options.out}: ${writeError.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[main] fetched ${bids.length} bid events for auction ${wantedAuctionId}`);
}

main();
