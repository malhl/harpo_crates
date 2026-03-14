#!/usr/bin/env node

/**
 * Bluesky DM Scanner - Finds conversations with deleted/deactivated accounts
 * and pulls the full message history.
 *
 * Usage:
 *   node deleted_dms.mjs --handle your.handle.here --password xxxx-xxxx-xxxx-xxxx
 */

import { writeFileSync } from "fs";

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

const HANDLE = getArg("--handle");
const PASSWORD = getArg("--password");
const PDS = "https://bsky.social";
const PUBLIC_API = "https://public.api.bsky.app";

if (!HANDLE || !PASSWORD) {
  console.error("Bluesky DM Scanner");
  console.error("Finds conversations with deleted/deactivated accounts and pulls the full message history.");
  console.error("");
  console.error("Usage:");
  console.error("  node deleted_dms.mjs --handle <handle> --password <password>");
  console.error("");
  console.error("Arguments:");
  console.error("  --handle    Your Bluesky handle (e.g. yourname.bsky.social)");
  console.error("  --password  Your Bluesky account password");
  console.error("");
  console.error("Note: App passwords do NOT have chat/DM access. Use your real account password.");
  console.error("Output is saved to deleted_account_dms.txt in the current directory.");
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createSession() {
  const resp = await fetch(`${PDS}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: HANDLE, password: PASSWORD }),
  });
  if (!resp.ok) throw new Error(`Auth failed: ${await resp.text()}`);
  return resp.json();
}

const CHAT_PROXY = "did:web:api.bsky.chat#bsky_chat";

function getPdsEndpoint(session) {
  // Extract the real PDS endpoint from the DID document in the session
  const didDoc = session.didDoc;
  if (didDoc && didDoc.service) {
    for (const svc of didDoc.service) {
      if (svc.id === "#atproto_pds" || svc.type === "AtprotoPersonalDataServer") {
        return svc.serviceEndpoint;
      }
    }
  }
  return PDS; // fallback
}

async function listConversations(pdsUrl, accessJwt) {
  const convos = [];
  let cursor = undefined;

  while (true) {
    let url = `${pdsUrl}/xrpc/chat.bsky.convo.listConvos?limit=100`;
    if (cursor) url += "&cursor=" + encodeURIComponent(cursor);

    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessJwt}`,
        "atproto-proxy": CHAT_PROXY,
      },
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`listConvos failed: ${err}`);
    }

    const data = await resp.json();
    convos.push(...(data.convos || []));

    if (!data.cursor || (data.convos || []).length === 0) break;
    cursor = data.cursor;
    await sleep(200);
  }

  return convos;
}

