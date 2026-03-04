require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mineflayer = require('mineflayer');
const tpsPlugin = require('mineflayer-tps')(mineflayer);
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalBlock } = goals;
const viewer = require('prismarine-viewer').mineflayer;

// globals pulled from util.js
const spam_count = {};
const temp_blacklist = new Map();
const spam_offenses = {};
const tpsBuffer = [];
const MAX_BUFFER = 20;

// flag to ensure bot data is loaded/saved only once
let started_saving = false;


// --- 1. CONFIGURATION & STATE ---
const prefix = '&';
const startTime = Date.now();
const ADMINS = ['1nvoke_', 'Regalforger', 'PiercingC1aws']; // Hardcoded Admins
const whitelist = process.env.WHITELIST ? process.env.WHITELIST.split(',').map(u => u.trim()) : ['1nvoke_', 'q33a', 'PiercingC1aws'];

const state = {
    prefix,
    whitelist,
    admins: ADMINS,
    isAdmin: (user) => ADMINS.includes(user),
    isWhitelisted: (user) => whitelist.includes(user) || ADMINS.includes(user),
    transitionMode: false,
    current_count: 0,
    marriages: {},
    quotes: [],
    // YOUR EXACT REFILL COORDS (must be provided via env vars when repo is public)
    STASH: {
        x: parseInt(process.env.STASH_X, 10),
        y: parseInt(process.env.STASH_Y, 10),
        z: parseInt(process.env.STASH_Z, 10)
    },

    // added for merged event logic
    spawnedIn: 0,
    tips_started: false,
    bot_tips_sent: 0,
    ads_seen: 0,
    dupe_mentioned: 0,
    deaths: 0,
    global_deaths: 0,
    vined_on_top_deaths: 0,
    i_am_vined_deaths: 0,
    damix_deaths: 0,
    crystalled: 0,
    crystal_kills: {},
    crystal_deaths: {},
    cooldown: 0,
    longest_cooldown: 0,
    recent_join: '',
    recent_quit: '',
    joined: 0,
    quitted: 0,
    currentWorldAge: 0,
    timeLast: 0,
    server_restart: 0,
    restart: false,
    loggedIn: false,
    restarted: false,

    // additional fields seen in friend's startup snippet
    PASSWORD: process.env.MC_PASSWORD,
    avg_ping: [],
    pendingMarriage: {},
    pendingDivorce: {},
    totalStats: {},
    sessions: {},
    newest_player: false,
    scan_hotspot: false,
    auto_tp: false,
    welcomer: false,
    bot_uses: 0,
    cooldowns: [],
    // spam tracking maps will be referenced later by event handlers
    temp_blacklist,
    spam_count,
    spam_offenses,
    joindates: {},
    // response collection for friend events
    responses: {},
    // command containers (populated after definitions)
    public_commands: {},
    admin_commands: {},
    // arrays used by various public commands:
    insults: [],
    fetish_results: [],
    gender_results: [],
    npc_replies: [],
    cap_replies: [],
    screen_replies: [],
    illnesses: [],
    sizes: [],
    answers: [],
    spam_messages: [],
    blacklisted_messages: []
};

const utils = {
    // safeChat adds random string to bypass filters
    safeChat: (msg) => `${msg} ${createRandomString()}`,
    get_uptime: () => {
        let diff = Date.now() - startTime;
        let h = Math.floor(diff / 3600000);
        let m = Math.floor((diff % 3600000) / 60000);
        return `${h}h ${m}m`;
    }
};

// various helper functions formerly in util.js
async function fetchJD(user) {
    try {
        const response = await fetch(`https://www.6b6t.org/pl/stats/${user}`);
        const text = await response.text();
        if (!text.includes("since")) return null;
        return String(text.split("since")[1].split("</span></div></div></div>")[0].replace("<!-- -->", "").trim());
    } catch (err) {
        return null;
    }
}

function getCurrentTPS() {
    if (tpsBuffer.length === 0) return 20;
    const sum = tpsBuffer.reduce((a, b) => a + b, 0);
    return sum / tpsBuffer.length;
}

function getCurrentTPSInstant() {
    return tpsBuffer.length ? tpsBuffer[tpsBuffer.length - 1] : 20;
}

function getServerTPS(currentWorldAge, lastWorldAge, timeElapsedMs, clientRestarted) {
  let tpsPassed = (currentWorldAge - lastWorldAge);
  let secondsPassed = timeElapsedMs / 1000;

  let tps = tpsPassed / secondsPassed;

  if (tps < 0) {tps = 0}
  if (tps > 20) {tps = 20}

  if (clientRestarted) {
    tpsBuffer.length = 0;
    clientRestarted = false;
  }
  tpsBuffer.push(tps);
  if (tpsBuffer.length > MAX_BUFFER) tpsBuffer.shift();
}

function loadBotData(state) {
  try {
    const inputPath = path.join(__dirname, 'output', 'bot_data.json');
    if (fs.existsSync(inputPath)) {
      const jsonData = fs.readFileSync(inputPath, 'utf8');
      const data = JSON.parse(jsonData);

      state.quotes = data.quotes || {};
      state.crystalled = data.kills || 0;
      state.crystal_deaths = data.crystal_deaths || {};
      state.crystal_kills = data.crystal_kills || {};
      state.global_deaths = data.deaths || 0;
      state.topKills = data.topKills || {};
      state.marriages = data.marriages || {};
      state.bot_uses = data.bot_uses || 0;
      state.totalStats = data.totalStats || {};
      state.joindates = data.joindates || {};

      console.log('[Bot] Loaded bot_data.json');
    } else {
      console.log('[Bot] No bot_data.json found, starting fresh');
    }
  } catch (err) {
    console.error('[Bot] Failed to load bot_data.json:', err);
  }
}

function saveBotData(state) {
  try {
    const data = {
      quotes: state.quotes || {},
      totalStats: state.totalStats || {},
      crystal_kills: state.crystal_kills || {},
      crystal_deaths: state.crystal_deaths || {},
      kills: state.crystalled || 0, 
      deaths: state.global_deaths,
      topKills: state.crystal_kills || {},
      marriages: state.marriages || {},
      bot_uses: state.bot_uses || 0,
      joindates: state.joindates || {},
      lastUpdate: new Date().toISOString()
    };

    const outputDir = path.join(__dirname, 'output');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

    const filePath = path.join(outputDir, 'bot_data.json');
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    console.log(`[Bot] Saved Data!`);
  } catch (err) {
    console.error('[Bot] Error saving bot_data.json:', err);
  }
}

function startAutoSave(state, intervalMs = 2 * 60 * 1000) {
  setInterval(() => saveBotData(state), intervalMs);

  process.on('SIGINT', () => {
    saveBotData(state);
    process.exit();
  });
  process.on('SIGTERM', () => {
    saveBotData(state);
    process.exit();
  });
}

function random_element(arr) {
  return String(arr[Math.floor(Math.random() * arr.length)]);
}

