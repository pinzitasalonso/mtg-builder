// The curated half of the Score's classification: the cards the rubric names, and
// the well-known cards that fall into a tier oracle text alone cannot read.
//
// DeckCheck scores against a card database a human tiered. This is our slice
// of that: the rubric's own examples, plus the staples every deck site agrees
// on. Anything not here is read from oracle text by lib/deck-score-classify.ts,
// which gets the common cases right and the margins roughly right. When a
// score looks wrong for a named card, the fix belongs in this file.
//
// Keys are the printed name, lowercased, front face only for double-faced
// cards ("brazen borrower", not "brazen borrower // petty theft").

const list = (names: string): Set<string> =>
  new Set(
    names
      .split("\n")
      .map((n) => n.trim().toLowerCase())
      .filter(Boolean)
  );

// ---------------------------------------------------------------------------
// Tutors
// ---------------------------------------------------------------------------

/** 6 points — premium true tutors, CMC ≤ 2, unrestricted (or as good as). */
export const PREMIUM_TUTORS = list(`
Demonic Tutor
Vampiric Tutor
Imperial Seal
Enlightened Tutor
Mystical Tutor
Worldly Tutor
Gamble
Personal Tutor
Sylvan Tutor
Eladamri's Call
Cruel Tutor
`);
// Cruel Tutor is 3 mana but unrestricted and to the top: DeckCheck reads it
// with the premium row in practice. Everything else is the rubric's own list.

/** 6 points — a permanent that tutors every turn, unconditionally. */
export const TUTOR_ENGINES = list(`
Survival of the Fittest
Birthing Pod
Fauna Shaman
Prime Speaker Vannifar
Yisan, the Wanderer Bard
Captain Sisay
Sisay, Weatherlight Captain
Goblin Recruiter
Goblin Matron
Moggcatcher
Squirrel Nest
Rune-Scarred Demon
Razaketh, the Foulblooded
Thrumming Stone
Maralen of the Mornsong
Planar Bridge
Scroll Rack
`);
// Goblin Matron / Rune-Scarred Demon are ETB tutors, not engines — they are
// here because they are commonly blinked, but the classifier only credits
// this set at 6 when the card is a permanent with a repeatable ability; ETB
// bodies fall through to the CMC rule (4 or 2). Scroll Rack is selection.

/** 4 points — standard true tutors, CMC 3–4 or restricted. */
export const STANDARD_TUTORS = list(`
Grim Tutor
Wishclaw Talisman
Fabricate
Eldritch Evolution
Finale of Devastation
Green Sun's Zenith
Diabolic Intent
Beseech the Mirror
Profane Tutor
Scheming Symmetry
Chord of Calling
Natural Order
Tinker
Transmute Artifact
Whir of Invention
Reshape
Idyllic Tutor
Sterling Grove
Steelshaper's Gift
Open the Armory
Stoneforge Mystic
Merchant Scroll
Muddle the Mixture
Drift of Phantasms
Spellseeker
Trinket Mage
Trophy Mage
Tribute Mage
Recruiter of the Guard
Imperial Recruiter
Ranger-Captain of Eos
Diabolic Tutor
Solve the Equation
Long-Term Plans
Intuition
Gifts Ungiven
Traverse the Ulvenwald
Neoform
Mastermind's Acquisition
Shared Summons
Fierce Empath
Woodland Bellower
Uncage the Menagerie
Summoner's Pact
Time of Need
Signal the Clans
Bring to Light
Dark Petition
Zur the Enchanter
Armored Skyhunter
Sidisi, Undead Vizier
Thalia's Lancers
Sunforger
Brainstorm
`);
// Brainstorm is NOT a tutor — it is listed so the text reader does not mistake
// its "look at the top" for anything; the draw tiers below classify it.

/** 4 points — combo-enablers-that-tutor. */
export const COMBO_TUTORS = list(`
Demonic Consultation
Tainted Pact
Doomsday
Plunge into Darkness
`);

