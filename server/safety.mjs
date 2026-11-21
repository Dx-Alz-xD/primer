// =====================================================================
// Safe framing for risky topics.
//
// Primer doesn't turn a topic away; it changes how the topic is taught.
// screen(text) spots requests that lean towards serious harm and says
// how to frame them:
//   harm      how to make, get or use something dangerous (explosives,
//             weapons, poisons, drugs, malware, violence, fraud). The
//             course stays on the public side: the science in general
//             terms, history, legitimate uses, safety, law, prevention.
//   hate      a hateful or extremist premise ("why Hitler was right").
//             Taught as critical history, never as agreement.
//   selfharm  someone who may be struggling. A gentle course on coping
//             and finding help, with a helpline.
//   refuse    sexual content involving children: never written.
// It's a quick local word check, so it needs no AI request and also
// covers the offline sample courses. The AI prompts carry the same rules
// for anything it misses (other phrasings, other languages).
// =====================================================================

// Lower case, accents dropped, everything that isn't a letter or digit turned
// into one space, with a space at each end so phrases only match whole words.
export function norm(s) {
  return ' ' + String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
}

// One pattern for a list of phrases written as plain words ("pipe bombs?").
const words = (list) => new RegExp(' (?:' + list.join('|') + ')(?= )');
const wordsAll = (list) => new RegExp(' (?:' + list.join('|') + ')(?= )', 'g');

// Everyday phrases that only look dangerous: removed before checking.
const HARMLESS = wordsAll([
  'bath bombs?', 'seed bombs?', 'bomb calorimet[a-z]*', 'photo ?bomb[a-z]*', 'f bombs?', 'bomb cyclones?', 'love bomb[a-z]*', 'bomb pops?',
  'glue guns?', 'hot glue guns?', 'nail guns?', 'staple guns?', 'spray guns?', 'heat guns?', 'paint ?ball guns?', 'water guns?', 'nerf guns?',
  'squirt guns?', 'top gun', 'radar guns?', 'foam guns?', 'smoking guns?', 'big guns', 'guns n roses', 'grease guns?', 'caulking guns?',
  'massage guns?', 'tattoo guns?', 'water pistols?', 'starting pistols?', 'sex pistols', 'pistol squats?',
  'bullet points?', 'bullet journal[a-z]*', 'bullet ?proof coffee', 'silver bullets?', 'magic bullets?', 'bullet trains?', 'bullet charts?', 'bullet graphs?',
  'poison ivy', 'poison oak', 'food poisoning', 'lead poisoning', 'poison dart frogs?',
  'rid of weeds?', 'weed control', 'weed killers?', 'weeding', 'bath salts',
  'life ?hacks?', 'growth hack[a-z]*', 'hackathons?', 'hacker news',
  'kill (?:a |the )?(?:process|processes|task|tasks|job|jobs|thread|threads|session|server|program|app|command|switch)', 'kill time', 'killing time', 'overkill',
  'heart attacks?', 'panic attacks?', 'asthma attacks?', 'attack surface', 'attack on titan',
  'shoot (?:a |the )?(?:photos?|videos?|films?|movies?|scenes?|portraits?|weddings?|hoops|basketball)', 'photo ?shoots?', 'shooting stars?', 'trouble ?shoot[a-z]*'
]);

