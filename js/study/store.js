// store.js — returns the active data store: cloud (Firebase) when cloud-config.js holds a config,
// otherwise the local-browser store. Every page calls getStore() and never cares which one it got.
import cfg from "./cloud-config.js";
let _p = null;
export function getStore(){
  if(!_p) _p = cfg
    ? import("./cloudstore.js").then(m => m.createCloudStore(cfg))
    : import("./localstore.js").then(m => m.createLocalStore());
  return _p;
}
