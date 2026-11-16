// Definitions shared by the server and the browser: difficulty levels,
// item type codes (for compact snapshots) and character appearance options.

/**
 * Difficulty presets. Numbers are multipliers on the Headmaster's base behaviour unless noted.
 * `smart` switches on extra behaviours:
 *   0  none: he only reacts to what he sees and hears right now
 *   1  predicts where you were heading when he loses sight; drifts toward the current objective
 *   2  + cuts you off in long chases, looks under tables, guards downed players, remembers where he
 *        lost you, learns which lockers get used, goes for wounded players, stops trusting bottles
 *   3  + everything above, harder and sooner; walks straight to whoever threw the bottle
 * `windup` is how long his swing takes (he keeps lunging forward while it winds up, so walking
 * away does not dodge it). `breath` is the chance that holding your breath in a locker he is
 * checking makes him walk on.
 */
export const DIFFICULTY = {
  beginner: {
    label: 'Beginner', blurb: 'Slow, short-sighted and easy to fool. You can take three hits. Extra supplies.',
    speed: 0.85, vision: 0.8, detect: 0.65, hearing: 0.75, grace: 25, lost: 2.2, search: 0.7, locker: 0.4,
    retreat: 10, doorWait: 1.5, hp: 3, bleed: 110, stalk: 1.6, smart: 0, supplies: 1.5, aggr: 0.6, bell: 12, windup: 0.62, breath: 0.9,
  },
  intermediate: {
    label: 'Intermediate', blurb: 'The standard Headmaster. Predicts where you ran, checks lockers, patrols near your objective.',
    speed: 1, vision: 1, detect: 1, hearing: 1, grace: 12, lost: 3, search: 1, locker: 1,
    retreat: 7, doorWait: 1, hp: 2, bleed: 80, stalk: 1, smart: 1, supplies: 1, aggr: 1, bell: 9, windup: 0.52, breath: 0.7,
  },
  hard: {
    label: 'Hard', blurb: 'Faster and sharper. Cuts you off, looks under tables, guards the wounded, and stops falling for bottles.',
    speed: 1.08, vision: 1.2, detect: 1.4, hearing: 1.25, grace: 8, lost: 4.5, search: 1.4, locker: 1.6,
    retreat: 5, doorWait: 0.7, hp: 2, bleed: 60, stalk: 0.7, smart: 2, supplies: 0.8, aggr: 1.15, bell: 8, windup: 0.44, breath: 0.5,
  },
  nightmare: {
    label: 'Nightmare', blurb: 'You cannot outrun him. One hit and you are down. Fewer supplies. He learns how you play.',
    speed: 1.16, vision: 1.4, detect: 2, hearing: 1.5, grace: 5, lost: 6, search: 1.8, locker: 2.2,
    retreat: 3.5, doorWait: 0.45, hp: 1, bleed: 45, stalk: 0.5, smart: 3, supplies: 0.6, aggr: 1.3, bell: 6, windup: 0.36, breath: 0.35,
  },
};
export const DIFFICULTY_ORDER = ['beginner', 'intermediate', 'hard', 'nightmare'];

/** Index in this list is sent in snapshots to say what a player is holding (0 = empty hand). */
export const ITEM_TYPES = ['', 'fuse', 'key_principal', 'key_gate', 'battery', 'medkit', 'lockpick', 'bottle', 'bell'];

/** Character creator options. A "look" is an object of indexes into these lists. */
export const LOOKS = {
  skin: ['#f1c9a5', '#e0ac69', '#c68642', '#a86b3c', '#8d5524', '#5c3a21'],
  top: ['#c9584c', '#4c8fc9', '#5fb86a', '#d2a341', '#9a66c9', '#4cc3b8', '#d27a9e', '#e8e4d8', '#30343c', '#7a4a2a'],
  pants: ['#23262d', '#2d3a55', '#4a4034', '#5a5d63', '#1f3a2c', '#6b2f2f'],
  shoes: ['#1a1a1c', '#e8e4d8', '#7a2b22', '#3a4a6a'],
  hairColor: ['#1b1512', '#4a2f1b', '#8a5a2b', '#c9a15a', '#8c2f1f', '#b9b9b0', '#3b6ea8', '#a84a8a'],
  hair: ['Short', 'Long', 'Spiky', 'Ponytail', 'Bald'],
  hat: ['None', 'Cap', 'Beanie', 'Hood up'],
  extra: ['Backpack', 'Glasses', 'Backpack + glasses', 'None'],
  build: ['Average', 'Slim', 'Broad', 'Short', 'Tall'],
};
export const LOOK_KEYS = Object.keys(LOOKS);
export const LOOK_LABELS = { skin: 'Skin', top: 'Top', pants: 'Trousers', shoes: 'Shoes', hairColor: 'Hair colour', hair: 'Hair', hat: 'Headwear', extra: 'Extras', build: 'Build' };

/** Sanitise an untrusted look (from the network or localStorage). */
export function cleanLook(l, fallbackIndex = 0) {
  const out = {};
  for (const k of LOOK_KEYS) {
    const v = l && Number.isInteger(l[k]) ? l[k] : null;
    out[k] = v !== null && v >= 0 && v < LOOKS[k].length ? v : k === 'top' ? fallbackIndex % LOOKS.top.length : 0;
  }
  return out;
}
export function randomLook() {
  const out = {};
  for (const k of LOOK_KEYS) out[k] = (Math.random() * LOOKS[k].length) | 0;
  return out;
}