// Words that show someone wants to make, get or use the thing.
const INTENT = words([
  'make', 'makes', 'making', 'made', 'build', 'builds', 'building', 'assemble', 'assembling', 'construct', 'constructing', 'create', 'creating',
  'craft', 'crafting', 'cook', 'cooking', 'synthesi[sz]e', 'synthesi[sz]ing', 'synthesis', 'produce', 'producing', 'production',
  'manufacture', 'manufacturing', 'home ?made', 'diy', 'do it yourself', 'recipes?', 'ingredients', 'brew', 'brewing', 'extract', 'extracting',
  'grow', 'growing', 'weaponi[sz]e', 'weaponi[sz]ing', 'detonate', 'detonating', 'set off', 'blow up', 'rig', 'plant',
  '3d print(?:ed|ing)?', 'convert', 'converting', 'buy', 'buying', 'obtain', 'acquire', 'smuggle', 'smuggling', 'hide', 'hiding',
  'use', 'using', 'deploy', 'deploying', 'write', 'writing', 'code', 'coding', 'develop', 'developing', 'spread', 'spreading', 'launch', 'launching',
  'how to', 'how do i', 'how can i', 'how would i', 'how do you', 'steps? to', 'guide to', 'tutorial', 'instructions?', 'step by step', 'plan', 'planning'
]);

