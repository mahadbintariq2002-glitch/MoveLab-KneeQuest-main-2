// store.js — returns the active data store: cloud (Firebase) when cloud-config.js holds a config,
// otherwise the local-browser store. Every page calls getStore() and never cares which one it got.
//
// Developer switch: on localhost only, open any page with ?local=1 to use the local store in that browser
// (?local=0 switches back). Lets the UI be tested without touching the real study database.
import cfg from "./cloud-config.js";
let _p = null;
const forceLocal = (() => { try{
  if(!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return false;
  const q = new URLSearchParams(location.search);
  if(q.get("local") === "1") localStorage.setItem("vt_force_local", "1"); else if(q.get("local") === "0") localStorage.removeItem("vt_force_local");
  return localStorage.getItem("vt_force_local") === "1";
}catch(e){ return false; } })();
export function getStore(){
  if(!_p) _p = (cfg && !forceLocal)
    ? import("./cloudstore.js").then(m => m.createCloudStore(cfg))
    : import("./localstore.js").then(m => m.createLocalStore());
  return _p;
}
