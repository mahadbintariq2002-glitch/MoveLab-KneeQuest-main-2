// save.js — SaveManager: persistent player profile (localStorage), progress, streaks.
import { rankFor } from "./config.js";
const KEY = "crystal_guardian_v1";

const DEFAULT = {
  xp:0, coins:0, character:"luma",
  unlockedLevel:1,                 // highest level unlocked
  bestStars:{},                    // {levelId: stars}
  achievements:[],                 // ids
  streak:0, lastPlayed:null,       // yyyy-mm-dd
  history:[],                      // [{date, level, difficulty, stars, xp, coins, steadiness, wispsCleared, novas}]
  settings:{ muted:false, invert:false },
  tutorialDone:false,
};

export const Save = {
  data: load(),
  save(){ try{ localStorage.setItem(KEY, JSON.stringify(this.data)); }catch(e){} return this.data; },
  reset(){ this.data = structuredClone(DEFAULT); this.save(); },

  addXP(n){ this.data.xp += n; return rankFor(this.data.xp); },
  addCoins(n){ this.data.coins += n; },
  unlock(id){ if(!this.data.achievements.includes(id)){ this.data.achievements.push(id); this.save(); return true; } return false; },
  hasAch(id){ return this.data.achievements.includes(id); },

  // streak: increment if consecutive day, reset if gap
  touchStreak(){
    const today = new Date().toISOString().slice(0,10);
    const last = this.data.lastPlayed;
    if(last===today) return this.data.streak;
    if(last){ const d=(new Date(today)-new Date(last))/86400000; this.data.streak = (d===1)?this.data.streak+1:1; }
    else this.data.streak = 1;
    this.data.lastPlayed = today; this.save(); return this.data.streak;
  },
  recordSession(rec){
    this.data.history.push({ date:new Date().toISOString(), ...rec });
    if(this.data.history.length>60) this.data.history=this.data.history.slice(-60);
    const prev=this.data.bestStars[rec.level]||0; if(rec.stars>prev) this.data.bestStars[rec.level]=rec.stars;
    if(rec.completed && rec.level>=this.data.unlockedLevel) this.data.unlockedLevel=Math.min(rec.level+1, 99);
    this.save();
  },
};
function load(){ try{ return Object.assign(structuredClone(DEFAULT), JSON.parse(localStorage.getItem(KEY))||{}); }catch(e){ return structuredClone(DEFAULT); } }
