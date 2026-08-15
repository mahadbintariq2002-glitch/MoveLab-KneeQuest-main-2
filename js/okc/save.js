// save.js — shared OKC progress store (localStorage). Per-game bests, history,
// XP/coins, daily streak, achievements. Reused by every OKC game.
const KEY="okc_rehab_v1";
const DEFAULT={ xp:0, coins:0, streak:0, lastPlayed:null,
  games:{},          // {gameId:{plays, bestStars, bestScore}}
  history:[],        // [{date, game, stars, score, reps, quality, completed}]
  achievements:[],   // ids
  settings:{ muted:false } };

export const OKCSave={
  data:load(),
  save(){ try{ localStorage.setItem(KEY, JSON.stringify(this.data)); }catch(e){} return this.data; },
  reset(){ this.data=structuredClone(DEFAULT); this.save(); },
  addXP(n){ this.data.xp+=n; }, addCoins(n){ this.data.coins+=n; },
  unlock(id){ if(!this.data.achievements.includes(id)){ this.data.achievements.push(id); this.save(); return true; } return false; },
  touchStreak(){ const today=new Date().toISOString().slice(0,10), last=this.data.lastPlayed;
    if(last===today) return this.data.streak;
    if(last){ const d=(new Date(today)-new Date(last))/86400000; this.data.streak=(d===1)?this.data.streak+1:1; } else this.data.streak=1;
    this.data.lastPlayed=today; this.save(); return this.data.streak; },
  record(rec){ const g=this.data.games[rec.game]||(this.data.games[rec.game]={plays:0,bestStars:0,bestScore:0});
    g.plays++; g.bestStars=Math.max(g.bestStars,rec.stars||0); g.bestScore=Math.max(g.bestScore,rec.score||0);
    this.data.history.push({date:new Date().toISOString(),...rec}); if(this.data.history.length>80)this.data.history=this.data.history.slice(-80);
    this.save(); },
  best(gameId){ return this.data.games[gameId]||{plays:0,bestStars:0,bestScore:0}; },
};
function load(){ try{ return Object.assign(structuredClone(DEFAULT), JSON.parse(localStorage.getItem(KEY))||{}); }catch(e){ return structuredClone(DEFAULT); } }

export function rankFor(xp){ return Math.floor(Math.sqrt(xp/60))+1; }