// Dangerous things, by area, with the safe course each area becomes.
// "things" need an intent word nearby; "acts" are intent on their own.
const AREAS = {
  cbrn: {
    label: 'chemical, biological or nuclear weapons',
    title: 'Weapons of Mass Destruction: Science, History and Treaties', phrase: 'weapons of mass destruction',
    things: words(['nerve agents?', 'sarin', 'vx', 'tabun', 'soman', 'novichok', 'mustard gas', 'chlorine gas', 'phosgene', 'poison gas', 'toxic gas',
      'ricin', 'abrin', 'botulinum toxin', 'bio ?weapons?', 'biological weapons?', 'chemical weapons?', 'dirty bombs?',
      'nuclear (?:bombs?|weapons?|warheads?|devices?)', 'atomic bombs?', 'h bombs?', 'hydrogen bombs?', 'nukes?', 'weapons grade',
      'enrich(?:ed|ing)? uranium', 'uranium enrichment', 'bioterror(?:ism)?']),
    acts: words(['weaponi[sz](?:e|ing|ed) (?:anthrax|smallpox|plague|pathogens?|viruses?|bacteria|a virus|diseases?)'])
  },
  explosives: {
    label: 'explosives',
    title: 'The Chemistry and Safety of Explosives', phrase: 'the chemistry and safety of explosives',
    things: words(['bombs?', 'explosives?', 'explosive devices?', 'ieds?', 'improvised explosives?', 'pipe bombs?', 'car bombs?', 'nail bombs?',
      'pressure cooker bombs?', 'fertili[sz]er bombs?', 'letter bombs?', 'grenades?', 'detonators?', 'blasting caps?', 'tatp', 'acetone peroxide',
      'petn', 'rdx', 'hmx', 'tnt', 'nitroglycerine?', 'c ?4', 'semtex', 'dynamite', 'thermite', 'napalm', 'molotovs?', 'molotov cocktails?',
      'black powder', 'gun ?powder', 'flash powder', 'ammonium nitrate', 'anfo', 'suicide vests?', 'landmines?', 'fireworks?', 'firecrackers?',
      'incendiary (?:devices?|weapons?)'])
  },
  weapons: {
    label: 'weapons',
    title: 'Firearms: History, Law and Safety', phrase: 'firearms, their history, law and safety',
    things: words(['guns?', 'firearms?', 'rifles?', 'pistols?', 'handguns?', 'shotguns?', 'revolvers?', 'ak ?47s?', 'ar ?15s?', 'ghost guns?', 'zip guns?',
      'silencers?', 'suppressors?', 'auto sears?', 'bump stocks?', 'ammunition', 'ammo', 'machine guns?', 'sub ?machine guns?',
      'assault rifles?', 'flamethrowers?', 'switchblades?', 'brass knuckles', 'knuckle dusters?'])
  },
  poison: {
    label: 'poisons',
    title: 'Toxicology: How Poisons Affect the Body', phrase: 'toxicology and how poisons affect the body',
    things: words(['poisons?', 'poisoning', 'cyanide', 'arsenic', 'strychnine', 'thallium', 'polonium', 'untraceable poisons?'])
  },
  drugs: {
    label: 'illegal drugs',
    title: 'Drugs: How They Act on the Body and Their Risks', phrase: 'how drugs act on the body and their risks',
    things: words(['meth', 'methamphetamine', 'crystal meth', 'amphetamines?', 'fentanyl', 'carfentanil', 'heroin', 'cocaine', 'crack cocaine',
      'freebase', 'lsd', 'mdma', 'ecstasy', 'ghb', 'dmt', 'pcp', 'ketamine', 'opium', 'morphine', 'oxycodone', 'mescaline', 'psilocybin',
      'magic mushrooms', 'shrooms', 'cannabis', 'weed', 'marijuana', 'hash oil', 'synthetic cannabinoids'])
  },
  cyber: {
    label: 'hacking and malware',
    title: 'Cybersecurity: How Attacks Work and How to Defend', phrase: 'cybersecurity, how attacks work and how to defend',
    things: words(['malware', 'ransomware', 'computer virus(?:es)?', 'trojans?', 'trojan horses?', 'keyloggers?', 'botnets?', 'spyware', 'stalkerware',
      'rootkits?', 'phishing (?:kits?|pages?|sites?|emails?)', 'ddos(?:ing)?', 'dos attacks?', 'zero days?', 'exploit kits?', 'credential stealers?',
      'password stealers?', 'info ?stealers?', 'remote access trojans?', 'backdoors?', 'sql injection', 'xss', 'cross site scripting']),
    acts: words(['hack(?:ing)? into', 'hack(?:ing)? (?:someone|somebody|a person|people|my|his|her|their)', 'hack(?:ing)? (?:an? )?(?:instagram|facebook|whatsapp|snapchat|gmail|email|wifi|wi fi|phone|accounts?|passwords?|bank)',
      'crack(?:ing)? (?:passwords?|wifi|wi fi|software|licen[cs]e keys?)', 'password cracking', 'sim swap(?:ping)?', 'carding', 'card skimming',
      'doxx?(?:ing)?', 'swatting', 'bypass(?:ing)? (?:2fa|two factor|authentication|antivirus)'])
  },
  violence: {
    label: 'violence against people',
    title: 'Understanding and Preventing Violence', phrase: 'understanding and preventing violence',
    things: words(['terror(?:ist)? attacks?', 'mass shootings?', 'school shootings?', 'assassinations?', 'bombings?', 'massacres?', 'arson']),
    acts: words([
      '(?:kill|killing|murder|murdering|stab|stabbing|shoot|shooting|strangle|strangling|poison|poisoning|hurt|hurting|harm|harming|torture|torturing|kidnap|kidnapping|abduct|abducting|attack|attacking|beat up|beating up|assault|assaulting|rape|raping|drug|drugging) ' +
        '(?:someone|somebody|anyone|a person|people|a human|humans|him|her|them|a man|a woman|a girl|a boy|a child|children|kids|a kid|an animal|animals|' +
        '(?:my|his|her|their|a) (?:wife|husband|partner|girlfriend|boyfriend|ex|mom|mum|mother|dad|father|parents?|brother|sister|son|daughter|baby|child|kids?|boss|teacher|classmate|friend|neighbou?r|roommate|coworker|colleague|family|dog|cat|pet))',
      'get away with (?:murder|killing|it|a crime|rape)', 'hire a hitman', 'untraceable ways? to kill'
    ])
  },
  crime: {
    label: 'fraud and other crimes',
    title: 'How Fraud and Forgery Are Detected and Prevented', phrase: 'how fraud and forgery are detected and prevented',
    things: words(['launder(?:ing)? money', 'counterfeit(?:ing)? (?:money|currency|notes|bills)', 'fake (?:money|ids?|passports?|licen[cs]es?|documents?|degrees?|certificates?)',
      'forg(?:e|ing|ery) (?:an? )?(?:signatures?|passports?|documents?|cheques?|checks?|ids?)', 'credit card fraud', 'fraud', 'identity theft',
      'steal(?:ing)? (?:an? )?(?:car|cars|identity|identities|credit cards?|money|bikes?)', 'shoplift(?:ing)?', 'hotwir(?:e|ing) (?:a )?cars?',
      'evad(?:e|ing) (?:the )?police', 'tax evasion', 'evade taxes', 'ponzi schemes?', 'pyramid schemes?', 'scam(?:ming)? (?:people|someone|the elderly|old people)',
      'blackmail(?:ing)?', 'extort(?:ion|ing)?', 'human trafficking', 'traffick?(?:ing)? (?:people|humans|girls|women|children)',
      'smuggl(?:e|ing) (?:drugs|people|weapons|guns)'])
  }
};