/** 2 points — narrow or expensive true tutors (CMC 5+). */
export const NARROW_TUTORS = list(`
Rune-Scarred Demon
Increasing Ambition
Ranger of Eos
Diabolic Revelation
Razaketh's Rite
Vindictive Lich
Kuldotha Forgemaster
Expedition Map
Crop Rotation
Sylvan Scrying
Tempt with Discovery
Hour of Promise
Scapeshift
Ulvenwald Hydra
Primeval Titan
Boseiju Pathlighter
`);

/** Graveyard-destination tutors: only score when a recursion package exists. */
export const GRAVEYARD_TUTORS = list(`
Entomb
Buried Alive
Unmarked Grave
Final Parting
Corpse Connoisseur
Gravebreaker Lamia
Jarad's Orders
Oriq Loremage
`);

/** Recursion commanders — a guaranteed rebuild engine that also unlocks graveyard tutors. */
export const RECURSION_COMMANDERS = list(`
Muldrotha, the Gravetide
Meren of Clan Nel Toth
Karador, Ghost Chieftain
Lurrus of the Dream-Den
Sidisi, Brood Tyrant
Chainer, Nightmare Adept
Chainer, Dementia Master
The Mimeoplasm
Tasigur, the Golden Fang
Gyruda, Doom of Depths
Alesha, Who Smiles at Death
Teneb, the Harvester
Kroxa, Titan of Death's Hunger
Ghave, Guru of Spores
Prossh, Skyraider of Kher
Marchesa, the Black Rose
Syr Konrad, the Grim
Nethroi, Apex of Death
Kaalia of the Vast
Gitrog Monster
The Gitrog Monster
Varina, Lich Queen
Grenzo, Dungeon Warden
Mazirek, Kraul Death Priest
Sevinne, the Chronoclasm
Emry, Lurker of the Loch
Osgir, the Reconstructor
Daretti, Scrap Savant
Sharuum the Hegemon
Glissa, the Traitor
Feldon of the Third Path
Hofri Ghostforge
Teshar, Ancestor's Apostle
Kalitas, Traitor of Ghet
Zombie Master
Wilhelt, the Rotcleaver
`);

// ---------------------------------------------------------------------------
// Draw
// ---------------------------------------------------------------------------

/** 6 points — burst draw. */
export const BURST_DRAW = list(`
Ad Nauseam
Wheel of Fortune
Necropotence
Windfall
Timetwister
Time Spiral
Echo of Eons
Wheel of Misfortune
Magus of the Wheel
Reforge the Soul
Memory Jar
Molten Psyche
Peer into the Abyss
Yawgmoth's Bargain
Griselbrand
Time Reversal
Whispering Madness
Dark Deal
Wheel and Deal
Winds of Change
Day's Undoing
Commit // Memory
Jace's Archivist
Khorvath's Fury
Incendiary Command
Burning Inquiry
Enter the Infinite
Sphinx of the Second Sun
Bolas's Citadel
Vilis, Broker of Blood
`);

/** 5 points — premium asymmetric engines. */
export const PREMIUM_DRAW = list(`
Rhystic Study
Mystic Remora
Esper Sentinel
Sylvan Library
Consecrated Sphinx
The One Ring
Black Market Connections
Kindred Discovery
Skullclamp
Smuggler's Share
Trouble in Pairs
Tocasia's Welcome
Guardian Project
Beast Whisperer
Tatyova, Benthic Druid
Archivist of Oghma
Faerie Mastermind
Lorcan, Warlock Collector
Notion Thief
Narset, Parter of Veils
Jin-Gitaxias, Core Augur
Land Tax
`);
// Land Tax is selection-grade card flow rather than draw; reading it in this
// tier overstates it slightly, but a deck running it is running it for the
// three cards a turn it hands over.

