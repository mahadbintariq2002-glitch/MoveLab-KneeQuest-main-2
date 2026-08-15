// game.js — Crystal Guardian: wave-based defense where the isometric knee hold
// powers the shield. Pure gameplay + canvas render; fed a hold-state each frame.
import { Audio } from "./audio.js";

export class CrystalGuardian {
  constructor(opts){
    this.W=opts.W; this.H=opts.H; this.diff=opts.difficulty; this.char=opts.character; this.level=opts.level;
    this.cx=this.W/2; this.cy=this.H*0.82; this.crystalR=34;
    this.hp = this.char.perk==="extraHP" ? 120 : 100; this.maxHp=this.hp;
    this.wave=1; this.waves=this.level.waves; this.spawned=0; this.waveTarget=this._waveTarget(1);
    this.wisps=[]; this.parts=[]; this.pops=[];
    this.charge=0; this.novaFlash=0; this.shake=0; this.t=0; this.spawnT=0; this.gapT=1.2;
    this.shieldPower=0; this.shieldUp=false; this.shieldR=90;
    this.steadSum=0; this.steadN=0; this.wispsCleared=0; this.novas=0;
    this.phase="wavegap"; this.result=null; this.onEvent=opts.onEvent||(()=>{});
  }
  _waveTarget(w){ return 4 + w*2 + (this.level.id-1); }

  resize(W,H){ this.W=W; this.H=H; this.cx=W/2; this.cy=H*0.82; }

  update(dt, hold, now){
    this.t+=dt; if(this.shake>0) this.shake=Math.max(0,this.shake-dt*3); this.novaFlash=Math.max(0,this.novaFlash-dt*2);
    // shield from hold quality
    this.shieldUp = !!(hold && hold.tracked && hold.inBand);
    const power = this.shieldUp ? Math.max(0.15, hold.steadiness) : 0;
    this.shieldPower += (power-this.shieldPower)*Math.min(1,dt*8);
    this.shieldR = 78 + 70*this.shieldPower;
    if(this.shieldUp){ this.steadSum+=hold.steadiness; this.steadN++;
      const rate=(0.05+0.13*this.shieldPower)*(this.char.perk==="bigNova"?1.35:1); this.charge=Math.min(1,this.charge+dt*rate);
      if(Math.random()<dt*2){ Audio && null; } }
    // auto-Nova at full charge
    if(this.charge>=1){ this._nova(); }

    if(this.phase==="wavegap"){ this.gapT-=dt; if(this.gapT<=0){ this.phase="playing"; this.onEvent({type:"wave",wave:this.wave}); } }
    else if(this.phase==="playing"){
      this.spawnT-=dt;
      if(this.spawned<this.waveTarget && this.spawnT<=0){ this._spawn(); this.spawnT=this.diff.wispEvery*(0.7+Math.random()*0.6); }
      if(this.spawned>=this.waveTarget && this.wisps.length===0){ this._waveClear(); }
    }
    this._moveWisps(dt); this._step(this.parts,dt); this._stepPops(dt);
    if(this.hp<=0 && this.phase!=="done"){ this._end(false); }
  }

  _spawn(){ this.spawned++; const x=this.W*(0.12+Math.random()*0.76);
    const ang=Math.atan2(this.cy-0, this.cx-x); const sp=this.diff.wispSpeed*(0.85+Math.random()*0.4);
    this.wisps.push({x,y:-20,vx:Math.cos(ang)*sp,vy:Math.sin(ang)*sp,r:11+Math.random()*5,hue:Math.random()<0.5?280:200,trail:[]}); }
  _moveWisps(dt){
    for(const w of this.wisps){ w.x+=w.vx*dt; w.y+=w.vy*dt; w.trail.push([w.x,w.y]); if(w.trail.length>8)w.trail.shift();
      const d=Math.hypot(w.x-this.cx,w.y-this.cy); w._d=d; }
    for(let i=this.wisps.length-1;i>=0;i--){ const w=this.wisps[i];
      if(this.shieldUp && w._d < this.shieldR && w._d > this.crystalR+6){ this._pop(w.x,w.y,"+"+(2), w.hue); this._burst(w.x,w.y,w.hue,10);
        this.wispsCleared++; this.wisps.splice(i,1); Audio.hit(); continue; }
      if(w._d <= this.crystalR+8){ this.hp=Math.max(0,this.hp-9); this.shake=1; this._burst(w.x,w.y,0,14); this.wisps.splice(i,1); Audio.fail(); }
    }
  }
  _nova(){ this.charge=0; this.novas++; this.novaFlash=1; this.shake=1; Audio.nova();
    for(const w of this.wisps){ this._burst(w.x,w.y,w.hue,8); this.wispsCleared++; this._pop(w.x,w.y,"★",50); }
    this.wisps=[]; this.onEvent({type:"nova"}); }
  _waveClear(){ this.onEvent({type:"waveclear",wave:this.wave}); Audio.reward();
    if(this.wave>=this.waves){ this._end(true); return; }
    this.wave++; this.spawned=0; this.waveTarget=this._waveTarget(this.wave); this.phase="wavegap"; this.gapT=this.diff.waveGap; }
  _end(completed){ this.phase="done";
    const steadiness=this.steadN? this.steadSum/this.steadN : 0; const hpPct=this.hp/this.maxHp;
    let stars=1; if(completed){ stars = (hpPct>=0.66 && steadiness>=0.7)?3 : (hpPct>=0.34?2:1); }
    this.result={ completed, stars, steadiness:+(steadiness*100).toFixed(0), hpPct:+(hpPct*100).toFixed(0),
      wispsCleared:this.wispsCleared, novas:this.novas };
    this.onEvent({type:"end", ...this.result}); }

