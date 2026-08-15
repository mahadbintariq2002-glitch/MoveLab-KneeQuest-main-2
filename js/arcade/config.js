// config.js — game data: characters, difficulties, levels, achievements, XP curve.
export const CHARACTERS = [
  { id:"luma",  name:"Luma",  emoji:"🦊", color:"#37e1ff", beam:"#8becff", desc:"Balanced keeper. A steady, friendly guide.", perk:"none"  },
  { id:"ember", name:"Ember", emoji:"🐉", color:"#ffb84d", beam:"#ffd98a", desc:"Bigger Nova blasts — reward long holds.",       perk:"bigNova" },
  { id:"sage",  name:"Sage",  emoji:"🦉", color:"#8affc0", beam:"#c9ffe4", desc:"Sturdier crystal — more forgiving.",          perk:"extraHP" },
];

export const DIFFICULTIES = [
  { id:"gentle",   name:"Gentle",   band:16, steadyTol:9, waveGap:2.6, wispSpeed:34, wispEvery:2.4, desc:"Wide target zone, slow wisps. Best to start." },
  { id:"steady",   name:"Steady",   band:12, steadyTol:6, waveGap:2.2, wispSpeed:46, wispEvery:1.9, desc:"A balanced challenge." },
  { id:"champion", name:"Champion", band:8,  steadyTol:4, waveGap:1.8, wispSpeed:60, wispEvery:1.5, desc:"Narrow zone, quick wisps. For pros." },
];

// Each level = a themed mission of N waves. Palettes drive the animated background.
export const LEVELS = [
  { id:1, name:"Aurora Meadow", waves:3, sky:["#12234f","#3a2a63","#6d3a6a"], accent:"#8affc0", target:45 },
  { id:2, name:"Frostlight Lake", waves:4, sky:["#0d2740","#164a63","#3aa0b8"], accent:"#8becff", target:50 },
  { id:3, name:"Starfall Peak",   waves:5, sky:["#1a1140","#3d1f63","#7a2f8a"], accent:"#ffd98a", target:55 },
];

export const ACHIEVEMENTS = [
  { id:"first_light", name:"First Light",   emoji:"✨", desc:"Complete your first mission." },
  { id:"steady_hand", name:"Steady Hand",   emoji:"🎯", desc:"Finish a wave with 90%+ steadiness." },
  { id:"nova",        name:"Nova Keeper",   emoji:"💥", desc:"Unleash a full Nova blast." },
  { id:"flawless",    name:"Flawless Guard",emoji:"🛡️", desc:"Complete a level with full crystal health." },
  { id:"streak3",     name:"On a Roll",     emoji:"🔥", desc:"Play 3 days in a row." },
  { id:"champion",    name:"Champion",      emoji:"👑", desc:"Beat any level on Champion." },
];

// XP → level (keeper rank)
export function rankFor(xp){ return Math.floor(Math.sqrt(xp/60)) + 1; }
export function xpForRank(r){ return Math.round(60*(r-1)*(r-1)); }
export const RANK_TITLES = ["Novice","Apprentice","Keeper","Guardian","Warden","Luminary","Ascendant"];
export function rankTitle(r){ return RANK_TITLES[Math.min(r-1, RANK_TITLES.length-1)]; }