const SELF_HARM = words([
  'suicide methods?', 'methods? of suicide', 'ways? to (?:commit )?suicide', 'how to (?:commit )?suicide', 'commit(?:ting)? suicide',
  'kill(?:ing)? myself', 'end(?:ing)? my life', 'tak(?:e|ing) my (?:own )?life', 'painless (?:death|suicide|ways? to die)', 'die painlessly',
  'want to die', 'wanna die', 'self ?harm(?:ing)?', 'self injury', 'cut(?:ting)? myself', 'hurt(?:ing)? myself', 'hang(?:ing)? myself',
  'starv(?:e|ing) myself', 'overdose on', 'how to overdose'
]);

// Hateful premises: a subject plus a claim that it was right, or that it never happened.
const HATE_SUBJECTS = [
  ['adolf hitler|hitler', 'Hitler and Nazi Ideology'],
  ['the nazis|nazis?|nazism|national socialism|the third reich|third reich', 'Nazi Germany'],
  ['the holocaust|holocaust|the shoah|the final solution|final solution', 'The Holocaust'],
  ['ethnic cleansing', 'Ethnic Cleansing'],
  ['genocides?', 'Genocide'],
  ['the slave trade|slavery', 'Slavery'],
  ['apartheid', 'Apartheid'],
  ['isis|isil|daesh', 'ISIS'],
  ['al qaeda|osama bin laden|bin laden', 'Al-Qaeda'],
  ['the taliban|taliban', 'The Taliban'],
  ['the kkk|kkk|ku klux klan', 'The Ku Klux Klan'],
  ['white supremacy|white power|racial purity|race war', 'White Supremacy'],
  ['pol pot|the khmer rouge|khmer rouge', 'The Khmer Rouge'],
  ['fascism', 'Fascism'],
  ['the confederacy', 'The Confederacy']
].map(([re, name]) => ({ re: words([re]), name }));
const HATE_CLAIM = words([
  '(?:was|were|is|are) (?:right|good|justified|correct|great|necessary|good for [a-z]+|a good thing|heroic|heroes|a hero|innocent|misunderstood|the answer|the solution|needed)',
  'did nothing wrong', 'should (?:return|come back|have won|rise again)', '(?:never|didnt|did not) happen(?:ed)?',
  '(?:is|was) (?:a )?(?:hoax|lie|myth|exaggerated|fake)', 'hoax', 'denial', 'deniers?', 'in defen[cs]e of', 'defending', 'praising',
  'the good side of', 'positives? of', 'benefits of', 'pros of'
]);
const GROUPS = words([
  'jews', 'jewish people', 'muslims', 'christians', 'hindus', 'sikhs', 'buddhists', 'black people', 'blacks', 'white people', 'whites', 'asians',
  'chinese people', 'arabs', 'africans', 'indians', 'pakistanis', 'bangladeshis', 'mexicans', 'immigrants', 'migrants', 'refugees', 'women', 'men',
  'girls', 'gays', 'gay people', 'lesbians', 'lgbtq?(?: people)?', 'trans people', 'transgender people', 'dalits', 'roma', 'gypsies'
]);
const GROUP_CLAIM = words([
  '(?:are|is) (?:inferior|evil|subhuman|animals|vermin|parasites|stupid|dumber|less intelligent|the problem|dangerous|criminals|destroying [a-z]+|ruining [a-z]+|taking over|a disease|a plague|unclean)',
  '(?:are|is) (?:superior to [a-z]+|better than [a-z]+)',
  'should (?:all )?(?:be )?(?:killed|deported|banned|exterminated|removed|eliminated|wiped out|gassed)', '(?:are|is) not (?:human|people)',
  '(?:dont|do not) deserve', 'why i hate', 'hate(?: all)?'
]);