  // fx helpers
  _burst(x,y,hue,n){ for(let i=0;i<n;i++){ const a=Math.random()*7,s=Math.random()*4+1;
    this.parts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:1,hue}); } }
  _pop(x,y,txt,hue){ this.pops.push({x,y,txt,life:1,hue}); }
  _step(arr,dt){ for(const p of arr){ p.x+=p.vx; p.y+=p.vy; p.vy+=0.08; p.life-=dt*1.6; } this.parts=this.parts.filter(p=>p.life>0); }
  _stepPops(dt){ for(const p of this.pops){ p.y-=30*dt; p.life-=dt*1.2; } this.pops=this.pops.filter(p=>p.life>0); }

  // ── render (background drawn by caller) ──
  render(ctx, now){
    const sh = this.shake>0 ? (Math.random()-0.5)*this.shake*8 : 0;
    ctx.save(); ctx.translate(sh, sh*0.5);
    // nova flash
    if(this.novaFlash>0){ ctx.fillStyle=`rgba(255,255,255,${0.5*this.novaFlash})`; ctx.fillRect(0,0,this.W,this.H);
      ctx.strokeStyle=`rgba(255,224,138,${this.novaFlash})`; ctx.lineWidth=6; ctx.beginPath(); ctx.arc(this.cx,this.cy,(1-this.novaFlash)*this.W,0,7); ctx.stroke(); }
    // wisps
    for(const w of this.wisps){ ctx.beginPath();
      for(let i=0;i<w.trail.length;i++){ const [tx,ty]=w.trail[i]; ctx.globalAlpha=i/w.trail.length*0.4; ctx.fillStyle=`hsl(${w.hue},90%,70%)`; ctx.beginPath(); ctx.arc(tx,ty,w.r*0.5,0,7); ctx.fill(); }
      ctx.globalAlpha=1; const g=ctx.createRadialGradient(w.x,w.y,1,w.x,w.y,w.r*1.8); g.addColorStop(0,`hsl(${w.hue},95%,80%)`); g.addColorStop(1,`hsla(${w.hue},95%,60%,0)`);
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(w.x,w.y,w.r*1.8,0,7); ctx.fill();
      ctx.fillStyle=`hsl(${w.hue},95%,88%)`; ctx.beginPath(); ctx.arc(w.x,w.y,w.r*0.6,0,7); ctx.fill(); }
    ctx.globalAlpha=1;
    // shield dome
    if(this.shieldPower>0.02){ const col=this.char.beam;
      const g=ctx.createRadialGradient(this.cx,this.cy,this.crystalR,this.cx,this.cy,this.shieldR);
      g.addColorStop(0,"rgba(255,255,255,0)"); g.addColorStop(0.8,this._rgba(col,0.05+0.14*this.shieldPower)); g.addColorStop(1,this._rgba(col,0.32*this.shieldPower));
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(this.cx,this.cy,this.shieldR,Math.PI,2*Math.PI); ctx.lineTo(this.cx-this.shieldR,this.cy); ctx.fill();
      ctx.strokeStyle=this._rgba(col,0.5+0.4*this.shieldPower); ctx.lineWidth=2.5+2*this.shieldPower; ctx.beginPath(); ctx.arc(this.cx,this.cy,this.shieldR,Math.PI,2*Math.PI); ctx.stroke(); }
    // crystal
    this._crystal(ctx, now);
    // nova charge ring around crystal
    ctx.beginPath(); ctx.arc(this.cx,this.cy,this.crystalR+14,-Math.PI/2,-Math.PI/2+this.charge*2*Math.PI); ctx.strokeStyle="#ffe08a"; ctx.lineWidth=4; ctx.lineCap="round"; ctx.stroke();
    // particles + pops
    for(const p of this.parts){ ctx.globalAlpha=Math.max(0,p.life); ctx.fillStyle=`hsl(${p.hue||45},90%,70%)`; ctx.beginPath(); ctx.arc(p.x,p.y,3,0,7); ctx.fill(); }
    ctx.globalAlpha=1;
    for(const p of this.pops){ ctx.globalAlpha=Math.max(0,p.life); ctx.fillStyle=`hsl(${p.hue||45},90%,80%)`; ctx.font="bold 18px sans-serif"; ctx.textAlign="center"; ctx.fillText(p.txt,p.x,p.y); }
    ctx.globalAlpha=1;
    ctx.restore();
  }
  _crystal(ctx,now){ const r=this.crystalR, cx=this.cx, cy=this.cy, hpPct=this.hp/this.maxHp, pulse=1+Math.sin(now/400)*0.04;
    const g=ctx.createRadialGradient(cx,cy,2,cx,cy,r*3); g.addColorStop(0,this._rgba(this.char.color,0.5*hpPct+0.1)); g.addColorStop(1,this._rgba(this.char.color,0));
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cx,cy,r*3,0,7); ctx.fill();
    ctx.save(); ctx.translate(cx,cy); ctx.scale(pulse,pulse);
    ctx.beginPath(); ctx.moveTo(0,-r); ctx.lineTo(r*0.7,-r*0.2); ctx.lineTo(r*0.45,r); ctx.lineTo(-r*0.45,r); ctx.lineTo(-r*0.7,-r*0.2); ctx.closePath();
    const cg=ctx.createLinearGradient(0,-r,0,r); cg.addColorStop(0,"#ffffff"); cg.addColorStop(1,this.char.color);
    ctx.globalAlpha=0.5+0.5*hpPct; ctx.fillStyle=cg; ctx.fill(); ctx.strokeStyle="#ffffffcc"; ctx.lineWidth=2; ctx.stroke(); ctx.restore(); ctx.globalAlpha=1;
  }
  _rgba(hex,a){ const n=parseInt(hex.slice(1),16); return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`; }
}
