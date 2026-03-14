#!/usr/bin/env node

/**
 * Bluesky Post Scanner & Cleaner
 *
 * Scans all posts for content that could be problematic for a
 * public trust clearance vetting, then optionally deletes them.
 *
 * Usage:
 *   node bsky_cleaner.mjs --handle yourname.bsky.social --scan
 *   node bsky_cleaner.mjs --handle yourname.bsky.social --delete --password xxxx-xxxx-xxxx-xxxx
 *   node bsky_cleaner.mjs --handle yourname.bsky.social --scan --delete --password xxxx-xxxx-xxxx-xxxx
 *
 * Options:
 *   --handle <handle>       Bluesky handle (required)
 *   --password <password>   App password (required for --delete)
 *   --scan                  Run all scans and generate cleanup list
 *   --delete                Delete posts in posts_to_cleanup.json
 *   --dry-run               Preview deletions without executing
 *   --yes                   Skip confirmation prompts
 *   --output <dir>          Output directory for results (default: ./bsky_scan_results)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { createInterface } from "readline";
import { join } from "path";

// --- CLI Parsing ---

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}
function hasFlag(name) {
  return args.includes(name);
}

const HANDLE = getArg("--handle");
const PASSWORD = getArg("--password");
const DO_SCAN = hasFlag("--scan");
const DO_DELETE = hasFlag("--delete");
const DRY_RUN = hasFlag("--dry-run");
const SKIP_CONFIRM = hasFlag("--yes");
const OUTPUT_DIR = getArg("--output") || "./bsky_scan_results";
const PDS = "https://bsky.social";
const PUBLIC_API = "https://public.api.bsky.app";

if (!HANDLE) {
  console.error("Usage: node bsky_cleaner.mjs --handle <handle> [--scan] [--delete --password <app_password>]");
  process.exit(1);
}
if (!DO_SCAN && !DO_DELETE) {
  console.error("Specify --scan and/or --delete");
  process.exit(1);
}
if (DO_DELETE && !PASSWORD) {
  console.error("--delete requires --password <app_password>");
  console.error("Create one at: https://bsky.app/settings/app-passwords");
  process.exit(1);
}

if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function out(filename) {
  return join(OUTPUT_DIR, filename);
}

// --- Categories ---

const textCategories = {
  "Drug references": /\b(weed|marijuana|cannabis|edible|gummies|thc|cbd|shrooms|mushroom|lsd|acid trip|mdma|molly|cocaine|coke zero|coke|heroin|meth|420|blunt|joint|bong|stoned|high af|drug|dab|dispensary|smok(e|ing|ed)|pot |vape|vaping|ket |ketamine|adderall|adderal|oxy|oxycodone|fentanyl|trip(ping|ped)|dosed|dosing|hallucin|psychedelic|psilocybin|ayahuasca|rohypnol|disco nap)\b/i,
  "Alcohol concerns": /\b(drunk|wasted|hammered|blackout|black out|blacked out|trashed|plastered|smashed|shitfaced|binge drink|too many drinks|hangover|hungover|sloshed|tipsy|buzzed|booze|cocktail|margarita|tequila|whiskey|bourbon|vodka|beer|wine|sake|mezcal|shots|drink(ing|s)|drank too|day drinking)\b/i,
  "Anti-government": /\b(fuck the (gov|police|cops|feds|cia|fbi)|acab|all cops|abolish|defund|burn it down|overthrow|revolution|insurrection|coup|anti.?police|class traitor|eat the rich|guillotine|comrade|praxis|direct action|anarch|riot|dismantle|oppression|oppressive|corrupt|oligarch|gerontocracy|failed state|failing state|police state|surveillance state)\b/i,
  "Sexual/NSFW text": /\b(nsfw|porn|onlyfans|only fans|sex work|hooker|escort|bdsm|kink|fetish|horny|nude|nudes|dick pic|titties|tiddies|booty|thirst trap|fap|jerk off|cum |cumm|orgasm|bulge|jockstrap|lewd|slutty|slut |thirsty|topless|shirtless|wank|erotic|erection|boner|cock|suck(ing|ed) (off|dick)|blow.?job|rimm|power bottom|bara |twink|bear community|hookup|hook up|grindr|scruff|cruising|pup play|leather|harness|frot|breed|raw(dogg)|load|seed|hole|sling|pig )\b/i,
  "Criminal/illegal": /\b(steal|stole|stolen|shoplifted|shoplifting|fraud|scam|pirat(e|ing)|illegal|arrested|jail|prison|probation|parole|crime|criminal|felony|misdemeanor|convicted|indicted|warrant|trespass|vandal|graffiti|smuggl|contraband|tax (fraud|evasion)|launder|embezzl)\b/i,
  "Heavy profanity": /\b(fuck|fucking|fucked|shit|bullshit|bitch|asshole|bastard|cunt|wtf|stfu|gtfo|motherfuck|goddamn|dipshit|dumbass|jackass|twat)\b/i,
  "Mental health": /\b(suicid|kill myself|want to die|kms|end it all|self harm|cutting myself|depressed|depression|anxiety|bipolar|therapy|therapist|mental health|mental illness|breakdown|burnout|burn out|medicated|unmedicated|panic attack|dissociat|ptsd|trauma)\b/i,
  "Political": /\b(trump|biden|harris|kamala|desantis|obama|pelosi|mcconnell|aoc|bernie|sanders|maga|gop|republican|democrat|congress|senat(or|e)|supreme court|scotus|roe v|abortion|immigra|deportat|border wall|ice raid|doge|elon musk|executive order|impeach|insurrection|jan(uary)? 6|capitol|election|vot(e|ing|er)|liberal|conservative|progressive|left.?wing|right.?wing|leftist|antifa|blm|black lives|trans (right|kid|people|ban|law)|lgbtq|queer right|pride month|drag ban|book ban|gun control|2nd amendment|nra|defund|protest|activist|union|labor|strike|capitalism|capitalist|socialist|socialism|billionaire|oligarch|roe v wade|dobbs|civil right|dei|woke|cancel culture|ukraine|russia|putin|china|gaza|israel|palestin|nato|war crime|military|pentagon|dhs|fbi|cia|nsa|national guard|fascis|nazi|white suprem|supremacist|apartheid|colonial|imperiali|neolib|genocide|ethnic cleans|settler|zionist|boycott|bds |propaganda|authoritarian|dictator|autocra|hegemon|regime|totalitarian|neo.?con|austerity|privatiz|gerrymandr|filibuster|electoral college|dark money|lobbyist|war.?monger|centris|incrementalis|deep state|populis|nationalism|xenophob|islamophob|homophob|transphob|misogyn|patriarchy|systemic racism|critical race|intersectional|reparation|decoloni|abolition|proletariat|bourgeoisie|means of production|class (war|struggle)|late.?stage capitalism)\b/i,
  "Violence": /\b(kill|murder|shoot|stab|beat (up|the)|punch|fight|assault|threat|bomb|arson|burn down|attack|weapon|gun |rifle|pistol|knife|execution|execute|behead|lynch|strangle|choke|torture|maim|blood(y|bath)|massacre|slaughter|carnage|casualt|fatali|lethal|deadly|war crime)\b/i,
  "Anti-religion": /\b(anti.?christian|anti.?catholic|anti.?religi|fuck (god|jesus|church)|godless|indoctrinat|brainwash|sky daddy|superstition|oppressive (church|religio)|abuse.*(church|priest|pastor|clergy)|blasphemy|blaspheme|atheist|agnostic)\b/i,
  "Workplace complaints": /\b(hate (my |this )?(job|work|boss|manager)|fuck(ing)? (work|meeting|job)|don.?t wanna work|don.?t want to work|stupid meeting|boring meeting|this meeting|toxic (work|job|office)|quiet quit|layoff|laid off|fired |terminated|PIP )\b/i,
  "Body/appearance posts": /\b(belly (pic|rub|shot)|tummy (tuesday|pic)|chest (pic|hair)|body hair|shirtless|topless|underwear pic|jock(strap)?|bulge|ass pic|butt pic|booty pic|thigh|thicc|chubby|himbo|beefcake|fat ?boy friday|hump ?day|monochronemonday)\b/i,
  "Contempt for institutions": /\b(war criminal|complicit (in|with)|genocide|blood on .* hands|unaccountable|corrupt(ion)?|ghoul|monster|shame on|traitor|treason|betray|sellout|sell.?out|grifter|opportunist|sycophant|bootlick|class traitor|collaborator|enabler|apologist)\b/i,
  "Foreign contacts/sympathies": /\b(hate (this country|america|the us)|defect to|move to (russia|china|iran|north korea)|traitor|treason|foreign (agent|asset)|dual (citizen|loyalty|allegiance))\b/i,
  "Judgement/discretion issues": /\b(drunk dial|drunk text|regret post|shouldnt have|shouldn.?t have said|too much info|tmi|overshare|over.?share|impulse|impulsive|bad decision|poor judgment|poor judgement|no ragrets|no regrets|yolo|sent nudes|posted nudes|posting nudes)\b/i,
};

const thirstyPatterns = [
  { name: "eggplant", regex: /🍆/ },
  { name: "peach", regex: /🍑/ },
  { name: "sweat drops", regex: /💦/ },
  { name: "tongue", regex: /👅/ },
  { name: "hot face", regex: /🥵/ },
  { name: "drooling", regex: /🤤/ },
  { name: "woozy/drunk face", regex: /🥴/ },
  { name: "smirk", regex: /😏/ },
  { name: "see no evil", regex: /🙈/ },
  { name: "flushed", regex: /😳/ },
  { name: "heart eyes", regex: /😍/ },
  { name: "pleading face", regex: /🥺/ },
  { name: "face with hand over mouth", regex: /🫣/ },
  { name: "biting lip", regex: /🫦/ },
  { name: "fire", regex: /🔥/ },
  { name: "chains", regex: /⛓/ },
  { name: "devil", regex: /😈/ },
  { name: "skull", regex: /💀/ },
  { name: "banana", regex: /🍌/ },
  { name: "cherries", regex: /🍒/ },
  { name: "moaning", regex: /🫠/ },
  { name: "daddy", regex: /\b(daddy|zaddy|daddies)\b/i },
  { name: "breeding/seed", regex: /\b(breed(ing|er)?|seeding|seed me|raw(dogg?)?)\b/i },
  { name: "snack/meal", regex: /\b(whole snack|what a snack|lookin like a snack|full meal|thirst trap|main course)\b/i },
  { name: "smash", regex: /\b(smash|smashable|i'd smash|would smash)\b/i },
  { name: "sub/dom", regex: /\b(submissive|dominant|dom |sub |subby|dommy|sir |master )\b/i },
  { name: "pup/puppy play", regex: /\b(good (boy|pup|puppy)|bad boy|woof|arf|pup hood|pup play)\b/i },
  { name: "choking", regex: /\b(choke me|choke on|gag on|gagging)\b/i },
  { name: "edging", regex: /\b(edging|edge me|on the edge)\b/i },
  { name: "size references", regex: /\b(hung|big dick|bde|thick(ness)?|girthy|girth|packing|well endowed|size queen)\b/i },
  { name: "body worship", regex: /\b(worship|lick(ing|ed)?|taste|tasting|sniff|musk(y)?|pits|armpits|feet|toes|soles)\b/i },
  { name: "come over/here", regex: /\b(come (over|here|get|cuddle|snuggle)|get over here|on your knees)\b/i },
  { name: "eat/devour", regex: /\b(eat (me|you|that|this)|devour|swallow|gobble)\b/i },
  { name: "rail/wreck/ruin", regex: /\b(rail me|rail you|wreck me|wreck you|ruin me|destroy me)\b/i },
  { name: "touch/grab", regex: /\b(touch (me|my|this)|grab (my|this|that)|hold (me|my)|grope|grind(ing)?)\b/i },
  { name: "wet/dripping", regex: /\b(so wet|dripping|soaked|soaking|drenched)\b/i },
  { name: "down bad", regex: /\b(down bad|down horrendous|down tremendous|simping|simp |feral|bricked up|bricked)\b/i },
  { name: "spank/slap", regex: /\b(spank|spanking|slap (my|that|this|your)|smack (my|that))\b/i },
  { name: "sit on/ride", regex: /\b(sit on (my|this|that|your)|ride (me|this|that))\b/i },
  { name: "spit", regex: /\b(spit (on|in)|spitting)\b/i },
  { name: "tight/loose", regex: /\b(so tight|tighter|loosened|stretched|stretching)\b/i },
  { name: "load/nut/bust", regex: /\b(bust(ing|ed)? (a )?nut|blow(ing)? (a |my )?load|nut(ted|ting)?|drop(ping|ped)? (a )?load)\b/i },
  { name: "vers/top/bottom", regex: /\b(vers(atile)?|top energy|bottom energy|pillow princess|power top|service top)\b/i },
  { name: "bear/cub slang", regex: /\b(bear (week|run|event)|cub run|otter mode|bear culture|bear bar)\b/i },
  { name: "OF/lewds", regex: /\b(of content|my of|link in bio|lewds|spicy content|spicy pics|spicy link)\b/i },
  { name: "DMs open", regex: /\b(dms? (are )?(open|me)|slide (into|in) (my|the) dms?|hit me up|hmu)\b/i },
];

// --- API Helpers ---

async function fetchAllPosts(handle) {
  const allPosts = [];
  let cursor = undefined;
  let page = 0;

  while (true) {
    page++;
    let url = `${PUBLIC_API}/xrpc/app.bsky.feed.getAuthorFeed?actor=${handle}&limit=100`;
    if (cursor) url += "&cursor=" + encodeURIComponent(cursor);

    const resp = await fetch(url);
    const data = await resp.json();
    const feed = data.feed || [];

    for (const item of feed) {
      if (item.reason) continue; // skip reposts
      const post = item.post;
      const record = post.record || {};
      const reply = record.reply;
      const embed = record.embed;
      const embedView = post.embed;
      const labels = (post.labels || []).map((l) => l.val);
      const selfLabels = (record.labels?.values || []).map((l) => l.val);

      // Extract quoted text
      let quotedText = "";
      if (embed?.record?.value?.text) quotedText = embed.record.value.text;
      if (embed?.record?.record?.value?.text) quotedText = embed.record.record.value.text;
      if (embedView?.record?.value?.text) quotedText = embedView.record.value.text;
      if (embedView?.record?.record?.value?.text) quotedText = embedView.record.record.value.text;

      // Check for media
      let hasMedia = false;
      if (embed) {
        const et = embed["$type"] || "";
        if (et.includes("image") || et.includes("video") || embed.images || embed.video || embed.media) hasMedia = true;
      }

      allPosts.push({
        text: record.text || "",
        quotedText,
        date: (record.createdAt || "").split("T")[0],
        uri: post.uri,
        isReply: !!reply,
        parentUri: reply?.parent?.uri || null,
        rootUri: reply?.root?.uri || null,
        labels,
        selfLabels,
        hasMedia,
      });
    }

    if (page % 50 === 0) process.stderr.write(`  Fetching page ${page}...\n`);
    if (!data.cursor || feed.length === 0) break;
    cursor = data.cursor;
  }

  return allPosts;
}

async function checkPostsBatch(uris) {
  const results = {};
  const batchSize = 25;

  for (let i = 0; i < uris.length; i += batchSize) {
    const batch = uris.slice(i, i + batchSize);
    const params = batch.map((u) => `uris=${encodeURIComponent(u)}`).join("&");

    try {
      const resp = await fetch(`${PUBLIC_API}/xrpc/app.bsky.feed.getPosts?${params}`);
      if (resp.ok) {
        const data = await resp.json();
        const found = new Set((data.posts || []).map((p) => p.uri));
        for (const u of batch) results[u] = found.has(u) ? "exists" : "deleted";
      } else {
        for (const u of batch) results[u] = "error";
      }
    } catch {
      for (const u of batch) results[u] = "error";
    }

    if ((i + batchSize) % 500 === 0) {
      process.stderr.write(`  Checked ${Math.min(i + batchSize, uris.length)}/${uris.length}...\n`);
    }
    await sleep(100);
  }

  return results;
}

async function fetchParentTexts(uris) {
  const results = {};
  const batchSize = 25;

  for (let i = 0; i < uris.length; i += batchSize) {
    const batch = uris.slice(i, i + batchSize);
    const params = batch.map((u) => `uris=${encodeURIComponent(u)}`).join("&");

    try {
      const resp = await fetch(`${PUBLIC_API}/xrpc/app.bsky.feed.getPosts?${params}`);
      if (resp.ok) {
        const data = await resp.json();
        for (const post of data.posts || []) {
          results[post.uri] = post.record?.text || "";
        }
      }
    } catch {}

    if ((i + batchSize) % 500 === 0) {
      process.stderr.write(`  Fetched ${Math.min(i + batchSize, uris.length)}/${uris.length} parent posts...\n`);
    }
    await sleep(100);
  }

  return results;
}

// --- Scan Functions ---

function scanText(posts, cleanupSet) {
  console.log("\n[1/5] Scanning post text + quoted text...");
  const flagged = {};
  for (const cat of Object.keys(textCategories)) flagged[cat] = 0;

  for (const post of posts) {
    const fullText = post.quotedText
      ? post.text + " " + post.quotedText
      : post.text;
    if (!fullText || fullText.length < 3) continue;

    for (const [cat, regex] of Object.entries(textCategories)) {
      if (regex.test(fullText)) {
        flagged[cat]++;
        cleanupSet.add(post.uri);
      }
    }
  }

  for (const [cat, count] of Object.entries(flagged)) {
    if (count > 0) console.log(`  ${cat.padEnd(35)} ${count}`);
  }
}

function scanNsfwMedia(posts, cleanupSet) {
  console.log("\n[2/5] Scanning for NSFW-labeled media...");
  let count = 0;

  for (const post of posts) {
    const allLabels = [...post.labels, ...post.selfLabels];
    if (
      post.hasMedia &&
      allLabels.some((v) => ["sexual", "nudity", "porn", "nsfw", "graphic-media", "adult"].includes(v))
    ) {
      count++;
      cleanupSet.add(post.uri);
    }
  }

  console.log(`  NSFW media posts: ${count}`);
}

function scanThirsty(posts, cleanupSet) {
  console.log("\n[3/5] Scanning for thirsty emojis and slang...");
  let count = 0;

  for (const post of posts) {
    const text = post.text;
    if (!text || text.length < 2) continue;

    for (const pattern of thirstyPatterns) {
      if (pattern.regex.test(text)) {
        count++;
        cleanupSet.add(post.uri);
        break;
      }
    }
  }

  console.log(`  Thirsty posts: ${count}`);
}

async function scanDangling(posts, cleanupSet) {
  console.log("\n[4/5] Scanning for dangling replies (deleted parent/root)...");
  const myUris = new Set(posts.map((p) => p.uri));
  const replies = posts.filter((p) => p.isReply);

  const externalUris = new Set();
  for (const reply of replies) {
    if (reply.parentUri && !myUris.has(reply.parentUri)) externalUris.add(reply.parentUri);
    if (reply.rootUri && !myUris.has(reply.rootUri)) externalUris.add(reply.rootUri);
  }

  console.log(`  Checking ${externalUris.size} parent/root URIs...`);
  const statuses = await checkPostsBatch([...externalUris]);

  const deletedParents = new Set();
  for (const [uri, status] of Object.entries(statuses)) {
    if (status === "deleted") deletedParents.add(uri);
  }

  // Find direct dangling replies
  const danglingUris = new Set();
  for (const reply of replies) {
    if (
      (reply.parentUri && deletedParents.has(reply.parentUri)) ||
      (reply.rootUri && deletedParents.has(reply.rootUri))
    ) {
      danglingUris.add(reply.uri);
    }
  }

  // Find chained replies (replies to dangling replies)
  let foundMore = true;
  while (foundMore) {
    foundMore = false;
    for (const post of replies) {
      if (danglingUris.has(post.uri)) continue;
      if (
        (post.parentUri && danglingUris.has(post.parentUri)) ||
        (post.rootUri && danglingUris.has(post.rootUri))
      ) {
        danglingUris.add(post.uri);
        foundMore = true;
      }
    }
  }

  for (const uri of danglingUris) cleanupSet.add(uri);
  console.log(`  Dangling replies: ${danglingUris.size}`);
}

async function scanReplyContext(posts, cleanupSet) {
  console.log("\n[5/5] Scanning reply parent context...");
  const myUris = new Set(posts.map((p) => p.uri));
  const replies = posts.filter((p) => p.isReply);

  const parentUriMap = {};
  for (const reply of replies) {
    if (reply.parentUri && !myUris.has(reply.parentUri)) {
      if (!parentUriMap[reply.parentUri]) parentUriMap[reply.parentUri] = [];
      parentUriMap[reply.parentUri].push(reply);
    }
  }

  const parentUris = Object.keys(parentUriMap);
  console.log(`  Fetching ${parentUris.length} parent post texts...`);
  const parentTexts = await fetchParentTexts(parentUris);

  let count = 0;
  for (const [parentUri, parentText] of Object.entries(parentTexts)) {
    if (!parentText || parentText.length < 3) continue;

    for (const [, regex] of Object.entries(textCategories)) {
      if (regex.test(parentText)) {
        for (const reply of parentUriMap[parentUri] || []) {
          if (!cleanupSet.has(reply.uri)) {
            count++;
            cleanupSet.add(reply.uri);
          }
        }
        break;
      }
    }
  }

  console.log(`  Replies to flagged parents: ${count}`);
}

// --- Delete Function ---

async function deletePosts(uris) {
  console.log(`\nFound ${uris.length} posts to delete.`);

  if (DRY_RUN) {
    console.log(`[DRY RUN] ${uris.length} posts would be deleted. No changes made.`);
    return;
  }

  if (!SKIP_CONFIRM) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) => {
      rl.question(
        `\nThis will permanently delete ${uris.length} posts from @${HANDLE}.\nThis action CANNOT be undone. Continue? (y/N) `,
        (a) => { rl.close(); resolve(a); }
      );
    });
    if (!answer.toLowerCase().startsWith("y")) {
      console.log("Aborted.");
      return;
    }
  }

  console.log("Authenticating...");
  let session = await createSession();
  let { accessJwt, refreshJwt, did } = session;
  console.log(`Authenticated as ${did}`);

  let deleted = 0;
  let failed = 0;
  let tokenCounter = 0;

  for (const uri of uris) {
    const rkey = uri.split("/").pop();

    tokenCounter++;
    if (tokenCounter >= 500) {
      try {
        session = await refreshSessionFn(refreshJwt);
        accessJwt = session.accessJwt;
        refreshJwt = session.refreshJwt;
      } catch {
        session = await createSession();
        accessJwt = session.accessJwt;
        refreshJwt = session.refreshJwt;
      }
      tokenCounter = 0;
    }

    try {
      const resp = await fetch(`${PDS}/xrpc/com.atproto.repo.deleteRecord`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessJwt}`,
        },
        body: JSON.stringify({ repo: did, collection: "app.bsky.feed.post", rkey }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(err);
      }

      deleted++;
      if (deleted % 100 === 0) {
        console.log(`  Progress: ${deleted}/${uris.length} deleted (${failed} failed)`);
      }
      await sleep(350);
    } catch (err) {
      failed++;
      if (err.message.includes("RateLimit") || err.message.includes("429")) {
        console.log("  Rate limited. Waiting 60s...");
        await sleep(60000);
      }
    }
  }

  console.log(`\nDeletion complete: ${deleted} deleted, ${failed} failed out of ${uris.length}`);

  // Verify
  console.log("Verifying...");
  const statuses = await checkPostsBatch(uris);
  const stillExist = Object.entries(statuses).filter(([, s]) => s === "exists");

  if (stillExist.length === 0) {
    console.log("All posts successfully deleted!");
  } else {
    console.log(`${stillExist.length} posts still exist. Retrying...`);
    const retrySession = await createSession();
    for (const [uri] of stillExist) {
      const rkey = uri.split("/").pop();
      try {
        await fetch(`${PDS}/xrpc/com.atproto.repo.deleteRecord`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${retrySession.accessJwt}`,
          },
          body: JSON.stringify({ repo: retrySession.did, collection: "app.bsky.feed.post", rkey }),
        });
        await sleep(350);
      } catch {}
    }
    console.log("Retry complete.");
  }
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

async function refreshSessionFn(refreshJwt) {
  const resp = await fetch(`${PDS}/xrpc/com.atproto.server.refreshSession`, {
    method: "POST",
    headers: { Authorization: `Bearer ${refreshJwt}` },
  });
  if (!resp.ok) throw new Error("Refresh failed");
  return resp.json();
}

// --- Main ---

async function main() {
  if (DO_SCAN) {
    console.log(`\n========================================`);
    console.log(`  Bluesky Post Scanner`);
    console.log(`  Handle: @${HANDLE}`);
    console.log(`  Output: ${OUTPUT_DIR}/`);
    console.log(`========================================\n`);

    console.log("Fetching all posts...");
    const posts = await fetchAllPosts(HANDLE);
    console.log(`Fetched ${posts.length} posts.`);

    const cleanupSet = new Set();

    scanText(posts, cleanupSet);
    scanNsfwMedia(posts, cleanupSet);
    scanThirsty(posts, cleanupSet);
    await scanDangling(posts, cleanupSet);
    await scanReplyContext(posts, cleanupSet);

    const cleanupList = [...cleanupSet];

    console.log(`\n========================================`);
    console.log(`  SCAN COMPLETE`);
    console.log(`  Total posts:   ${posts.length}`);
    console.log(`  Flagged:       ${cleanupList.length}`);
    console.log(`  Clean:         ${posts.length - cleanupList.length}`);
    console.log(`  Flagged %:     ${((cleanupList.length / posts.length) * 100).toFixed(1)}%`);
    console.log(`========================================\n`);

    writeFileSync(out("posts_to_cleanup.json"), JSON.stringify(cleanupList, null, 2));
    console.log(`Cleanup list saved to ${out("posts_to_cleanup.json")}`);
  }

  if (DO_DELETE) {
    const cleanupFile = out("posts_to_cleanup.json");
    if (!existsSync(cleanupFile)) {
      console.error(`No cleanup list found at ${cleanupFile}. Run --scan first.`);
      process.exit(1);
    }

    const uris = JSON.parse(readFileSync(cleanupFile, "utf8"));
    await deletePosts(uris);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