/** 4 points — standard repeatable engines. Monarch cards go here too. */
export const STANDARD_DRAW = list(`
Phyrexian Arena
Dark Confidant
Dark Tutelage
Twilight Prophet
Greed
Erebos, God of the Dead
Arguel's Blood Fast
Underworld Connections
Bloodgift Demon
Midnight Reaper
Grim Haruspex
Dark Prophecy
Deathreap Ritual
Liliana's Standard Bearer
Court of Ambition
Court of Bounty
Court of Cunning
Court of Grace
Court of Ire
Court of Garenbrig
Court of Vantress
Court of Embereth
Court of Locthwain
Palace Jailer
Protector of the Crown
Emberwilde Captain
Thorn of the Black Rose
Marchesa's Decree
Custodi Lich
Knights of the Black Rose
Throne of the High City
Regal Behemoth
Archon of Coronation
Keeper of Keys
Crown of Doom
Mangara, the Diplomat
Breena, the Demagogue
Tymna the Weaver
Edric, Spymaster of Trest
Toski, Bearer of Secrets
Cold-Eyed Selkie
Coastal Piracy
Reconnaissance Mission
Bident of Thassa
Ohran Frostfang
Curiosity
Keen Sense
Sixth Sense
Ophidian Eye
Snake Umbra
Mask of Memory
Rogue's Gloves
Elder Brain
Chart a Course
Garruk's Uprising
Colossal Majesty
Elemental Bond
Kavu Lair
Soul of the Harvest
Zendikar Resurgent
Lifecrafter's Bestiary
Vanquisher's Banner
Coastal Piracy
Glimpse of Nature
Mentor of the Meek
Welcoming Vampire
Bennie Bracks, Zoologist
Tocasia's Welcome
Inspiring Call
Idol of Oblivion
Kami of the Crescent Moon
Howling Mine
Temple Bell
Font of Mythos
Dictate of Kruphix
Prosperity
Minds Aglow
Teferi's Puzzle Box
Otherworld Atlas
Rites of Flourishing
Words of Wisdom
Truce
Vision Skeins
Jace Beleren
`);
// Combat-conditioned and symmetric engines listed above are demoted by the
// classifier (to 3 and 2) from their text; being on the list only says "this
// is a draw source", the tier is read from what the card does.

/** 3 points — selection and filtering (capped at 30 draw points in total). */
export const SELECTION = list(`
Brainstorm
Ponder
Preordain
Sensei's Divining Top
Scroll Rack
Opt
Consider
Serum Visions
Sleight of Hand
Gitaxian Probe
Impulse
Anticipate
Faithless Looting
Careful Study
Frantic Search
Thirst for Knowledge
Compulsive Research
Cathartic Reunion
Tormenting Voice
Thrill of Possibility
Chart a Course
Crop Rotation
Mishra's Bauble
Urza's Bauble
Portent
Telling Time
Dig Through Time
Treasure Cruise
Brainstone
Soul-Guide Lantern
Jace, the Mind Sculptor
Sylvan Library
Mirri's Guile
Abundance
Scroll Rack
Kinnan, Bonder Prodigy
Thrasios, Triton Hero
Tamiyo, Collector of Tales
Search for Azcanta
Insidious Roots
`);

/** 2 points — one-shot draw. */
export const ONE_SHOT_DRAW = list(`
Night's Whisper
Sign in Blood
Read the Bones
Painful Truths
Harmonize
Concentrate
Blue Sun's Zenith
Pull from Tomorrow
Fact or Fiction
Deep Analysis
Divination
Tidings
Opportunity
Ambition's Cost
Ancient Craving
Syphon Mind
Promise of Power
Damnable Pact
Village Rites
Deadly Dispute
Costly Plunder
Skullclamp
Ancestral Recall
Stroke of Genius
Braingeyser
Return of the Wildspeaker
Rishkar's Expertise
Shamanic Revelation
Regal Force
Mulldrifter
Prime Speaker Zegana
Commander's Sphere
Mind Stone
Hedron Archive
Dreamstone Hedron
Wall of Omens
Elvish Visionary
Cloudkin Seer
Sea Gate Oracle
Omen of the Sea
Baleful Strix
Harvester of Souls
Sakura-Tribe Elder
Big Score
Unexpected Windfall
Seize the Spoils
Painful Lesson
Secret Rendezvous
Behold the Multitude
`);
// Skullclamp is both premium (in a token deck) and one-shot; the classifier
// takes the highest tier a card appears in.

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

