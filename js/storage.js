// storage.js — client-side session history (DB-2). Offline-first: keeps rehab
// sessions in localStorage so progress tracking works on a phone with no backend.
// Shape mirrors the future SQLite/API payload so it can sync later.

const KEY = "movelab_sessions_v1";

export function loadSessions(){
  try{ return JSON.parse(localStorage.getItem(KEY)) || []; }
  catch(e){ return []; }
}
export function saveSession(rec){
  const all = loadSessions();
  all.push(rec);
  try{ localStorage.setItem(KEY, JSON.stringify(all)); }catch(e){}
  return all.length;
}
export function clearSessions(){ localStorage.removeItem(KEY); }

// simple analytics for the progress view
export function summarize(sessions){
  if(!sessions.length) return {count:0,thisWeek:0,bestHold:0,totalInBand:0,streak:0,days:[]};
  const now = Date.now(), WEEK = 7*24*3600*1000;
  const days = new Set();
  let bestHold=0, totalInBand=0, thisWeek=0;
  for(const s of sessions){
    const d = new Date(s.date);
    days.add(d.toISOString().slice(0,10));
    bestHold = Math.max(bestHold, s.bestHold||0);
    totalInBand += s.totalInBand||0;
    if(now - d.getTime() <= WEEK) thisWeek++;
  }
  // adherence streak: consecutive days up to today with ≥1 session
  const daySet = days;
  let streak=0; const cur=new Date();
  for(;;){
    const key=cur.toISOString().slice(0,10);
    if(daySet.has(key)){ streak++; cur.setDate(cur.getDate()-1); }
    else break;
  }
  return {count:sessions.length, thisWeek, bestHold, totalInBand, streak, days:[...days].sort()};
}