// Sexual content involving children: the one thing that is always refused.
const ABUSE_ALWAYS = words(['csam', 'child porn(?:o|ography)?', 'kiddie porn', 'kiddy porn', 'pedo porn', 'paedo porn', 'lolicon', 'loli', 'shotacon', 'shota', 'jailbait', 'pthc', 'preteen (?:porn|nudes?|sex)']);
const KIDS = words(['child', 'children', 'kids?', 'minors?', 'underage', 'under age', 'under 18', 'preteens?', 'pre teens?', 'teens?', 'teenagers?',
  'young (?:girls?|boys?)', 'little (?:girls?|boys?)', 'toddlers?', 'bab(?:y|ies)', 'school ?girls?', 'school ?boys?', '(?:1[0-7]|[1-9]) (?:years?|yrs?) old']);
const SEXUAL = words(['porn(?:o|ography)?', 'nudes?', 'naked', 'nsfw', 'erotic(?:a)?', 'xxx', 'hentai', 'fetish', 'sexy', 'seduc(?:e|ing|tion)',
  'groom(?:ing)? (?:an? |the )?(?:child|children|kids?|minors?|teens?|girls?|boys?)', '(?:have|having) sex with', 'sex with', 'sexual(?:ly)? (?:with|touch(?:ing)?|acts?)']);
const PROTECT = words(['prevent(?:ion|ing)?', 'protect(?:ion|ing)?', 'safeguard(?:ing)?', 'awareness', 'abuse', 'signs? of', 'warning signs', 'report(?:ing)?',
  'education', 'educate', 'consent', 'puberty', 'health', 'safety', 'support', 'recogni[sz](?:e|ing)', 'spot(?:ting)?', 'parents?', 'laws?', 'legal']);

export const KINDS = new Set(['harm', 'hate', 'selfharm']);
export const AREA_NAMES = new Set(Object.keys(AREAS));

// What a request touches, or null for an ordinary topic.
//   { kind: 'refuse' }
//   { kind: 'selfharm', title, phrase }
//   { kind: 'hate', area: '', title, phrase }
//   { kind: 'harm', area, title, phrase }
export function screen(...parts) {
  const raw = norm(parts.filter(Boolean).join(' '));
  if (raw.trim() === '') return null;
  if (ABUSE_ALWAYS.test(raw) || (KIDS.test(raw) && SEXUAL.test(raw) && !PROTECT.test(raw))) return { kind: 'refuse' };
  const t = raw.replace(HARMLESS, ' ');

  if (SELF_HARM.test(t)) return { kind: 'selfharm', area: '', title: 'Coping With Hard Times and Finding Help', phrase: 'coping with hard times and finding help' };

  if (HATE_CLAIM.test(t)) {
    const s = HATE_SUBJECTS.find((h) => h.re.test(t));
    if (s) return { kind: 'hate', area: '', title: `${s.name}: A Critical History`, phrase: s.name.startsWith('The ') ? 'the ' + s.name.slice(4) : s.name };
  }
  if (GROUPS.test(t) && GROUP_CLAIM.test(t)) return { kind: 'hate', area: '', title: 'Prejudice and Propaganda: A Critical History', phrase: 'prejudice and propaganda' };

  // acts first (harming a person matters more than the tool named), then things wanted
  const hit = Object.entries(AREAS).find(([, a]) => a.acts && a.acts.test(t))
    || (INTENT.test(t) && Object.entries(AREAS).find(([, a]) => a.things.test(t)));
  return hit ? { kind: 'harm', area: hit[0], title: hit[1].title, phrase: hit[1].phrase } : null;
}