/** 0-mana / alternate-cost reactive spells — 2 stack points each. */
export const FREE_INTERACTION = list(`
Force of Will
Force of Negation
Force of Vigor
Force of Despair
Force of Virtue
Force of Rage
Fierce Guardianship
Deflecting Swat
Flawless Maneuver
Deadly Rollick
Obscuring Haze
Pact of Negation
Slaughter Pact
Mental Misstep
Daze
Foil
Misdirection
Commandeer
Snuff Out
Gut Shot
Mindbreak Trap
Snapback
Thwart
Solitude
Endurance
Grief
Fury
Subtlety
Submerge
Dismember
Snap
Thwart
Bolt Bend
Deflecting Palm
Cavern of Souls
Gush
Ricochet Trap
Mutagenic Growth
Blazing Rootwalla
`);
// Cavern of Souls and Gush are not interaction and the classifier never counts
// a land or a draw spell here; they are listed so the set reads as a reference
// of "free" cards, not to be scored.

/** Turn protection — "Silence, Grand Abolisher class" — 2 stack points each. */
export const TURN_PROTECTION = list(`
Silence
Grand Abolisher
Orim's Chant
Abeyance
Teferi, Time Raveler
Teferi, Mage of Zhalfir
Dosan the Falling Leaf
City of Solitude
Conqueror's Flail
Ranger-Captain of Eos
Vexing Shusher
Allosaurus Shepherd
Defense Grid
Autumn's Veil
Veil of Summer
Rebuff the Wicked
Elite Spellbinder
Void Winnower
Lavinia, Azorius Renegade
Hushbringer
Hushwing Gryff
Torpor Orb
Angel's Grace
`);

/** Effective counterspells that text alone would miss. */
export const EFFECTIVE_COUNTERS = list(`
Veil of Summer
Autumn's Veil
Imp's Mischief
Bolt Bend
Deflecting Swat
Pyroblast
Red Elemental Blast
Hydroblast
Blue Elemental Blast
Misdirection
Commandeer
Tibalt's Trickery
Guttural Response
Dovin's Veto
Lapse of Certainty
Mana Tithe
Ricochet Trap
Shunt
Redirect
Swerve
Reroute
Deflection
Wild Ricochet
Twincast
Fork
Reverberate
Narset's Reversal
Mindbreak Trap
Force of Negation
Force of Will
Pact of Negation
Fierce Guardianship
Flusterstorm
Swan Song
An Offer You Can't Refuse
Stern Scolding
Spell Pierce
Miscast
Mystical Dispute
Delay
Memory Lapse
Remand
Counterspell
Mana Drain
Arcane Denial
Negate
Dispel
Spell Snare
Mana Leak
Dissipate
Dissolve
Cancel
Disallow
Voidslime
Stubborn Denial
Essence Scatter
Muddle the Mixture
Drown in the Loch
Absorb
Render Silent
Silumgar's Command
Cryptic Command
Mystic Confluence
Rewind
Desertion
Spell Swindle
Sublime Epiphany
Familiar's Ruse
Unwind
Saw It Coming
Jwari Disruption
Lofty Denial
Tale's End
Disdainful Stroke
Ertai's Scorn
No More Lies
Drannith Magistrate
`);
// The named counterspells are here so a deck that runs them reads a real
// counter suite even where the oracle text says "counter target spell unless
// its controller pays" or a mode-list formulation the regex might miss.

/** Board-level protection — a player grant, team grant, fog, phasing, mass blink. */
export const BOARD_LEVEL_PROTECTION = list(`
Teferi's Protection
Heroic Intervention
Boros Charm
Flawless Maneuver
Unbreakable Formation
Make a Stand
Rootborn Defenses
Clever Concealment
Ghostway
Eerie Interlude
Semester's End
Guardian of Faith
Cosmic Intervention
Selfless Spirit
Dauntless Escort
Selfless Savior
Avacyn, Angel of Hope
Akroma's Will
Fog
Holy Day
Moment's Peace
Darkness
Constant Mists
Spore Frog
Kami of False Hope
Riot Control
Winds of Qal Sisma
Tamiyo's Safekeeping
Wrap in Vigor
Withstand Death
Golgari Charm
Loran's Escape
Blessing of the Nephilim
Adverse Conditions
Rebuff the Wicked
Soul of New Phyrexia
Teferi's Veil
Vanishing
Oketra's Last Mercy
Settle the Wreckage
Ghostly Flicker
Gods Willing
Faith's Reward
Second Sunrise
Brought Back
Ratchet Bomb
Deflecting Swat
Sphinx's Revelation
`);
// Deflecting Swat, Sphinx's Revelation, Ratchet Bomb, Settle the Wreckage,
// Gods Willing, Ghostly Flicker and Rebuff the Wicked are NOT board-level;
// the classifier filters this list to cards whose text carries a team grant,
// player grant, fog, phasing or mass-blink pattern before crediting them.

