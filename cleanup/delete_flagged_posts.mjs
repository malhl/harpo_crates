#!/usr/bin/env node

/**
 * Bluesky Flagged Post Deletion Script
 *
 * Usage:
 *   node delete_flagged_posts.mjs
 *
 * Before running:
 *   1. Go to https://bsky.app/settings/app-passwords
 *   2. Create a new App Password
 *   3. Set environment variables:
 *        export BSKY_HANDLE="mal-content.bsky.social"
 *        export BSKY_APP_PASSWORD="xxxx-xxxx-xxxx-xxxx"
 *
 * Options:
 *   --dry-run    Preview what would be deleted without actually deleting
 *   --yes        Skip confirmation prompt
 */

import { readFileSync } from "fs";
import { createInterface } from "readline";

const HANDLE = "mal-content.bsky.social";
const APP_PASSWORD = "n6ni-rmly-h2vo-aih4";
const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_CONFIRM = process.argv.includes("--yes");
const PDS = "https://bsky.social";

if (!HANDLE || !APP_PASSWORD) {
  console.error("Error: Set BSKY_HANDLE and BSKY_APP_PASSWORD environment variables.");
  console.error("");
  console.error("  export BSKY_HANDLE=\"mal-content.bsky.social\"");
  console.error("  export BSKY_APP_PASSWORD=\"xxxx-xxxx-xxxx-xxxx\"");
  console.error("");
  console.error("Create an app password at: https://bsky.app/settings/app-passwords");
  process.exit(1);
}

async function createSession() {
  const resp = await fetch(`${PDS}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: HANDLE, password: APP_PASSWORD }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Authentication failed: ${err}`);
  }

  return resp.json();
}

async function deleteRecord(accessJwt, did, rkey) {
  const resp = await fetch(`${PDS}/xrpc/com.atproto.repo.deleteRecord`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessJwt}`,
    },
    body: JSON.stringify({
      repo: did,
      collection: "app.bsky.feed.post",
      rkey,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Delete failed for ${rkey}: ${err}`);
  }
}

async function refreshSession(refreshJwt) {
  const resp = await fetch(`${PDS}/xrpc/com.atproto.server.refreshSession`, {
    method: "POST",
    headers: { Authorization: `Bearer ${refreshJwt}` },
  });

  if (!resp.ok) {
    throw new Error("Session refresh failed");
  }

  return resp.json();
}

function extractRkey(uri) {
  // at://did:plc:xxx/app.bsky.feed.post/RKEY
  const parts = uri.split("/");
  return parts[parts.length - 1];
}

async function confirm(message) {
  if (SKIP_CONFIRM) return true;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().startsWith("y"));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  // Load URIs
  let uris;
  try {
    uris = JSON.parse(readFileSync("posts_to_delete_aggressive.json", "utf8"));
  } catch {
    console.error("Error: posts_to_delete_aggressive.json not found. Run aggressive_scan.mjs first.");
    process.exit(1);
  }

  console.log(`Found ${uris.length} posts to delete.`);

  if (DRY_RUN) {
    console.log("[DRY RUN] Would delete the following posts:");
    for (const uri of uris) {
      console.log(`  ${uri}`);
    }
    console.log(`\n[DRY RUN] ${uris.length} posts would be deleted. No changes made.`);
    return;
  }

  const ok = await confirm(
    `\nThis will permanently delete ${uris.length} posts from @${HANDLE}.\nThis action CANNOT be undone. Continue? (y/N) `
  );
  if (!ok) {
    console.log("Aborted.");
    return;
  }

  // Authenticate
  console.log("Authenticating...");
  let session = await createSession();
  let { accessJwt, refreshJwt, did } = session;
  console.log(`Authenticated as ${did}`);

  let deleted = 0;
  let failed = 0;
  let tokenRefreshCounter = 0;

  for (const uri of uris) {
    const rkey = extractRkey(uri);

    // Refresh token every 500 requests to avoid expiry
    tokenRefreshCounter++;
    if (tokenRefreshCounter >= 500) {
      try {
        console.log("Refreshing session token...");
        session = await refreshSession(refreshJwt);
        accessJwt = session.accessJwt;
        refreshJwt = session.refreshJwt;
        tokenRefreshCounter = 0;
      } catch (err) {
        console.error("Token refresh failed, re-authenticating...");
        session = await createSession();
        accessJwt = session.accessJwt;
        refreshJwt = session.refreshJwt;
        tokenRefreshCounter = 0;
      }
    }

    try {
      await deleteRecord(accessJwt, did, rkey);
      deleted++;

      if (deleted % 50 === 0) {
        console.log(`Progress: ${deleted}/${uris.length} deleted (${failed} failed)`);
      }

      // Rate limiting: ~3 requests/second to be safe
      await sleep(350);
    } catch (err) {
      failed++;
      console.error(`  Failed: ${uri} - ${err.message}`);

      // If we get rate limited, back off
      if (err.message.includes("RateLimit") || err.message.includes("429")) {
        console.log("Rate limited. Waiting 60 seconds...");
        await sleep(60000);
        // Retry
        try {
          await deleteRecord(accessJwt, did, rkey);
          deleted++;
          failed--; // undo the failure count
        } catch {
          // still failed, move on
        }
      }
    }
  }

  console.log(`\nDone!`);
  console.log(`  Deleted: ${deleted}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total: ${uris.length}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