function createRandomString() {
    const length = 5;
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function get_random_ip() {
  const array = [];
  for (let i = 0; i < 4; i++) {
    array.push(Math.floor(Math.random() * 256));
  }
  const [a, b, c, d] = array;
  return `${a}.${b}.${c}.${d}`;
}

function getIndefiniteArticle(word) {
  if (!word) return '';
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

function handlePercentCmd(user, prefix, message, bot, state, options = {}) {
  const [fullCmd, ...args] = message.trim().split(/\s+/);
  const cmd = fullCmd.replace(prefix, '').toLowerCase();

  let target = args[0] || user;

  if (target === '|') {
    target = user;
  }

  if (target.toLowerCase && target.toLowerCase() === 'random') {
    const players = Object.keys(bot.players);
    target = players.length > 0 ? state.random_element(players) : user;
  }

  if (options.status) {
    return state.safeChat(`${target} is ${options.status}`);
  }

  if (options.customMessage) {
    return state.safeChat(options.customMessage(target, cmd, args.slice(1)));
  }

  let value = Math.floor(Math.random() * 101);
  if (options.isRating) {
    value = Math.floor(Math.random() * 10) + 1;
  }

  let article = '';
  if (options.useArticle) {
    article = getIndefiniteArticle(cmd) + ' ';
  }

  return state.safeChat(`${target} is ${article}${value}% ${cmd}`);
}

function handleTargetCommand(user, prefix, message, bot, state, label, usage, chatMessageFn) {
  const rawArgs = message.split(`${prefix}${label} `)[1];
  const args = rawArgs ? rawArgs.trim().split(/\s+/) : [];

  let target = args[0];

  if (target === '|') {
    target = user;
  }

  if (target && target.toLowerCase() === 'random') {
    const players = Object.keys(bot.players);
    target = state.random_element(players);
  }

  if (!target || target.trim().length === 0) {
    return bot.chat(state.safeChat(`Usage: ${prefix}${label} ${usage}`));
  }

  const msg = chatMessageFn(user, target, args.slice(1));
  return bot.chat(state.safeChat(msg));
}

function get_kd(target, state) {
  const hasKills = state.crystal_kills.hasOwnProperty(target);
  const hasDeaths = state.crystal_deaths.hasOwnProperty(target);

  if (hasKills || hasDeaths) {
    const kills = state.crystal_kills[target] || 0;
    const deaths = state.crystal_deaths[target] || 0;
    const kd = deaths === 0 ? kills : (kills / deaths).toFixed(2);

    return `${target} has ${kills} kill${kills !== 1 ? 's' : ''} and ${deaths} death${deaths !== 1 ? 's' : ''}. KD: ${kd}`;
  } else {
    return `Player ${target} has no recorded kills or deaths.`;
  }
}

function return_user(msg) {
  let no_rank_message = '';
  let get_username = '';

  if (msg.startsWith('[')) {
    no_rank_message = msg.split(']')[1];
    get_username = no_rank_message.split('»')[0];
  } else if (msg.includes('whispers')) {
    get_username = msg.split('whispers')[0];
  } else {
    get_username = msg.split('»')[0];
  }

  return get_username?.trim() || '';
}

function blacklist(bot, user) {
  if (temp_blacklist.has(user)) return;

  if (!spam_offenses[user]) spam_offenses[user] = 1;
  else spam_offenses[user]++;

  if (spam_offenses[user] >= 6) spam_offenses[user] = 6;

  const minutes = spam_offenses[user] * 5;
  const duration = minutes * 60 * 1000;

  temp_blacklist.set(user, true);
  bot.whisper(user, `Blacklisted for spamming (${minutes} minutes).`);

  setTimeout(() => {
    temp_blacklist.delete(user);
    bot.whisper(user, "You're no longer blacklisted.");
  }, duration);
}

function checkSpam(bot, user) {
  if (!spam_count[user]) {
    spam_count[user] = 1;
  } else {
    spam_count[user]++;
  }

  setTimeout(() => {
    if (spam_count[user]) {
      spam_count[user]--;
      if (spam_count[user] <= 0) delete spam_count[user];
    }
  }, 5000);

  if (spam_count[user] >= 5) {
    spam_count[user] = 0;
    blacklist(bot, user);
    return true;
  }
  return false;
}

// attach helpers to state for easy access
state.fetchJD = fetchJD;
state.random_element = random_element;
state.get_kd = get_kd;
state.safeChat = utils.safeChat;
state.return_user = return_user;
state.blacklist = blacklist;
state.checkSpam = checkSpam;
state.getCurrentTPS = getCurrentTPS;
state.getCurrentTPSInstant = getCurrentTPSInstant;
state.getServerTPS = getServerTPS;
state.loadBotData = loadBotData;
state.saveBotData = saveBotData;
state.startAutoSave = startAutoSave;
state.whitelisted_users = (user) => state.whitelist.includes(user.trim());

// make spam maps available via state too
state.temp_blacklist = temp_blacklist;
state.spam_count = spam_count;
state.spam_offenses = spam_offenses;


// populate default response arrays drawn from friend's snippet if still empty
state.insults = state.insults.length ? state.insults : [
    "L ratio", "Cope", "No maidens", "You fell off", "Built like a furnace", "You sniff bedrock",
    "Laggy, broke, AND cringe", "Your parents use 1.8.9"
];

state.fetish_results = state.fetish_results.length ? state.fetish_results : [
    "Feet", "Hands", "Thighs", "Butts", "Armpits", "Necks", "Ears", "Eyes", "Nipples", "Hair",
    "Latex", "Leather", "Stockings", "Corsets", "Lingerie", "Heels", "Uniforms", "Socks", "Pantyhose",
    "Glasses", "Goth aesthetics", "Piercings", "Tattoos", "Mask kink", "Business suits", "Sweaters",
    "Futa", "Femboys", "Monster girls", "Slime girls", "Giantess", "Robots", "Pet play", "Yandere roleplay",
    "Cosplay kink", "Age regression (non-sexual)", "Gender play", "Crossdressing", "Objectification",
    "DILFs", "MILFs", "Clowns", "Nuns", "Maids", "Neko play", "Bunny girls", "Goblins", "Fairies",
    "Goth Latina Mommy", "Dom/sub dynamics", "Bondage", "Sadism", "Masochism", "Choking", "Breathplay", "Wax play",
    "Electrostimulation", "Shibari (Japanese rope bondage)", "Temperature play", "Sensory deprivation",
    "Praise kink", "Degradation kink", "Slave", "Master", "Femdom", "Maledom", "Cuckoldry", "Public humiliation",
    "Lactation", "Watersports", "Rimming", "Cumplay", "Sweat kink", "Scent kink", "Breast worship",
    "Thigh worship", "Armpit fetish", "Throat-fucking", "Nipple play", "Face sitting",
    "Corruption kink", "Mind control (consensual fantasy)", "Hypnosis", "Brainwashing", "Petification",
    "Exhibitionism", "Voyeurism", "Jealousy kink", "Stalking fantasy", "Possessiveness", "Fear play",
    "Gun kink", "Knife kink", "Danger kink", "ASMR kink", "Voice kink", "Voice domination",
    "Inflation", "Tentacles", "NTR", "Vore", "Breeding kink", "Impregnation kink", "Alien kink",
    "Body modification", "Zombie attraction", "Monster transformation", "Amputee attraction",
    "Food play", "Plushophilia", "Guro (non-visual)", "Size difference", "Stomping", "Giant robots"
];

state.gender_results = state.gender_results.length ? state.gender_results : [
    "Male", "Female", "Attack Helicopter", "Goofy", "None", "Yes", "All of them"
];

state.npc_replies = state.npc_replies.length ? state.npc_replies : [
    "NPC detected", "Real human", "Side quest giver", "Main character", "Background filler", "Silent NPC"
];

state.cap_replies = state.cap_replies.length ? state.cap_replies : [
    "No cap", "This is cap", "Lying through teeth", "Cap detected", "100% truth", "Literal fiction"
];

state.screen_replies = state.screen_replies.length ? state.screen_replies : [
    "Discord open", "Reddit at max brightness", "Minecraft launcher", "Horny Twitter tab", "YouTube shorts addiction", "Roblox",
    "NSFW folder named 'homework'", "Excel pretending to work"
];

state.illnesses = state.illnesses.length ? state.illnesses : [
    "Schizophrenia", "ADHD", "Autism", "Bipolar", "Depression", "Anxiety", "OCD", "Borderline Personality", "Sociopathy"
];

state.sizes = state.sizes.length ? state.sizes : ["A", "B", "C", "D", "DD", "E", "F", "G", "H", "Z"];

state.answers = state.answers.length ? state.answers : [
    "Yes", "No", "Maybe", "Definitely", "Try again later", "Absolutely", "Not a chance", "Don't count on it", "Looks good", "Sus"
];

state.spam_messages = state.spam_messages.length ? state.spam_messages : [
    "Want your own custom command? Suggest it by running -discord!",
    "Bot has a quote system? Try -quote <username/random>!",
    "Use -quote <username/random> to read the dumbest things people said!",
    "Think you're the smartest? Prove it with -iq!",
    "Curious about someone's IQ? Use -iq <username/random>!",
    "Commands too many? Use -help to browse by pages!",
    "Track who joined recently with -playerjoins!",
    "Want to know who ragequit last? Try -playerquits!",
    "Wondering if the server's dying? Check the TPS with -tps!",
    "The Bot has been made by Damix2131, Try it out by running -help!",
    "Still got <Malachite> Virus?, We are still secure of it, run -help to see it yourself!",
    "Forgot when you joined? Give -jd <username> a try!",
    "Need average ping stats? Use -avgping!",
    "Stay informed with server restart time: -restart",
    "Check who's been fragged the most using -topkills!",
    "Is the bot alive? Check with -uptime!",
    "Curious how many times the bot died? Use -deaths!",
    "Check your KD ratio with -kd <username/random>!",
    "See who's lagging with -ping <username/random>!",
    "See how many players are online with -playerlist!",
    "See the bot's total usage with -stats!",
    "What's the weather in-game? Check -weather!",
    "Want to know the time of day or moon phase? Use -time!",
    "Feeling indecisive? Let the bot choose with -choose option1, option2...",
    "Start a counting game with -count <number>!",
    "Shake the 8-ball with -8ball!",
    "Roll a random number with -roll!",
    "Flip a coin and let fate decide with -flip!",
    "Rate someone with -rate <username/random>!",
    "Who's the biggest simp? Try -simp <username/random>!",
    "Check your cringe levels with -cringe <username/random>!",
    "Check how based someone is using -based <username/random>!",
    "Check how cringe someone is using -cringe <username/random>!",
    "Insult someone like a boss: -insult <username/random>!",
    "Diagnose someone with a mental illness using -mental <username/random>!",
    "Find out who's the most racist with -racist <username/random>!",
    "Expose lies with -cap <username/random>!",
    "Someone annoying? Tell them to shut up: -stfu <username/random>!",
    "See how paranoid your friends are with -paranoia <username/random>!",
    "Who's an NPC? Find out using -npc <username/random>!",
    "Curious what someone's screen looks like? Try -screen <username/random>!",
    "Measure pp size with -pp <username/random>!",
    "Check someone's boob size with -boobs <username/random>!",
    "Reveal your hidden fetish with -fetish <username/random>!",
    "Expose your gender identity with -gender <username/random>!",
    "Find out how much of a gooner someone is: -gooner <username/random>!",
    "Reveal how trans someone is with -trans <username/random>!",
    "Reveal how gay someone is with -gay <username/random>!",
    "Reveal how lesbian someone is with -lesbian <username/random>!",
    "Reveal how femboy someone is with -femboy <username/random>!",
    "Reveal how aryan someone is with -aryan <username/random>!",
    "Reveal how white someone is with -white <username/random>!",
    "Make love, not war: -love <user1> <user2>",
    "Use -turkish to find your Turkish bloodline!",
    "Use -swedish to check your inner IKEA ancestry!",
    "Use -european to find out how generic you are!",
    "Use -flip to flip a coin!",
    "Use -roll to roll a number!",
    "Use -choose option1, option2... to let the bot decide!",
    "Wondering what someone is? Try -gender!",
    "Wondering if someone is an NPC? Use -npc!",
    "Want to know how smart someone is? Use -iq!",
    "Want to diagnose someone? Use -mental!",
    "Want to know their secret kinks? Try -fetish!",
    "Is someone lying? Use -cap <username/random>!",
    "Is someone a simp? Use -simp <username/random>!",
    "Feeling cringe? Use -cringe <username/random>!",
    "Who's the most based? Use -based <username/random>!",
    "Reveal your inner lesbian with -lesbian!",
    "See boob size with -boobs!",
    "Find out who's a gooner using -gooner!",
    "Feeling romantic? Try -love <user1> <user2>!",
    "How racist are you? Use -racist <username/random>!",
    "Want to dox someone or your friends? Try out -dox <username/random>!",
    "Tell someone to kill themselves with -kys <username/random!>",            
    "Test mental state with -mental <username/random>!",
    "Reveal someone's inner aryan with -aryan <username/random>!",
    "Check average ping across all players with -avgping!",
    "Check the current weather using -weather!",
    "See the current Minecraft time using -time!",
    "Say thanks to the bot with -discord!"
];
state.blacklisted_messages = state.blacklisted_messages.length ? state.blacklisted_messages : [
    '---------------------------',
    'players sleeping',
    'You can vote! Type /vote to get more homes, lower cooldowns & white username color!',
    'Remember to /vote'
];
state.responses = state.responses || {};

// --- 2. COMMANDS LOGIC ---
const public_commands = {
    [`${prefix}help`]: (user, message, bot) => {
        const args = message.split(' ');
        const page = parseInt(args[1]) || 1;
        const cmds = Object.keys(public_commands);
        const pages = Math.ceil(cmds.length / 8);
        if (page > pages) return bot.chat(`Page ${page} not found.`);
        bot.chat(`Public Help [${page}/${pages}]: ` + cmds.slice((page-1)*8, page*8).join(', '));
    },
    [`${prefix}uptime`]: (user, message, bot) => bot.chat(`Uptime: ${utils.get_uptime()}`),
    [`${prefix}iq`]: (user, message, bot) => bot.chat(`${user}'s IQ: ${Math.floor(Math.random() * 200)}`),
    [`${prefix}love`]: (user, message, bot) => bot.chat(`Love Compatibility: ${Math.floor(Math.random() * 101)}%`),
       [`${prefix}rape`]: (user, message, bot, state) =>
        state.handleTargetCommand(user, prefix, message, bot, state, 'rape', '<username>', (user, target) => `${user} rapes ${target}`),

    [`${prefix}kys`]: (user, message, bot, state) =>
        state.handleTargetCommand(user, prefix, message, bot, state, 'kys', '<username>', (user, target) => `Go kill yourself ${target}`),

    [`${prefix}pp`]: (user, message, bot, state) =>
        state.handleTargetCommand(user, prefix, message, bot, state, 'pp', '<username>', (user, target) => {
            const size = "=".repeat(Math.floor(Math.random() * 50));
            return `${target}'s dick: 8${size}D`;
        }),
         [`${prefix}jew`]: (user, message, bot, state) => bot.chat(state.handlePercentCmd(user, prefix, message, bot, state)),
    [`${prefix}indian`]: (user, message, bot, state) => bot.chat(state.handlePercentCmd(user, prefix, message, bot, state)),
    [`${prefix}gay`]: (user, message, bot, state) => bot.chat(state.handlePercentCmd(user, prefix, message, bot, state)),
    [`${prefix}furry`]: (user, message, bot, state) => bot.chat(state.handlePercentCmd(user, prefix, message, bot, state)),
    [`${prefix}trans`]: (user, message, bot, state) => bot.chat(state.handlePercentCmd(user, prefix, message, bot, state)),
    [`${prefix}retard`]: (user, message, bot, state) => bot.chat(state.handlePercentCmd(user, prefix, message, bot, state)),
    [`${prefix}femboy`]: (user, message, bot, state) => bot.chat(state.handlePercentCmd(user, prefix, message, bot, state)),
    [`${prefix}nigger`]: (user, message, bot, state) => bot.chat(state.handlePercentCmd(user, prefix, message, bot, state)),

    // Uncomment and complete if needed
     [`${prefix}racist`]: (user, message, bot, state) => {
        const args = getArgs(message, prefix, "racist");
        let target = args[0];
        const percent = Math.floor(Math.random() * 101);
        if (target === 'random') {
            const players = Object.keys(bot.players);
            target = state.random_element(players);
        } else if (target === '|') {
            target = user;
        }
        if (target && target.trim().length > 0) {
            bot.chat(state.safeChat(`${target} is ${percent}% racist`));
        } else {
            bot.chat(state.safeChat(`${user} is ${percent}% racist`));
        }
    },
     [`${prefix}quote`]: (user, message, bot, state) => {
        const args = getArgs(message, prefix, "quote");
        let target = args[0];
        if (target === 'random') {
            const players = Object.keys(bot.players);
            target = state.random_element(players);
        } else if (target === '|') {
            target = user;
        }
        if (target && target.trim().length > 0) {
            if (state.quotes[target] && state.quotes[target].length > 0) {
                const randomQuote = state.quotes[target][Math.floor(Math.random() * state.quotes[target].length)];
                bot.chat(state.safeChat(`Quote from ${target}: "${randomQuote}"`));
            } else {
                bot.chat(state.safeChat(`No quotes found for ${target}.`));
            }
        } else {
            bot.chat(state.safeChat(`Usage: ${prefix}quote <username>`));
        }
    },
     [`${prefix}insult`]: (user, message, bot, state) => {
        const args = getArgs(message, prefix, "insult");
        let target = args[0];
        const insult = state.random_element(state.insults);
        if (target === 'random') {
            const players = Object.keys(bot.players);
            target = state.random_element(players);
        } else if (target === '|') {
            target = user;
        }
        if (target && target.trim().length > 0) {
            bot.chat(state.safeChat(`${target} ${insult}`));
        } else {
            bot.chat(state.safeChat(`${user} ${insult}`));
        }
    },

    [`${prefix}mental`]: (user, message, bot, state) => {
        const args = getArgs(message, prefix, "mental");
        let target = args[0];
        const result = state.random_element(state.illnesses);
        if (target === 'random') {
            const players = Object.keys(bot.players);
            target = state.random_element(players);
        } else if (target === '|') {
            target = user;
        }
        if (target && target.trim().length > 0) {
            bot.chat(state.safeChat(`${target} diagnosed with ${result}`));
        } else {
            bot.chat(state.safeChat(`${user} diagnosed with ${result}`));
        }
    },
      [`${prefix}restart`]: (user, message, bot, state) => {
        let counting = false
        if (state.server_restart !== 0) {
            bot.chat(state.safeChat(`Server will restart in approximately: ${state.server_restart} seconds.`))
            counting = true
        } else if (counting && state.server_restart === 0) {
            // bot.chat(state.safeChat("Countdown is 0, but server didn't restart, did it?"))
        } else {
            bot.chat(state.safeChat("Server didn't announce when server restarts."))
        }
    },
     [`${prefix}time`]: (user, message, bot, state) => {
        const timeOfDay = bot.time.timeOfDay;
        const day = bot.time.day;

        const timeState = timeOfDay === 0 ? 'Sunrise' :
                        timeOfDay < 6000 ? 'Morning' :
                        timeOfDay === 6000 ? 'Noon' :
                        timeOfDay < 12000 ? 'Afternoon' :
                        timeOfDay === 12000 ? 'Sunset' :
                        timeOfDay < 18000 ? 'Evening' :
                        timeOfDay === 18000 ? 'Midnight' :
                        'Night';

        const moonPhases = [
        'Full Moon', 'Waning Gibbous', 'Third Quarter',
        'Waning Crescent', 'New Moon', 'Waxing Crescent',
        'First Quarter', 'Waxing Gibbous'
        ];
        const moonPhaseIndex = bot.time.moonPhase;
        const moonPhase = moonPhases[moonPhaseIndex] || 'Unknown';

        bot.chat(state.safeChat(`Day ${day} | Time: ${timeState} (${Math.floor(timeOfDay)}/24000 ticks) | Moon Phase: ${moonPhase}`));
    },


     [`${prefix}jd`]: async (user, message, bot, state) => {
        const args = getArgs(message, prefix, "jd");
        let target = args[0] || user;
        if (target === 'random') {
            const players = Object.keys(bot.players);
            target = state.random_element(players);
        } else if (target === '|') {
            target = user;
        }
        if (!state.joindates[target]) {
            state.joindates[target] = await state.fetchJD(target.trim());
        }
        if (state.joindates[target] !== null) {
            bot.chat(state.safeChat(`${target} joined on: ${state.joindates[target]}`));
        } else {
            bot.chat(state.safeChat(`User ${target} doesn't exist or never joined.`));
            delete state.joindates[target];
        }
    },

    [`${prefix}cringe`]: (user, message, bot, state) =>
        bot.chat(state.handlePercentCmd(user, prefix, message, bot, state)),

    [`${prefix}swedish`]: (user, message, bot, state) =>
        bot.chat(state.handlePercentCmd(user, prefix, message, bot, state)),

    [`${prefix}european`]: (user, message, bot, state) =>
        bot.chat(state.handlePercentCmd(user, prefix, message, bot, state)),

    [`${prefix}white`]: (user, message, bot, state) =>
        bot.chat(state.handlePercentCmd(user, prefix, message, bot, state)),

    [`${prefix}aryan`]: (user, message, bot, state) =>
        bot.chat(state.handlePercentCmd(user, prefix, message, bot, state)),

    [`${prefix}nazi`]: (user, message, bot, state) =>
        bot.chat(state.handlePercentCmd(user, prefix, message, bot, state)),

    [`${prefix}gooner`]: (user, message, bot, state) =>
        bot.chat(state.handlePercentCmd(user, prefix, message, bot, state)),

    [`${prefix}clown`]: (user, message, bot, state) =>
        bot.chat(state.handlePercentCmd(user, prefix, message, bot, state)),

    [`${prefix}cap`]: (user, message, bot, state) => {
        const args = getArgs(message, prefix, "cap");
        let target = args[0];
        const result = state.random_element(state.cap_replies);
        if (target === 'random') {
            const players = Object.keys(bot.players);
            target = state.random_element(players);
        } else if (target === '|') {
            target = user;
        }
        if (target && target.trim().length > 0) {
            bot.chat(state.safeChat(`${target}: ${result}`));
        } else {
            bot.chat(state.safeChat(`${user}: ${result}`));
        }
    },

    [`${prefix}gender`]: (user, message, bot, state) => {
        const args = getArgs(message, prefix, "gender");
        let target = args[0];
        const result = state.random_element(state.gender_results);
        if (target === 'random') {
            const players = Object.keys(bot.players);
            target = state.random_element(players);
        } else if (target === '|') {
            target = user;
        }
        if (target && target.trim().length > 0) {
            bot.chat(state.safeChat(`${target}: ${result}`));
        } else {
            bot.chat(state.safeChat(`${user}: ${result}`));
        }
    },
    [`${prefix}npc`]: (user, message, bot, state) => {
        const args = getArgs(message, prefix, "npc");
        let target = args[0];
        const result = state.random_element(state.npc_replies);
        if (target === 'random') {
            const players = Object.keys(bot.players);
            target = state.random_element(players);
        } else if (target === '|') {
            target = user;
        }
        if (target && target.trim().length > 0) {
            bot.chat(state.safeChat(`${target}: ${result}`));
        } else {
            bot.chat(state.safeChat(`${user}: ${result}`));
        }
    },
     [`${prefix}fetish`]: (user, message, bot, state) => {
        const args = getArgs(message, prefix, "fetish");
        let target = args[0];
        const randomFetish = state.fetish_results[Math.floor(Math.random() * state.fetish_results.length)];
        if (target === 'random') {
            const players = Object.keys(bot.players);
            target = state.random_element(players);
        } else if (target === '|') {
            target = user;
        }
        if (target && target.trim().length > 0) {
            bot.chat(state.safeChat(`${target}'s fetish is: ${randomFetish}`));
        } else {
            bot.chat(state.safeChat(`${user}'s fetish is: ${randomFetish}`));
        }
    },

    [`${prefix}shower`]: (user, message, bot, state) => {
        const args = getArgs(message, prefix, "shower");
        let target = args[0];
        const days = Math.floor(Math.random() * 365);
        if (target === 'random') {
            const players = Object.keys(bot.players);
            target = state.random_element(players);
        } else if (target === '|') {
            target = user;
        }
        if (target && target.trim().length > 0) {
            bot.chat(state.safeChat(`${target} has showered last time ${days} days ago`));
        } else {
            bot.chat(state.safeChat(`${user} has showered last time ${days} days ago`));
        }
    },
      [`${prefix}playerlist`]: (user, message, bot, state) => {
        const players = Object.keys(bot.players).length;
        if (players.length === 0) {
            bot.chat(state.safeChat("No players online."));
        } else {
            const tabPlayers = bot.tablist?.header?.text.split('§cOnline players: §f')[1].replace('\n', '')
            bot.chat(state.safeChat(`Players in-game: ${players}, Players in-total: ${tabPlayers}`));
        }
    },
     [`${prefix}kd`]: (user, message, bot, state) => {
        const args = getArgs(message, prefix, "kd");
        let target = args[0];
        if (target === 'random') {
            const players = Object.keys(bot.players);
            target = state.random_element(players);
        } else if (target === '|') {
            target = user;
        }
        if (target && target.trim().length > 0) {
            bot.chat(state.safeChat(state.get_kd(target, state)));
        } else {
            bot.chat(state.safeChat(state.get_kd(user, state)));
        }
    },


    [`${prefix}screen`]: (user, message, bot, state) => {
        const args = getArgs(message, prefix, "screen");
        let target = args[0];
        const screen = state.random_element(state.screen_replies);
        if (target === 'random') {
            const players = Object.keys(bot.players);
            target = state.random_element(players);
        } else if (target === '|') {
            target = user;
        }
        if (target && target.trim().length > 0) {
            bot.chat(state.safeChat(`${target}'s screen right now: ${screen}`));
        } else {
            bot.chat(state.safeChat(`${user}'s screen right now: ${screen}`));
        }
    },

    [`${prefix}ping`]: (user, message, bot) => bot.chat(`${user}'s ping: ${bot.players[user]?.ping || '??'}ms`),
    [`${prefix}8ball`]: (user, message, bot) => {
        const res = ["Yes", "No", "Signs point to yes", "Better not tell you now"];
        bot.chat(`8Ball: ${res[Math.floor(Math.random()*res.length)]}`);
    },
    [`${prefix}tps`]: (user, message, bot) => bot.chat(`Server TPS: ${bot.getTps()}`),
    [`${prefix}discord`]: (user, message, bot) => bot.chat(`Join: discord.gg/6b6t`)
    // NOTE: All other fun commands (flip, roll, choose) follow this same pattern
};

const whitelisted_commands = {
    [`${prefix}kit refill`]: async (user, message, bot) => {
        bot.chat(`/msg ${user} Heading to stash at ${state.STASH.x}, ${state.STASH.z}...`);
        await runRefill(bot, user);
    }
};

const admin_commands = {
     [`${prefix}forcesave`]: (user, message, bot, state) => {
            if (superusers.map(u => u.toLowerCase()).includes(user.toLowerCase())) {
            state.saveBotData(state)
        }
    },

    [`${prefix}checkuses`]: (user, message, bot, state) => {
        console.log(state.safeChat(state.bot_uses))
    },    

    [`${prefix}debug`]: (user, message, bot, state) => {
        const args = getArgs(message, prefix, "debug");
        const section = args[0];
        if (section && section.trim().length > 0) {
            if (section === 'basic') {
                const loadedChunks = Object.keys(bot.world?.chunks || {}).length || 'None';
                const openWindow = bot.currentWindow?.title || 'None';
                const heldItem = bot.heldItem?.name || 'None';
                bot.chat(`/msg ${user} Chunks: ${loadedChunks} | Window: ${openWindow} | Held: ${heldItem}`);
                console.log(bot.entities || 'None');
                console.log(bot.tablist || 'None');
                console.log(bot.players || 'None');
            } else if (section === 'inventory') {
                console.log(bot.inventory?.items() || 'None');
            } else if (section === 'entityData') {
                const entities = Object.values(bot.entities || {});
                if (entities.length === 0) console.log('None');
                else entities.forEach(e => {
                    console.log(`Type: ${e.type || 'None'}, UUID: ${e.uuid || 'None'}, Vel: ${e.velocity || 'None'}`);
                });
            } else if (section === 'window') {
                console.log(bot.currentWindow?.title || 'None');
                console.log(bot.currentWindow?.slots || 'None');
            } else if (section === 'pathfinder') {
                console.log(bot.pathfinder?.goal || 'None');
                console.log(bot.pathfinder?.path || 'None');
            } else if (section === 'chatListeners') {
                const listeners = bot._client?.listeners('chat') || [];
                console.log(listeners.length > 0 ? listeners : 'None');
            } else if (section === 'settings') {
                const info = {
                    username: bot.username || 'None',
                    version: bot.version || 'None',
                    health: bot.health || 'None',
                    food: bot.food || 'None',
                    xp: bot.experience || 'None',
                    creative: bot.game?.gameMode === 1 ? 'Yes' : 'No',
                    isAlive: bot.health > 0 ? 'Yes' : 'No'
                };
                const settingsMsg = Object.entries(info).map(([k, v]) => `${k}: ${v}`).join(' | ');
                bot.chat(`/msg ${user} ${settingsMsg}`);
            } else if (section === 'network') {
                const ping = bot.player?.ping || 'None';
                const latency = bot._client?.latency || 'None';
                const brand = bot.serverBrand || 'None';
                const stateClient = bot._client?.state || 'None';
                bot.chat(`/msg ${user} Ping: ${ping} | Brand: ${brand} | Latency: ${latency} | State: ${stateClient}`);
            } else if (section === 'skin') {
                console.log('Skin Parts:', bot.player?.skinParts || 'None');
            } else if (section === 'players') {
                const list = Object.keys(bot.players || {});
                bot.chat(`/msg ${user} Online Players (${list.length}): ${list.length > 0 ? list.join(', ') : 'None'}`);
            } else if (section === 'plugins') {
                console.log('Scoreboard Teams:', bot.scoreboard?.teams || 'None');
                console.log('Plugin Channels:', bot._client?.pluginChannels || 'None');
            } else if (section === 'state') {
                bot.chat(`/msg ${user} Bot State: spawned ${state.spawnedIn || 'None'} times`);
                console.log(state || 'None');
            } else if (section === 'raw') {
                console.log(bot || 'None');
            } else if (section === 'tablist') {
                console.log(bot.tablist || 'None');
            } else if (section === 'sections' || section === 'list') {
                const debugSections = [
                    'basic', 'inventory', 'entityData', 'window', 'pathfinder',
                    'chatListeners', 'settings', 'network', 'skin', 'players',
                    'plugins', 'state', 'raw', 'tablist', 'sections'
                ];                
                bot.chat(`/msg ${user} Available debug sections: ${debugSections.join(', ')}`);
            } else {
                bot.chat(`/msg ${user} Unknown debug section: "${section}". Run ${prefix}debug sections.`);
            }

            console.log(`[DEBUG] ${user} ran debug "${section}"`);
        } else {
            const loadedChunks = Object.keys(bot.world?.chunks || {}).length || 'None';
            const openWindow = bot.currentWindow?.title || 'None';
            const creative = bot.game?.gameMode === 1 ? 'Yes' : 'No';
            const flying = bot.entity?.onGround === false ? 'Yes' : 'No';
            const held = bot.heldItem?.name || 'None';
            const ping = bot.player?.ping || 'None';
            const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) || 'None';

            const info = `Ping: ${ping} | Chunks: ${loadedChunks} | Window: ${openWindow} | Creative: ${creative} | Flying: ${flying} | Held: ${held} | Memory: ${mem}MB`;
            bot.chat(`/msg ${user} ${info} — run "${prefix}debug (section)" for more.`);
        }
    },


    [`${prefix}run`]: (user, message, bot, state) => {
        const message_to_run = message.split(`${prefix}run `)[1];
        if (message_to_run && message_to_run.trim() !== '') {
            const blacklist = ["/ignore", "/delhome", "/freecam", "/balloons", "/tpy", "/kill", "/suicide",
                "/togglewhispering", "/togglechat", "/hotspot", "/hotspot create"
            ];
            if (!blacklist.some(cmd => message_to_run.includes(cmd))) {
                bot.chat(message_to_run);
            } else {
                bot.chat(state.safeChat("Blacklisted command!"));
            }
        } else {
            bot.chat(`/w ${user} Usage -run <command?>`)
        }
    },

    [`${prefix}say`]: (user, message, bot, state) => {
        const message_to_run = message.split(`${prefix}say `)[1];
        if (message_to_run && message_to_run.trim() !== '') {
            bot.chat(state.safeChat(` ${message_to_run}`)) // space at start doesn't let any commands to run
        } else {
            bot.chat(`/w ${user} Usage -say <message>`)
        }
    },

    [`${prefix}welcomer`]: (user, message, bot, state) => {
       state.welcomer = !state.welcomer;
       bot.chat(state.safeChat(`Scanner is now ${state.welcomer ? "ON" : "OFF"}!`));
    },

    [`${prefix}tempwl`]: (user, message, bot, state) => {
        let args = message.split(`${prefix}tempwl `)[1];
        state.whitelist.push(String(args))
        console.log(`Whitelisted ${args}.`)
        bot.chat(`/msg ${user} Whitelisted ${args}.`)
    },

    [`${prefix}remwl`]: (user, message, bot, state) => {
        let args = message.split(`${prefix}remwl `)[1];
        if (superusers.map(u => u.toLowerCase()).includes(user.toLowerCase())) {
            if (!state.whitelist.includes(args)) {
                bot.whisper(user, `${args} is not in the whitelist.`);
                return;
            }

            state.whitelist = state.whitelist.filter(p => p !== args);
            console.log(`Removed ${args} from whitelist.`)
            bot.chat(`/msg ${user} Removed ${args} from whitelist.`)
        }
    },
    [`${prefix}timeout`]: (user, message, bot, state) => {
        if (superusers.map(u => u.toLowerCase()).includes(user.toLowerCase())) {
            bot.chat(state.safeChat("Removing keep_alive listener!, timing out in 30 seconds as of now."))
            bot._client.removeAllListeners('keep_alive');    
        }
    }
};

// make sure state references the command collections
state.public_commands = public_commands;
state.admin_commands = admin_commands;

// --- 3. REFILL CORE ---
async function runRefill(bot, user) {
    try {
        const mcData = require('minecraft-data')(bot.version);
        bot.pathfinder.setMovements(new Movements(bot, mcData));
        await bot.pathfinder.goto(new GoalBlock(state.STASH.x, state.STASH.y, state.STASH.z));
        
        const block = bot.blockAt(new mineflayer.vec3(state.STASH.x, state.STASH.y, state.STASH.z));
        const container = await bot.openContainer(block);
        const item = container.containerItems()[0]; // Take the first item found
        if (item) {
            await container.withdraw(item.type, null, 1);
            bot.chat(`/msg ${user} Item withdrawn. TPing now...`);
        }
        await container.close();
        bot.chat(`/tpa ${user}`);
    } catch (err) {
        bot.chat(`/msg ${user} Refill failed: Chest not found or path blocked.`);
    }
}

// --- 4. STARTUP & PROXY FIX ---
function startup() {
    const bot = mineflayer.createBot({
        host: 'alt3.6b6t.org',
        username: process.env.MC_USERNAME || 'Regalforger',
        version: '1.20.1',
        auth: 'offline',
        connectTimeout: 90000
    });

    bot.loadPlugin(tpsPlugin);
    bot.loadPlugin(pathfinder);

    // load and begin saving persistent data on first startup
    if (!started_saving) {
        state.loadBotData(state);
        state.startAutoSave(state);
        started_saving = true;
    }

    // try loading external commands file if present (safe to ignore failures)
    try {
        const cmds = require('./commands');
        if (cmds.public_commands) state.public_commands = cmds.public_commands;
        if (cmds.admin_commands) state.admin_commands = cmds.admin_commands;
    } catch (e) {
        // file not present or failed; ignore
    }

    // register additional events if helper function is available
    if (typeof registerEvents === 'function') {
        registerEvents(bot, state);
    }

    bot.on('messagestr', (message) => {
        if (message.includes('/login')) bot.chat(`/login ${process.env.MC_PASSWORD}`);
        
        // Proxy Redirect Survival Logic
        if (message.includes('Connecting to the server...') || message.includes('reserving a spot')) {
            state.transitionMode = true;
            bot.physics.enabled = false;
            const lookInterval = setInterval(() => {
                if (!state.transitionMode) return clearInterval(lookInterval);
                bot.look(bot.entity.yaw + 0.2, 0, true);
            }, 1000);
        }
    });

    bot.on('chat', (username, message) => {
        if (username === bot.username) return;
        const msg = message.toLowerCase();

        // 1. Check Admin Commands
        if (state.isAdmin(username)) {
            for (const cmd in admin_commands) {
                if (msg.startsWith(cmd)) return admin_commands[cmd](username, message, bot);
            }
        }

        // 2. Check Whitelisted Commands
        if (state.isWhitelisted(username)) {
            for (const cmd in whitelisted_commands) {
                if (msg.startsWith(cmd)) return whitelisted_commands[cmd](username, message, bot);
            }
        }

        // 3. Public Commands
        for (const cmd in public_commands) {
            if (msg.startsWith(cmd)) return public_commands[cmd](username, message, bot);
        }
    });

    bot.on('spawn', () => {
        if (state.transitionMode) {
            setTimeout(() => {
                state.transitionMode = false;
                bot.physics.enabled = true;
                console.log("Bot stabilized on main server.");
            }, 5000);
        }
    });

    // additional event logic borrowed from friend's events file
    let {
        spam_messages = [],
        blacklisted_messages = [],
        return_user,
        checkSpam,
        whitelisted_users,
        admin_commands: friend_admin_commands,
        public_commands: friend_public_commands,
        responses = {},
        PASSWORD,
        welcomer = false,
    } = state;

    bot.on('spawn', () => {
        state.spawnedIn = (state.spawnedIn || 0) + 1;

        if (!state.tips_started && state.spawnedIn == 2) {
            let tipIndex = 0;
            state.tips_started = true
            setInterval(() => {
                if (spam_messages.length === 0) return;

                bot.chat(spam_messages[tipIndex]);
                tipIndex = (tipIndex + 1) % spam_messages.length;
                state.bot_tips_sent = (state.bot_tips_sent || 0) + 1;
            }, 180000); // every 3 minutes
        }
    });

    bot.on("playerCollect", async (collector, collected) => {
        if (collector.username === bot.username) {
            const inventory = bot.inventory.items();
            for (const item of inventory) {
                await bot.tossStack(item);
            }
        }
    });

    bot.on('login', () => {
        console.log('Logged In');
        bot.setControlState("forward", true);
        bot.setControlState("jump", true);
    });

    bot.on('bossBarCreated', async (bossBar) => {
        const bossBar_text = bossBar?.title?.text;

        if (state.auto_tp) state.auto_tp = false;

        if (typeof bossBar_text === "string" && bossBar_text.includes("teleport with /hotspot") && state.scan_hotspot) {
            bot.chat("/hotspot");
            setTimeout(() => {
                const pos = bot.entity.position;
                const info = `${Math.floor(pos.x)}.X, ${Math.floor(pos.y)}.Y, ${Math.floor(pos.z)}.Z in minecraft:${bot.game.dimension}`;
                state.safeChat(`Hotspot Located At: ${info}`, bot);
                state.hotspot_death = true;
                bot.chat("/kill");
                state.hotspot_death = false;
            }, 10750);
        }
    });

    bot.on("death", () => {
        console.log("Died!");
        bot.clearControlStates(); // Planned to make it more human, but meh
        bot.setControlState("forward", true);
        bot.setControlState("jump", true);

        if (!state.hotspot_death) {
            state.deaths = (state.deaths || 0) + 1;
        }
    });

    bot.on('messagestr', (message) => {
        const username = return_user ? return_user(message) : '';
        let command = message.split('» ')[1] || message.split("whispers: ")[1] || '';

        if (state.spawnedIn < 2) {
            if (!state.loggedIn) {
                if (message.includes("/login")) {
                    bot.chat(`/login ${PASSWORD}`);
                    state.loggedIn = true;
                } else if (message.includes("/register")) {
                    bot.chat(`/register ${PASSWORD}`);
                    state.loggedIn = true;
                }
            }
            return;
        }

        if (state.spawnedIn >= 2 && !blacklisted_messages.some(blk => message.includes(blk)) && message.trim() !== '') {
            console.log(message);      
        }

        if (message.includes('»')) {
            const blacklist = ["moooomoooo", "7thSealBot", ".22", "kazwqi", "KaizBot", "KitBot1"];
            if (blacklist.includes(username.toLowerCase())) return; // case-insensitive check
        
            const msgLower = message.toLowerCase();
            
            const isAd =
                msgLower.includes("join ") ||
                msgLower.includes("subscribe") ||
                msgLower.includes("free kits") ||
                msgLower.includes("discord.gg") ||
                msgLower.includes("dsc.gg") ||
                msgLower.includes(".com") ||
                msgLower.includes(".net") ||
                msgLower.includes(".org") ||
                msgLower.includes(".uk") ||
                /\b\d{1,3}(\.\d{1,3}){3}\b/.test(msgLower);
        
            const isCommand = msgLower.startsWith('-') || msgLower.startsWith('/');
        
            let cleanedMessage = message.replace(/^\[[^\]]+\]\s*/, '');
            cleanedMessage = cleanedMessage.replace(/<\/?Malachite>/g, '');
        
            const msgText = cleanedMessage.split('» ')[1] || '';
            if (!isAd && !isCommand && /^[\x00-\x7F\s.,'?!\-":;()0-9]+$/.test(msgText)) {
                if (!state.quotes[username]) state.quotes[username] = [];
        
                const newMsg = cleanedMessage.trim();
                const lastFew = state.quotes[username].slice(-5);
                const alreadyExistsRecently = lastFew.some(q => {
                    const existingMsg = q.substring(q.indexOf('>') + 2).trim();
                    return existingMsg.toLowerCase() === newMsg.toLowerCase();
                });
                if (alreadyExistsRecently) return;
        
                const now = new Date();
                const date = now.toISOString().slice(0, 10);
                const time = now.toTimeString().slice(0, 5);
                const timestamp = `${date} ${time}`;
        
                state.quotes[username].push(`<${timestamp}> ${newMsg}`);
            }
        }


        if (state.auto_tp) {
            const teleport = ['tp', 'come', 'teleport', 'give me'];
            if (teleport.some(word => command.toLowerCase().includes(word)) && !command.includes("http")) {
                console.log("Teleporting to", username);
                bot.chat(`/tpa ${username}`);
            }
        }

        if (state.loggedIn && state.spawnedIn >= 2) {
            if (command.startsWith("<Malachite>")) {
                command = command.replace("<Malachite>", "").replace("</Malachite>", "");
            }

            if (command.startsWith(state.prefix)) {
                const cmd = command.split(" ")[0].toLowerCase();

                if (message.includes(".org") || message.includes(".uk") || message.includes(".com") || message.includes(".gg") || message.includes(".me")) return;

                if (whitelisted_users && whitelisted_users(username)) {
                    for (const key in admin_commands) {
                        if (cmd.trim() === key.toLowerCase()) {
                            admin_commands[key](username, command, bot, state);
                            break;
                        }
                    }
                }

                for (const key in public_commands) {
                    if (cmd.trim() === key.toLowerCase()) {
                        public_commands[key](username, command, bot, state);
                        break;
                    }
                }

                state.bot_uses = (state.bot_uses || 0) + 1;
            }
        }


        if (message.includes('dsc.gg') || message.includes('discord.gg')) {
            state.ads_seen = (state.ads_seen || 0) + 1;
        }

        if (message.includes('dupe') && !(message.includes('dsc.gg') || message.includes('discord.gg')) ) {
            state.dupe_mentioned = (state.dupe_mentioned || 0) + 1;
        }        
        if (message.includes("Server restarts in") && !message.includes('»')) {
            // Server restarts in 25200s
            if (state.server_restart === 0) {
                state.server_restart = Number(message.split('Server restarts in ')[1].replace('s', '').trim())
                
                setInterval(() => {
                    state.server_restart--;
                }, 1000)
            }
        }

        // cooldown

        if ((message.includes('Please wait') && message.includes('seconds before sending another message!')) && !message.includes('»')) {
            let seconds_of_cooldown = parseInt(message.split('Please wait ')[1].split('seconds before sending another message!')[0].replace('s', ''))
            state.cooldown = seconds_of_cooldown

            if (!state.longest_cooldown || seconds_of_cooldown > state.longest_cooldown) {
                state.longest_cooldown = seconds_of_cooldown;
            }            
        }

        if (message.includes("died") && !message.includes('»')) {
            state.global_deaths = (state.global_deaths || 0) + 1;

            if (message.includes('vined_on_top')) {
                state.vined_on_top_deaths = (state.vined_on_top_deaths || 0) + 1;
            }

            if (message.includes('i_am_vined')) {
                state.i_am_vined_deaths = (state.i_am_vined_deaths || 0) + 1;
            }

            if (message.includes('1nvoke_')) {
                state.damix_deaths = (state.damix_deaths || 0) + 1;
            }
        }

        if (message.includes("using an end crystal") && !message.includes('»')) {
            const get_killer = message.split("by ")[1].split(" using")[0].trim();
            const get_victim = message.split(" was")[0].trim();

            state.crystalled = (state.crystalled || 0) + 1;
            state.global_deaths = (state.global_deaths || 0) + 1;

            if (get_killer !== get_victim) {
                state.crystal_kills[get_killer] = (state.crystal_kills[get_killer] || 0) + 1;
                state.crystal_deaths[get_victim] = (state.crystal_deaths[get_victim] || 0) + 1;
            }
        }

        if (message.includes("/tpy")) {
            if (message.includes("1nvoke_")) {
                bot.chat(`/tpy 1nvoke_`);
            } else if (message.includes("PiercingC1aws")) {
                bot.chat(`/tpy PiercingC1aws`);
            } else {
                const decline_username = message.split(' wants to teleport to you.')[0]
                bot.chat(`/tpn ${decline_username}`);
            }
        }

        for (const response in responses) {
            if (message.includes(response) || command.includes(response)) {
                responses[response](message);
            }
        }

        if (message.includes("joined") && !message.includes('»')) {
            let joined_user = message.split(" joined")[0]

            if (welcomer && !message.includes(bot.username)) {
                const player = message.split("joined")[0].trim();
                console.log(`Player ${player} currently joined.`);
                bot.chat(`/whisper ${player} Welcome to 6b6t.org ${player}!`);
            }
            if (message.includes('the game for the first time')) {
                state.newest_player = true
            } else {
                state.newest_player = false
            }

            state.recent_join = joined_user
            state.joined++;

            /*if (!state.session[joined_user]) {
                state.session[joined_user] = {
                sessions: [{
                    joined: Date.now(),
                    quit: 0,
                    total: 0
                }]
            }}

            else if (state.session[joined_user] && state.session[joined_user].quit !== 0) {
                state.session[joined_user].sessions.joined = Date.now();
                state.session[joined_user].sessions.quit = 0;
            }*/
        }

        if (message.includes("quit") && !message.includes('»')) {
            let quitted_user = message.split(" quit")[0]     
            state.recent_quit = quitted_user       
            state.quitted++;

            /*if (state.session[quitted_user] && state.session[quitted_user].quit === 0) {
                state.session[quitted_user].quit = Date.now()
                state.session[quitted_user].total += state.session[quitted_user].quit - state.session[quitted_user].joined
            } */
        }
    });
  
    bot.on('packet', (data, meta) => {
        if (meta.name === 'update_time') {
            if (state.currentWorldAge === 0) {
                state.currentWorldAge = data.age
                state.timeLast = Date.now()
            } else {
                let now = Date.now()
                getServerTPS(state.currentWorldAge, data.age, (now-timeLast), state.restarted)
                state.currentWorldAge = data.age
                state.timeLast = now            
            }
            // "please chatgpt give me an schematic and not a full code, i want to learn actually"
            // said by 1nvoke_, everytime trying to code something and chatgpt gives full code
            // WOAH?!! CHATGPT USER USING CHATGPT TO ACTUALLY STUDY!??
            // night ignore that comment, im so tired mentally once again (calculating tps is stupid)
            // the comments will be longer than the setup overall
        }
    })

    // --- UPDATED RECONNECT LOGIC ---
    let attempts = 0;
    const MAX_ATTEMPTS = 7;
    
    function handleRestart(reason) {
        console.log(`Disconnected: ${reason}. Attempting to reconnect...`);
        
        if (attempts < MAX_ATTEMPTS) {
            attempts++;
            console.log(`Reconnect attempt ${attempts}/${MAX_ATTEMPTS} in 8 seconds...`);
            setTimeout(() => {
                startup(); // This calls your main bot function again
            }, 8000); // 8 second gap
        } else {
            console.log("Max reconnect attempts reached. Manual restart required via GitHub Workflows.");
            process.exit(1); // Tells GitHub the process failed
        }
    }
    
    // Replace your old bot.on('kicked') and 'error' with these:
    bot.on('kicked', (reason) => handleRestart(reason));
    bot.on('error', (err) => handleRestart(err.code));
    
    // Reset attempts on successful spawn
    bot.on('spawn', () => {
        attempts = 0; 
        console.log("Regalforger is online and stable.");
    });

    bot.on('end', (reason) => {
        console.log('[Disconnected]', reason);
        bot.quit()
        if (state.restart) {
            state.loggedIn = false;
            state.restarted = true;
            state.spawnedIn = 0;
            setTimeout(() => global.startup(), 10000);
        }
    });


}

startup();