/** Premium hard-scope wipes at CMC ≤ 4 — the ones that answer boards instants can't. */
export const HARD_WIPES = list(`
Toxic Deluge
Culling Ritual
Damnation
Massacre Girl
Massacre Wurm
Crux of Fate
Ritual of Soot
Cyclonic Rift
Winds of Abandon
Settle the Wreckage
Farewell
Merciless Eviction
Austere Command
Terminus
Hallowed Burial
Dusk // Dawn
Anger of the Gods
Sweltering Suns
Fiery Confluence
Pernicious Deed
Living Death
Balance
Cataclysm
Fated Retribution
Torment of Hailfire
Extinction Event
Blood on the Snow
Deadly Tempest
Yawgmoth's Vile Offering
Ondu Inversion
Mass Manipulation
`);
// This list is also filtered: only exile-all, each-player-sacrifices, or
// -X/-X at CMC ≤ 4 earns the point. Damnation and the destroy wipes are here
// so the text reader classes them as wipes at all; they score 0 stack points.

/** Stax and hoser pieces the text reader might not catch. */
export const STAX_PIECES = list(`
Orcish Bowmasters
Hullbreacher
Aven Mindcensor
Opposition Agent
Drannith Magistrate
Collector Ouphe
Null Rod
Stony Silence
Rest in Peace
Grafdigger's Cage
Cursed Totem
Torpor Orb
Rule of Law
Deafening Silence
Archon of Emeria
Thalia, Guardian of Thraben
Thalia, Heretic Cathar
Blind Obedience
Authority of the Consuls
Kinjalli's Sunwing
Linvala, Keeper of Silence
Ethersworn Canonist
Spirit of the Labyrinth
Notion Thief
Narset, Parter of Veils
Alms Collector
Winter Orb
Static Orb
Stasis
Smokestack
Tangle Wire
Sphere of Resistance
Thorn of Amethyst
Trinisphere
Lodestone Golem
Armageddon
Ravages of War
Blood Moon
Magus of the Moon
Back to Basics
Root Maze
Hokori, Dust Drinker
Kataki, War's Wage
Aura of Silence
Suppression Field
Ghostly Prison
Propaganda
Sphere of Safety
Collective Restraint
Windborn Muse
Baird, Steward of Argive
Archangel of Tithes
Crawlspace
Silent Arbiter
Maze of Ith
Kor Haven
Norn's Annex
Solitary Confinement
Ensnaring Bridge
Peacekeeper
Moat
Magus of the Moat
Elephant Grass
Humility
Dovin, Hand of Control
Lavinia, Azorius Renegade
Gaddock Teeg
Eidolon of Rhetoric
Sanctum Prelate
Chalice of the Void
Cursed Totem
Pithing Needle
Phyrexian Revoker
Sorcerous Spyglass
Damping Sphere
Ashiok, Dream Render
Leonin Arbiter
Mindlock Orb
Shadow of Doubt
Stranglehold
Containment Priest
Hushbringer
Hushwing Gryff
Tocatli Honor Guard
Manglehorn
Vryn Wingmare
Glowrider
Esper Sentinel
Rhystic Study
Mystic Remora
Smothering Tithe
Dauthi Voidwalker
Leyline of the Void
Leyline of Sanctity
Aegis of the Gods
Ivory Mask
Deep Gnome Terramancer
Tergrid, God of Fright
Opposition
Rising Waters
Frozen AEther
Frozen Aether
Urabrask the Hidden
Meekstone
Marble Titan
Crackdown
Elesh Norn, Grand Cenobite
Grand Arbiter Augustin IV
Nadir Kraken
Karn, the Great Creator
`);
// Rhystic Study, Mystic Remora, Esper Sentinel and Smothering Tithe are
// engines, not stax; they are named so a reader looking for "taxing" cards
// finds the ruling here. The classifier excludes them from the stax count.