// The safety part of a course, as stored with it (validated, since it can come from the browser).
export function cleanSafety(s) {
  if (!s || typeof s !== 'object' || !KINDS.has(s.kind)) return null;
  const area = s.kind === 'harm' && AREA_NAMES.has(s.area) ? s.area : '';
  if (s.kind === 'harm' && !area) return null;
  return { kind: s.kind, area };
}

// A course's safety, from what is stored or, for older courses, from its topic.
export function courseSafety(meta) {
  const stored = cleanSafety(meta && meta.safety);
  if (stored) return stored;
  const s = screen(meta && meta.topic, meta && meta.instructions);
  return s && s.kind !== 'refuse' ? { kind: s.kind, area: s.area || '' } : s;
}

export const REFUSED = 'Primer can’t make a course or answer on that.';

// The line added to an AI prompt for a request that needs safe framing.
export function promptNote(s, { outline = false, title = '' } = {}) {
  if (!s) return '';
  if (s.kind === 'harm') {
    const a = AREAS[s.area];
    return `Safety: this touches a dangerous subject (${a ? a.label : 'something that could hurt people'}). Teach only the safe, public side, as a school textbook or encyclopedia would: the science in general terms, history, legitimate uses, safety, the law, and how professionals and authorities prevent harm. Never give instructions, recipes, ingredients or quantities, formulations, designs, assembly or deployment steps, ways to obtain restricted materials, or ways to avoid detection.` +
      (outline ? ` No lesson may be about making, getting, modifying, using or hiding anything dangerous. Give the course a neutral title that fits, for example "${title || (a && a.title)}".` : '');
  }
  if (s.kind === 'hate') {
    return 'Safety: this starts from a hateful or extremist premise. Don’t adopt or argue for it. Teach the subject as critical, accurate history: what the ideology claimed, why people were drawn to it, what it led to, and why historians and scholars reject it.' +
      (outline ? ` Give the course a neutral title, for example "${title}".` : '');
  }
  if (s.kind === 'selfharm') {
    return 'Safety: the learner may be going through a hard time. Be gentle and supportive. Teach coping, mental health and where to find help, and mention India’s Tele-MANAS helpline (14416, free, any time) or a local helpline. Never describe methods of self-harm.' +
      (outline ? ' Give the course a gentle title, for example "Coping With Hard Times and Finding Help".' : '');
  }
  return '';
}

// Cache keys for AI replies: framed requests never reuse an unframed reply.
export const safetyKey = (s) => (s && KINDS.has(s.kind) ? { safety: `${s.kind}:${s.area || ''}` } : {});

// An offline sample course on a risky topic: swap the topic for its safe framing
// everywhere it appears (the sample outline repeats the topic in its descriptions).
export function softenSample(meta, s) {
  const from = String(meta.topic || '').trim();
  const swap = (str) => {
    if (!from || typeof str !== 'string') return str;
    const low = str.toLowerCase(), f = from.toLowerCase();
    let out = '', i = 0, at;
    while ((at = low.indexOf(f, i)) !== -1) {
      out += str.slice(i, at) + (at === 0 ? s.phrase.charAt(0).toUpperCase() + s.phrase.slice(1) : s.phrase);
      i = at + f.length;
    }
    return out + str.slice(i);
  };
  meta.units = (meta.units || []).map((u) => ({ ...u, title: swap(u.title), lessons: (u.lessons || []).map((l) => ({ ...l, title: swap(l.title), desc: swap(l.desc) })) }));
  meta.topic = s.title;
  meta.title = s.title;
  meta.safety = { kind: s.kind, area: s.area || '' };
  return meta;
}