async function getMessages(pdsUrl, accessJwt, convoId) {
  const messages = [];
  let cursor = undefined;

  while (true) {
    let url = `${pdsUrl}/xrpc/chat.bsky.convo.getMessages?convoId=${encodeURIComponent(convoId)}&limit=100`;
    if (cursor) url += "&cursor=" + encodeURIComponent(cursor);

    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessJwt}`,
        "atproto-proxy": CHAT_PROXY,
      },
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`getMessages failed: ${err}`);
    }

    const data = await resp.json();
    messages.push(...(data.messages || []));

    if (!data.cursor || (data.messages || []).length === 0) break;
    cursor = data.cursor;
    await sleep(200);
  }

  return messages;
}

async function lookupOldHandle(did) {
  try {
    const resp = await fetch(`https://plc.directory/${encodeURIComponent(did)}/log/audit`);
    if (!resp.ok) return null;
    const log = await resp.json();
    // Walk backwards through the audit log to find the most recent handle
    for (let i = log.length - 1; i >= 0; i--) {
      const entry = log[i];
      const handles = entry.operation?.alsoKnownAs || [];
      for (const aka of handles) {
        // Format is "at://handle"
        const match = aka.match(/^at:\/\/(.+)$/);
        if (match) return match[1];
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function checkProfile(did) {
  try {
    const resp = await fetch(
      `${PUBLIC_API}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`
    );
    if (resp.ok) {
      const data = await resp.json();
      const isGone = data.handle === "handle.invalid";
      let oldHandle = null;
      if (isGone) {
        oldHandle = await lookupOldHandle(did);
      }
      return {
        exists: true,
        handle: data.handle,
        oldHandle,
        displayName: data.displayName || "",
        deactivated: isGone,
      };
    }
    // Account doesn't exist — try PLC directory for old handle
    const oldHandle = await lookupOldHandle(did);
    return { exists: false, deactivated: true, oldHandle };
  } catch {
    return { exists: false, deactivated: true, oldHandle: null };
  }
}

async function main() {
  console.log("Authenticating...");
  const session = await createSession();
  const { accessJwt, did: myDid } = session;
  const pdsUrl = getPdsEndpoint(session);
  console.log(`Authenticated as ${myDid}`);
  console.log(`PDS endpoint: ${pdsUrl}\n`);

  console.log("Fetching all conversations...");
  const convos = await listConversations(pdsUrl, accessJwt);
  console.log(`Found ${convos.length} conversations.\n`);

  // Check each conversation's members for deleted accounts
  console.log("Checking member account statuses...");
  const deletedConvos = [];

  for (let i = 0; i < convos.length; i++) {
    const convo = convos[i];
    const members = convo.members || [];
    const otherMembers = members.filter((m) => m.did !== myDid);

    for (const member of otherMembers) {
      const profile = await checkProfile(member.did);

      if (!profile.exists || profile.deactivated) {
        deletedConvos.push({
          convoId: convo.id,
          memberDid: member.did,
          memberHandle: profile.oldHandle || member.handle || "unknown",
          memberDisplayName: member.displayName || "",
          profileStatus: profile,
          lastMessage: convo.lastMessage?.text || "",
          lastMessageDate: convo.lastMessage?.sentAt || "",
        });
      }
    }

    if ((i + 1) % 20 === 0) {
      process.stderr.write(`  Checked ${i + 1}/${convos.length} conversations...\n`);
    }
    await sleep(150);
  }

  console.log(`\nFound ${deletedConvos.length} conversations with deleted/deactivated accounts.\n`);

  if (deletedConvos.length === 0) {
    console.log("No conversations with deleted accounts found.");
    return;
  }

  // Pull full message history for each
  console.log("Pulling full message history...\n");
  const fullConvos = [];

  for (const convo of deletedConvos) {
    const displayName = convo.memberDisplayName
      ? `${convo.memberDisplayName} (@${convo.memberHandle})`
      : `@${convo.memberHandle}`;
    console.log(`\n${"═".repeat(60)}`);
    console.log(`  DM with ${displayName}`);
    console.log(`  DID: ${convo.memberDid}`);
    console.log(`  Status: ${convo.profileStatus.exists ? "deactivated" : "deleted"}`);
    console.log(`${"═".repeat(60)}\n`);

    try {
      const messages = await getMessages(pdsUrl, accessJwt, convo.convoId);

      const myHandle = HANDLE;
      const formattedMessages = messages
        .filter((m) => m.$type === "chat.bsky.convo.defs#messageView")
        .map((m) => ({
          sender: m.sender?.did === myDid ? myHandle : convo.memberHandle,
          senderDid: m.sender?.did,
          isMe: m.sender?.did === myDid,
          text: m.text || "",
          sentAt: m.sentAt || "",
        }))
        .reverse(); // chronological order

      fullConvos.push({
        memberDid: convo.memberDid,
        memberHandle: convo.memberHandle,
        memberDisplayName: convo.memberDisplayName,
        messageCount: formattedMessages.length,
        messages: formattedMessages,
      });

      console.log(`  ${formattedMessages.length} messages\n`);

      // Print the conversation like a chat log
      let lastDate = "";
      for (const msg of formattedMessages) {
        const date = msg.sentAt.split("T")[0];
        const time = msg.sentAt.split("T")[1]?.substring(0, 8) || "";

        // Print date separator when the day changes
        if (date !== lastDate) {
          console.log(`\n  ── ${date} ${"─".repeat(40)}\n`);
          lastDate = date;
        }

        const name = msg.isMe ? `you` : `@${msg.sender}`;
        const lines = msg.text.split("\n");
        console.log(`  ${time}  ${name}:`);
        for (const line of lines) {
          console.log(`              ${line}`);
        }
        console.log("");
      }
    } catch (err) {
      console.error(`  Error fetching messages: ${err.message}\n`);
    }

    await sleep(300);
  }

  // Build text output
  const totalMessages = fullConvos.reduce((sum, c) => sum + c.messageCount, 0);
  const lines = [];

  lines.push(`BLUESKY DM SCAN — Deleted/Deactivated Accounts`);
  lines.push(`Scanned: ${new Date().toISOString().split("T")[0]}`);
  lines.push(`Conversations: ${fullConvos.length}`);
  lines.push(`Total messages: ${totalMessages}`);
  lines.push("");

  for (const convo of fullConvos) {
    const displayName = convo.memberDisplayName
      ? `${convo.memberDisplayName} (@${convo.memberHandle})`
      : `@${convo.memberHandle}`;

    lines.push("═".repeat(60));
    lines.push(`DM with ${displayName}`);
    lines.push(`DID: ${convo.memberDid}`);
    lines.push(`Messages: ${convo.messageCount}`);
    lines.push("═".repeat(60));
    lines.push("");

    let lastDate = "";
    for (const msg of convo.messages) {
      const date = msg.sentAt.split("T")[0];
      const time = msg.sentAt.split("T")[1]?.substring(0, 8) || "";

      if (date !== lastDate) {
        lines.push(`── ${date} ${"─".repeat(44)}`);
        lines.push("");
        lastDate = date;
      }

      const name = msg.isMe ? "you" : `@${msg.sender}`;
      lines.push(`${time}  ${name}:`);
      for (const line of msg.text.split("\n")) {
        lines.push(`            ${line}`);
      }
      lines.push("");
    }

    lines.push("");
  }

  const outFile = "deleted_account_dms.txt";
  writeFileSync(outFile, lines.join("\n"));
  console.log(`\nSaved ${fullConvos.length} conversations to ${outFile}`);

  console.log(`\n=== SUMMARY ===`);
  console.log(`Conversations with deleted accounts: ${fullConvos.length}`);
  console.log(`Total messages: ${totalMessages}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