/** Format-defining recursion — 2 points and a rebuild engine each. */
export const RECURSION_ENGINES = list(`
Sun Titan
Underworld Breach
Yawgmoth's Will
Magus of the Will
Living Death
Replenish
Rise of the Dark Realms
Emeria Shepherd
Phyrexian Reclamation
Volrath's Stronghold
Academy Ruins
Hall of Heliod's Generosity
Nim Deathmantle
Mimic Vat
Lifeline
Debtors' Knell
Sheoldred, Whispering One
Reya Dawnbringer
Saffi Eriksdotter
Karmic Guide
Reveillark
Eternal Witness
Timeless Witness
Bala Ged Recovery
Regrowth
Reanimate
Animate Dead
Necromancy
Persist
Dance of the Dead
Dread Return
Victimize
Sevinne's Reclamation
Whip of Erebos
Conjurer's Closet
Bitterblossom
Emeria, the Sky Ruin
Mistveil Plains
Genesis
Meren of Clan Nel Toth
Muldrotha, the Gravetide
Lurrus of the Dream-Den
Kaya's Ghostform
Gift of Immortality
Feldon's Cane
Elixir of Immortality
Crucible of Worlds
Ramunap Excavator
Splendid Reclamation
Life from the Loam
Seasons Past
Praetor's Counsel
Twilight Shepherd
Golgari Findbroker
Den Protector
Wildwood Rebirth
Noxious Revival
Unearth
Exhume
Zombify
Blood for Bones
Apprentice Necromancer
Recurring Nightmare
Command the Dreadhorde
Aphemia, the Cacophony
Ephemerate
`);
// Not every entry is an engine — Eternal Witness is "fair recursion", Reanimate
// is a one-shot. The classifier reads the tier (2 / 1.5 / 1) from what each
// card does; this list only guarantees the card is READ as recursion.

/** Fast mana: rocks and rituals the goldfish should play at full value. */
export const FAST_MANA = list(`
Sol Ring
Mana Crypt
Mana Vault
Grim Monolith
Jeweled Lotus
Lotus Petal
Chrome Mox
Mox Diamond
Mox Amber
Mox Opal
Lion's Eye Diamond
Dark Ritual
Cabal Ritual
Rite of Flame
Seething Song
Pyretic Ritual
Desperate Ritual
Jeska's Will
Simian Spirit Guide
Elvish Spirit Guide
Ancient Tomb
City of Traitors
Gemstone Caverns
Mana Geyser
Culling the Weak
Sacrifice
Burnt Offering
Songs of the Damned
Manamorphose
Treasonous Ogre
Dockside Extortionist
Arcane Signet
Fellwar Stone
Mind Stone
Talisman of Dominance
Talisman of Progress
Talisman of Indulgence
Talisman of Impulse
Talisman of Unity
Talisman of Creativity
Talisman of Hierarchy
Talisman of Resilience
Talisman of Conviction
Talisman of Curiosity
Thought Vessel
Wild Growth
Utopia Sprawl
Carpet of Flowers
Birds of Paradise
Llanowar Elves
Elvish Mystic
Fyndhorn Elves
Deathrite Shaman
Noble Hierarch
Ignoble Hierarch
Bloom Tender
Priest of Titania
Elves of Deep Shadow
Boreal Druid
Avacyn's Pilgrim
Delighted Halfling
Springleaf Drum
Exploration
Burgeoning
Azusa, Lost but Seeking
Oracle of Mul Daya
Dryad of the Ilysian Grove
Wayward Swordtooth
`);

/** Named mana rocks/dorks/rituals whose output the text reader can't count. */
export const MANA_OUTPUT: Record<string, { amount: number; kind: "rock" | "dork" | "ritual" | "land"; net?: number }> = {
  "sol ring": { amount: 2, kind: "rock" },
  "mana crypt": { amount: 2, kind: "rock" },
  "mana vault": { amount: 3, kind: "rock" },
  "grim monolith": { amount: 3, kind: "rock" },
  "jeweled lotus": { amount: 3, kind: "ritual" },
  "lotus petal": { amount: 1, kind: "ritual" },
  "lion's eye diamond": { amount: 3, kind: "ritual" },
  "chrome mox": { amount: 1, kind: "rock" },
  "mox diamond": { amount: 1, kind: "rock" },
  "mox amber": { amount: 1, kind: "rock" },
  "mox opal": { amount: 1, kind: "rock" },
  "dark ritual": { amount: 3, kind: "ritual" },
  "cabal ritual": { amount: 3, kind: "ritual" },
  "rite of flame": { amount: 2, kind: "ritual" },
  "seething song": { amount: 5, kind: "ritual" },
  "pyretic ritual": { amount: 3, kind: "ritual" },
  "desperate ritual": { amount: 3, kind: "ritual" },
  "jeska's will": { amount: 5, kind: "ritual" },
  "simian spirit guide": { amount: 1, kind: "ritual" },
  "elvish spirit guide": { amount: 1, kind: "ritual" },
  "mana geyser": { amount: 8, kind: "ritual" },
  "treasonous ogre": { amount: 4, kind: "rock" },
  "dockside extortionist": { amount: 3, kind: "ritual" },
  "ancient tomb": { amount: 2, kind: "land" },
  "city of traitors": { amount: 2, kind: "land" },
  "gaea's cradle": { amount: 2, kind: "land" },
  "serra's sanctum": { amount: 2, kind: "land" },
  "cabal coffers": { amount: 2, kind: "land" },
  "nykthos, shrine to nyx": { amount: 2, kind: "land" },
  "priest of titania": { amount: 2, kind: "dork" },
  "bloom tender": { amount: 2, kind: "dork" },
  "elvish archdruid": { amount: 2, kind: "dork" },
  "circle of dreams druid": { amount: 2, kind: "dork" },
  "marwyn, the nurturer": { amount: 2, kind: "dork" },
  "selvala, heart of the wilds": { amount: 3, kind: "dork" },
  "wirewood channeler": { amount: 2, kind: "dork" },
  "karametra's acolyte": { amount: 2, kind: "dork" },
  "gilded lotus": { amount: 3, kind: "rock" },
  "thran dynamo": { amount: 3, kind: "rock" },
  "basalt monolith": { amount: 3, kind: "rock" },
  "worn powerstone": { amount: 2, kind: "rock" },
  "hedron archive": { amount: 2, kind: "rock" },
  "dreamstone hedron": { amount: 3, kind: "rock" },
  "everflowing chalice": { amount: 1, kind: "rock" },
  "coalition relic": { amount: 1, kind: "rock" },
  "chromatic lantern": { amount: 1, kind: "rock" },
  "smothering tithe": { amount: 2, kind: "rock" },
};

/** Win-the-table finishers the goldfish should recognise. */
export const OVERRUN_FINISHERS = list(`
Craterhoof Behemoth
Triumph of the Hordes
Overwhelming Stampede
Overrun
Finale of Devastation
End-Raze Forerunners
Pathbreaker Ibex
Akroma's Will
Moonshaker Cavalry
Beastmaster Ascension
Kessig Wolf Run
Thunderfoot Baloth
Titanic Ultimatum
Insurrection
Rise of the Dark Realms
Torment of Hailfire
Exsanguinate
Debt to the Deathless
Aetherflux Reservoir
Approach of the Second Sun
Thassa's Oracle
Laboratory Maniac
Jace, Wielder of Mysteries
Revel in Riches
Hellkite Tyrant
Mechanized Production
Helix Pinnacle
Darksteel Reactor
Felidar Sovereign
Test of Endurance
Simic Ascendancy
Maze's End
Biovisionary
Coalition Victory
Mortal Combat
Epic Struggle
Barren Glory
Chance for Glory
Vraska, Golgari Queen
Liliana, Dreadhorde General
Grave Titan
Blightsteel Colossus
Expropriate
`);
