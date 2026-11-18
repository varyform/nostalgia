'use strict';
// The whole game behind one factory, started by the page (main.js). boot(canvas) is the game;
// boot(canvas, { demo: true, pilot }) is attract mode (?demo=on, the launcher's preview): the
// same simulation and renderer with no DOM besides the canvas, no listeners, no audio, no
// storage, and the autopilot (autopilot.js) at the controls. onExit returns to the launcher.
import { createInput, menuNav, glyphHTML } from '@nostalgia/input';
import meta from '../game.json';
/* =====================================================================
   helpers
   ===================================================================== */
const TAU=Math.PI*2;
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const lerp=(a,b,t)=>a+(b-a)*t;
const dist=(ax,ay,bx,by)=>Math.hypot(bx-ax,by-ay);
const angDiff=(a,b)=>{let d=(b-a)%TAU;if(d>Math.PI)d-=TAU;if(d<-Math.PI)d+=TAU;return d;};
const turnTo=(a,b,m)=>a+clamp(angDiff(a,b),-m,m);
const rnd=Math.random;
const rr=(a,b)=>a+rnd()*(b-a);
const $=id=>document.getElementById(id);
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const rgb=c=>`rgb(${c[0]|0},${c[1]|0},${c[2]|0})`;
const rgba=(c,a)=>`rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a})`;
const mix3=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
const shade=(c,f)=>[Math.min(255,c[0]*f),Math.min(255,c[1]*f),Math.min(255,c[2]*f)];
function segPointDist(ax,ay,bx,by,px,py){const dx=bx-ax,dy=by-ay,l=dx*dx+dy*dy;let t=l?((px-ax)*dx+(py-ay)*dy)/l:0;t=clamp(t,0,1);return Math.hypot(ax+dx*t-px,ay+dy*t-py);}
function segRect(ax,ay,bx,by,o){
  let t0=0,t1=1;const dx=bx-ax,dy=by-ay;
  const p=[-dx,dx,-dy,dy],q=[ax-o.x,o.x+o.w-ax,ay-o.y,o.y+o.h-ay];
  for(let i=0;i<4;i++){if(p[i]===0){if(q[i]<0)return false;}else{const r=q[i]/p[i];if(p[i]<0){if(r>t1)return false;if(r>t0)t0=r;}else{if(r<t0)return false;if(r<t1)t1=r;}}}
  return true;
}
function makeNoise(seed){
  const r=mulberry32(seed),perm=[];for(let i=0;i<256;i++)perm.push(i);
  for(let i=255;i>0;i--){const j=Math.floor(r()*(i+1));[perm[i],perm[j]]=[perm[j],perm[i]];}
  const p=new Uint8Array(512);for(let i=0;i<512;i++)p[i]=perm[i&255];
  const v=new Float32Array(256);for(let i=0;i<256;i++)v[i]=r();
  function n2(x,y){const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi,X=xi&255,Y=yi&255;
    const a=v[p[p[X]+Y]],b=v[p[p[X+1]+Y]],c=v[p[p[X]+Y+1]],d=v[p[p[X+1]+Y+1]];
    const u=xf*xf*(3-2*xf),w=yf*yf*(3-2*yf);return a+(b-a)*u+(c-a)*w+(a-b-c+d)*u*w;}
  function fbm(x,y,o){let s=0,a=0.5,f=1,n=0;for(let i=0;i<o;i++){s+=a*n2(x*f,y*f);n+=a;a*=0.5;f*=2.03;}return s/n;}
  return{n2,fbm};
}
function mkCanvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
if(!CanvasRenderingContext2D.prototype.roundRect){
  CanvasRenderingContext2D.prototype.roundRect=function(x,y,w,h,r){r=Math.min(typeof r==='number'?r:4,w/2,h/2);this.moveTo(x+r,y);this.arcTo(x+w,y,x+w,y+h,r);this.arcTo(x+w,y+h,x,y+h,r);this.arcTo(x,y+h,x,y,r);this.arcTo(x,y,x+w,y,r);this.closePath();};
}

/* =====================================================================
   audio (all synthesized)
   ===================================================================== */
function makeAudio(){return{
  ctx:null,master:null,muted:false,noise:null,loops:{},
  unlock(){
    if(this.ctx){if(this.ctx.state==='suspended')this.ctx.resume();return;}
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
    try{
      const c=this.ctx=new AC();
      this.master=c.createGain();this.master.gain.value=this.muted?0:0.55;
      const comp=c.createDynamicsCompressor();comp.threshold.value=-14;comp.ratio.value=4;
      this.master.connect(comp);comp.connect(c.destination);
      const len=c.sampleRate*2,b=c.createBuffer(1,len,c.sampleRate),d=b.getChannelData(0);
      for(let i=0;i<len;i++)d[i]=Math.random()*2-1;
      this.noise=b;
    }catch{this.ctx=null;}
  },
  ok(v){return this.ctx&&this.ctx.state==='running'&&v>0.01;},
  setMuted(m){this.muted=m;if(this.master)this.master.gain.value=m?0:0.55;},
  noiseHit(t,vol,dur,type,freq,freqEnd,q=0.7){
    const c=this.ctx,s=c.createBufferSource();s.buffer=this.noise;
    const f=c.createBiquadFilter();f.type=type;f.Q.value=q;f.frequency.setValueAtTime(freq,t);if(freqEnd)f.frequency.exponentialRampToValueAtTime(freqEnd,t+dur);
    const g=c.createGain();g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(0.0008,t+dur);
    s.connect(f);f.connect(g);g.connect(this.master);s.start(t,Math.random()*1.2);s.stop(t+dur+0.05);
  },
  osc(t,vol,dur,type,f0,f1){
    const c=this.ctx,o=c.createOscillator();o.type=type;o.frequency.setValueAtTime(f0,t);if(f1)o.frequency.exponentialRampToValueAtTime(f1,t+dur);
    const g=c.createGain();g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(0.0008,t+dur);
    o.connect(g);g.connect(this.master);o.start(t);o.stop(t+dur+0.05);
  },
  shot(v=1,p=1){if(!this.ok(v))return;const t=this.ctx.currentTime;this.noiseHit(t,0.75*v,0.16,'lowpass',6000*p,500);this.noiseHit(t,0.3*v,0.5,'lowpass',900*p,120);this.osc(t,0.55*v,0.12,'sine',170*p,45);},
  boom(v=1,big=1){if(!this.ok(v))return;const t=this.ctx.currentTime;this.noiseHit(t,1.0*v,1.3*big,'lowpass',1400,60);this.noiseHit(t,0.45*v,0.35,'bandpass',2500,400,0.5);this.osc(t,0.9*v,0.9*big,'sine',90,24);},
  tone(f,d,type='sine',v=0.2,f1){if(!this.ok(v))return;this.osc(this.ctx.currentTime,v,d,type,f,f1);},
  toneAt(delay,f,d,type,v,f1){if(!this.ok(v))return;this.osc(this.ctx.currentTime+delay,v,d,type,f,f1);},
  pickup(){this.tone(660,0.09,'triangle',0.18);this.toneAt(0.08,990,0.14,'triangle',0.18);},
  alert(){this.tone(880,0.12,'square',0.07);this.toneAt(0.13,620,0.22,'square',0.07);},
  beep(v=1){this.tone(1900,0.05,'square',0.05*v);},
  click(){this.tone(2400,0.02,'square',0.06);},
  clink(v){this.tone(3200,0.05,'triangle',0.06*v);},
  hurt(){if(!this.ok(1))return;const t=this.ctx.currentTime;this.noiseHit(t,0.35,0.14,'bandpass',800,260,1.2);this.osc(t,0.15,0.18,'sawtooth',180,90);},
  reload(){this.tone(1200,0.04,'square',0.05);this.toneAt(0.55,900,0.05,'square',0.05);this.toneAt(1.25,1500,0.05,'square',0.06);},
  getLoop(name){
    if(this.loops[name])return this.loops[name];
    const c=this.ctx,g=c.createGain();g.gain.value=0;g.connect(this.master);
    const nsrc=()=>{const s=c.createBufferSource();s.buffer=this.noise;s.loop=true;s.start();return s;};
    if(name==='plane'){
      const f=c.createBiquadFilter();f.type='lowpass';f.frequency.value=300;
      for(const fr of[58,61.5]){const o=c.createOscillator();o.type='sawtooth';o.frequency.value=fr;o.connect(f);o.start();}
      const nf=c.createBiquadFilter();nf.type='lowpass';nf.frequency.value=520;const ng=c.createGain();ng.gain.value=0.6;
      nsrc().connect(nf);nf.connect(ng);ng.connect(g);f.connect(g);
    }else if(name==='rotor'){
      const f=c.createBiquadFilter();f.type='lowpass';f.frequency.value=450;const am=c.createGain();am.gain.value=0.5;
      const lfo=c.createOscillator();lfo.frequency.value=11;const lg=c.createGain();lg.gain.value=0.5;lfo.connect(lg);lg.connect(am.gain);lfo.start();
      nsrc().connect(f);f.connect(am);am.connect(g);
    }else{
      const f=c.createBiquadFilter();f.type='bandpass';f.frequency.value=700;f.Q.value=0.4;nsrc().connect(f);f.connect(g);
    }
    return(this.loops[name]={gain:g});
  },
  setLoop(name,vol){if(!this.ctx)return;const L=this.getLoop(name);L.gain.gain.setTargetAtTime(vol,this.ctx.currentTime,0.2);},
  stopLoops(){for(const k in this.loops)this.setLoop(k,0);},
  close(){if(this.ctx){void this.ctx.close().catch(()=>{});this.ctx=null;this.loops={};}}
};}

/* =====================================================================
   data
   ===================================================================== */
const W=2400,H=8000,CELL=96,CHUNK=512;
const MISSIONS=[
  {name:'Glass Ear',code:'OP-01',theme:'dusk',cond:'Dusk',seed:1337,time:540,enemies:26,bunkers:3,objective:'radar',
   brief:'An early-warning radar array is blinding our air corridor. Jump south of the river, work your way north, put a demolition charge on the dish and reach the pickup zone before the window closes.',
   goal:'Destroy the radar array',sw:'linear-gradient(120deg,#e9945a,#6f7a3f 55%,#2f3d24)'},
  {name:'Paper Lantern',code:'OP-02',theme:'night',cond:'Night',seed:4242,time:540,enemies:28,bunkers:3,objective:'intel',
   brief:'A courier has delivered the enemy codebook to a forward command tent. Go in under darkness and take it. Lamps and muzzle flashes give you away, so stay in the shadows.',
   goal:'Steal the codebook',sw:'linear-gradient(120deg,#1a2746,#2d4a3c 60%,#0c1310)'},
  {name:'Dry Thunder',code:'OP-03',theme:'arid',cond:'Arid',seed:9001,time:600,enemies:32,bunkers:4,objective:'fuel',
   brief:'Three fuel tanks keep an armored column moving. Destroy all three. A charge finishes a tank outright; grenades take a few each. Pick up your supply pods, because you will need the explosives.',
   goal:'Destroy 3 fuel tanks',sw:'linear-gradient(120deg,#f0d49a,#c49a62 55%,#6c5a34)'}
];
const DIFFS={
  recruit:{label:'Recruit',acc:0.6,dmg:7,aware:0.7,count:0.75,react:1.4,burst:2,mult:0.75},
  veteran:{label:'Veteran',acc:1,dmg:11,aware:1,count:1,react:1,burst:3,mult:1},
  elite:{label:'Elite',acc:1.35,dmg:15,aware:1.35,count:1.25,react:0.75,burst:4,mult:1.5}
};
const THEMES={
  dusk:{grassA:[66,92,46],grassB:[104,122,58],dry:[150,130,78],dirt:[116,92,62],road:[142,118,86],water:[56,96,106],deep:[28,60,76],bank:[112,100,72],
        leafDark:[26,46,26],leafMid:[52,82,38],leafLight:[128,144,64],rock:[132,126,116],mult:'#ffdcb8',warm:'rgba(255,140,60,0.22)',dark:0,sh:[1.3,0.55],shA:0.34},
  night:{grassA:[50,74,48],grassB:[70,94,58],dry:[100,106,76],dirt:[90,80,64],road:[108,98,82],water:[42,72,92],deep:[20,42,62],bank:[88,84,68],
        leafDark:[20,38,26],leafMid:[36,62,40],leafLight:[80,110,68],rock:[112,116,120],mult:'#a9bde8',warm:null,dark:0.66,sh:[0.5,0.62],shA:0.22},
  arid:{grassA:[156,140,94],grassB:[182,164,112],dry:[200,180,128],dirt:[164,126,86],road:[194,168,126],water:[64,124,132],deep:[38,88,104],bank:[176,152,106],
        leafDark:[48,64,34],leafMid:[86,102,50],leafLight:[156,162,88],rock:[176,156,128],mult:'#fff3e0',warm:'rgba(255,240,200,0.10)',dark:0,sh:[0.45,0.6],shA:0.3}
};
const PAL={
  player:{body:'#5d6b3c',dark:'#46522c',pack:'#3a4326',boots:'#25241d',helm:'#55623a',helmHi:'#a4b26f',gun:'#1c1d1a'},
  enemy:{body:'#666d78',dark:'#4c525b',pack:'#3e434a',boots:'#22231f',helm:'#4a5059',helmHi:'#a8b1bd',gun:'#1a1a1a',band:'#c23a2e'},
  dead:{body:'#4e535a',dark:'#3e4248',pack:'#33363b',boots:'#1f1f1c',helm:'#3d4148',helmHi:'#6f7680',gun:'#1a1a1a',band:'#7a2a24'},
  deadP:{body:'#4a5530',dark:'#3a4224',pack:'#2f361f',boots:'#1f1f1c',helm:'#454f2e',helmHi:'#6f7a4c',gun:'#1a1a1a'}
};

/* =====================================================================
   sprites
   ===================================================================== */
const SOFT={};
function softSprite(name,r,g,b){const c=mkCanvas(64,64),x=c.getContext('2d'),gr=x.createRadialGradient(32,32,0,32,32,32);
  gr.addColorStop(0,`rgba(${r},${g},${b},1)`);gr.addColorStop(0.4,`rgba(${r},${g},${b},0.55)`);gr.addColorStop(1,`rgba(${r},${g},${b},0)`);x.fillStyle=gr;x.fillRect(0,0,64,64);SOFT[name]=c;}
softSprite('white',235,235,230);softSprite('grey',128,126,122);softSprite('dark',40,38,36);softSprite('fire',255,130,35);softSprite('hot',255,232,170);
softSprite('green',110,255,140);softSprite('red',120,16,14);softSprite('dust',176,158,126);softSprite('black',0,0,0);softSprite('blue',150,205,255);
const GRAIN=(()=>{const c=mkCanvas(256,256),x=c.getContext('2d'),id=x.createImageData(256,256);for(let i=0;i<id.data.length;i+=4){const v=104+Math.random()*48|0;id.data[i]=id.data[i+1]=id.data[i+2]=v;id.data[i+3]=255;}x.putImageData(id,0,0);return c;})();
function makeCloud(col,alpha,seed){const c=mkCanvas(320,200),g=c.getContext('2d'),R=mulberry32(seed);
  for(let i=0;i<22;i++){const x=70+R()*180,y=60+R()*80,r=30+R()*52,gr=g.createRadialGradient(x,y,0,x,y,r);gr.addColorStop(0,`rgba(${col},${alpha})`);gr.addColorStop(1,`rgba(${col},0)`);g.fillStyle=gr;g.beginPath();g.arc(x,y,r,0,TAU);g.fill();}return c;}
const CLOUD=makeCloud('255,255,255',0.4,77),CLOUD_SH=makeCloud('0,0,0',0.25,91);
function makeTreeSprites(T,seed){
  const R=mulberry32(seed^0x9e37),out=[];
  for(let v=0;v<8;v++){
    const S=80,c=mkCanvas(S,S),g=c.getContext('2d'),cx=S/2,cy=S/2,rr0=32,blobs=[[cx,cy,rr0*0.62]];
    const n=6+Math.floor(R()*4);
    for(let i=0;i<n;i++){const a=R()*TAU,d=rr0*(0.3+R()*0.32);blobs.push([cx+Math.cos(a)*d,cy+Math.sin(a)*d,rr0*(0.32+R()*0.2)]);}
    for(const[x,y,r]of blobs){g.fillStyle=rgb(shade(T.leafDark,0.8));g.beginPath();g.arc(x+1.5,y+1.5,r+1.5,0,TAU);g.fill();}
    for(const[x,y,r]of blobs){const gr=g.createRadialGradient(x-r*0.35,y-r*0.4,r*0.1,x,y,r);gr.addColorStop(0,rgb(T.leafLight));gr.addColorStop(0.55,rgb(T.leafMid));gr.addColorStop(1,rgb(T.leafDark));g.fillStyle=gr;g.beginPath();g.arc(x,y,r,0,TAU);g.fill();}
    for(let i=0;i<160;i++){const a=R()*TAU,d=Math.sqrt(R())*rr0*0.95,x=cx+Math.cos(a)*d,y=cy+Math.sin(a)*d;
      let inside=false;for(const b of blobs)if((x-b[0])**2+(y-b[1])**2<(b[2]-1)**2){inside=true;break;}if(!inside)continue;
      const lit=(x-cx)+(y-cy)<0;g.fillStyle=lit?rgba(T.leafLight,0.45):rgba(T.leafDark,0.45);g.beginPath();g.arc(x,y,0.8+R()*2,0,TAU);g.fill();}
    out.push(c);
  }
  return out;
}
function makeRockSprites(T,seed){
  const R=mulberry32(seed^0x51ed),out=[];
  for(let v=0;v<6;v++){
    const S=56,c=mkCanvas(S,S),g=c.getContext('2d'),cx=S/2,cy=S/2,n=7+Math.floor(R()*4),pts=[];
    for(let i=0;i<n;i++){const a=i/n*TAU+R()*0.3,r=20*(0.72+R()*0.28);pts.push([cx+Math.cos(a)*r,cy+Math.sin(a)*r*0.86]);}
    const path=()=>{g.beginPath();pts.forEach((p,i)=>i?g.lineTo(p[0],p[1]):g.moveTo(p[0],p[1]));g.closePath();};
    path();const gr=g.createLinearGradient(cx-20,cy-20,cx+20,cy+20);gr.addColorStop(0,rgb(shade(T.rock,1.3)));gr.addColorStop(0.5,rgb(T.rock));gr.addColorStop(1,rgb(shade(T.rock,0.55)));
    g.fillStyle=gr;g.fill();g.strokeStyle=rgba(shade(T.rock,0.4),0.8);g.lineWidth=1.5;g.stroke();
    g.save();path();g.clip();
    for(let i=0;i<3;i++){g.fillStyle=`rgba(255,255,255,${0.05+R()*0.08})`;g.beginPath();g.moveTo(cx+(R()-0.5)*30,cy-22);g.lineTo(cx+(R()-0.5)*30,cy+22);g.lineTo(cx-24,cy+(R()-0.5)*20);g.closePath();g.fill();}
    g.fillStyle=rgba(T.leafMid,0.35);for(let i=0;i<6;i++){g.beginPath();g.arc(cx+(R()-0.5)*26,cy+(R()-0.3)*24,2+R()*4,0,TAU);g.fill();}
    g.restore();out.push(c);
  }
  return out;
}

/* =====================================================================
   spatial grid / collision / line of sight
   ===================================================================== */
let STAMP=1;
function gridAdd(w,o){
  const c=o.shape==='c',x0=c?o.x-o.r:o.x,y0=c?o.y-o.r:o.y,x1=c?o.x+o.r:o.x+o.w,y1=c?o.y+o.r:o.y+o.h;
  for(let cy=Math.floor(y0/CELL);cy<=Math.floor(y1/CELL);cy++)for(let cx=Math.floor(x0/CELL);cx<=Math.floor(x1/CELL);cx++){
    const k=cy*4096+cx;let l=w.grid.get(k);if(!l){l=[];w.grid.set(k,l);}l.push(o);}
}
function gridQuery(w,x0,y0,x1,y1,cb){
  const s=++STAMP,cx0=Math.floor(x0/CELL),cx1=Math.floor(x1/CELL),cy0=Math.floor(y0/CELL),cy1=Math.floor(y1/CELL);
  for(let cy=cy0;cy<=cy1;cy++)for(let cx=cx0;cx<=cx1;cx++){const l=w.grid.get(cy*4096+cx);if(!l)continue;
    for(let i=0;i<l.length;i++){const o=l[i];if(o._s===s)continue;o._s=s;cb(o);}}
}
function addCirc(w,x,y,r,kind,f={}){const o={shape:'c',x,y,r,kind,move:!!f.move,bullet:!!f.bullet,los:!!f.los,canopy:!!f.canopy,_s:0};w.obs.push(o);gridAdd(w,o);return o;}
function addRect(w,x,y,ww,hh,kind,f={},hgt=0,col=null){const o={shape:'r',x,y,w:ww,h:hh,kind,move:!!f.move,bullet:!!f.bullet,los:!!f.los,hgt,col,_s:0};w.obs.push(o);gridAdd(w,o);if(hgt>0)w.rects.push(o);return o;}
function hitsObstacle(w,x,y,r){
  let hit=false;
  gridQuery(w,x-r,y-r,x+r,y+r,o=>{if(hit||!o.move)return;
    if(o.shape==='c'){if((x-o.x)**2+(y-o.y)**2<(r+o.r)**2)hit=true;}
    else{const qx=clamp(x,o.x,o.x+o.w),qy=clamp(y,o.y,o.y+o.h);if((x-qx)**2+(y-qy)**2<r*r)hit=true;}});
  return hit;
}
function rectHits(w,x,y,ww,hh){
  let hit=false;
  gridQuery(w,x,y,x+ww,y+hh,o=>{if(hit||!o.move)return;
    if(o.shape==='c'){const qx=clamp(o.x,x,x+ww),qy=clamp(o.y,y,y+hh);if((o.x-qx)**2+(o.y-qy)**2<o.r*o.r)hit=true;}
    else if(o.x<x+ww&&o.x+o.w>x&&o.y<y+hh&&o.y+o.h>y)hit=true;});
  return hit;
}
function resolve(w,e,r){
  for(let it=0;it<2;it++){
    gridQuery(w,e.x-r-2,e.y-r-2,e.x+r+2,e.y+r+2,o=>{
      if(!o.move)return;
      if(o.shape==='c'){const dx=e.x-o.x,dy=e.y-o.y,d=Math.hypot(dx,dy),m=r+o.r;if(d<m){if(d>1e-4){e.x=o.x+dx/d*m;e.y=o.y+dy/d*m;}else e.x+=m;}}
      else{const qx=clamp(e.x,o.x,o.x+o.w),qy=clamp(e.y,o.y,o.y+o.h),dx=e.x-qx,dy=e.y-qy,d=Math.hypot(dx,dy);
        if(d<r){if(d>1e-4){e.x=qx+dx/d*r;e.y=qy+dy/d*r;}
          else{const l=e.x-o.x,rt=o.x+o.w-e.x,t=e.y-o.y,b=o.y+o.h-e.y,m=Math.min(l,rt,t,b);
            if(m===l)e.x=o.x-r;else if(m===rt)e.x=o.x+o.w+r;else if(m===t)e.y=o.y-r;else e.y=o.y+o.h+r;}}}
    });
  }
  e.x=clamp(e.x,r+4,W-r-4);e.y=clamp(e.y,r+4,H-r-4);
}
function losFactor(w,ax,ay,bx,by){
  const s=++STAMP;let f=1;
  const cx0=Math.floor(Math.min(ax,bx)/CELL),cx1=Math.floor(Math.max(ax,bx)/CELL),cy0=Math.floor(Math.min(ay,by)/CELL),cy1=Math.floor(Math.max(ay,by)/CELL);
  for(let cy=cy0;cy<=cy1;cy++)for(let cx=cx0;cx<=cx1;cx++){const l=w.grid.get(cy*4096+cx);if(!l)continue;
    for(let i=0;i<l.length;i++){const o=l[i];if(o._s===s)continue;o._s=s;
      if(o.los){if(o.shape==='c'?segPointDist(ax,ay,bx,by,o.x,o.y)<o.r*0.92:segRect(ax,ay,bx,by,o))return 0;}
      else if(o.canopy){if(segPointDist(ax,ay,bx,by,o.x,o.y)<o.r*0.72){f*=0.62;if(f<0.15)return 0;}}}}
  return f;
}
function bulletHitOb(w,x,y){
  let hit=null;
  gridQuery(w,x-1,y-1,x+1,y+1,o=>{if(hit||!o.bullet)return;
    if(o.shape==='c'?(x-o.x)**2+(y-o.y)**2<o.r*o.r:x>=o.x&&x<=o.x+o.w&&y>=o.y&&y<=o.y+o.h)hit=o;});
  return hit;
}
function isWater(w,x,y){
  if(Math.abs(y-w.riverY(x))>=w.riverHW(x))return false;
  for(const b of w.bridges)if(Math.abs(x-b.x)<b.w/2&&Math.abs(y-b.y)<b.h/2)return false;
  return true;
}
function inGrass(w,x,y){for(const g of w.grass)if((x-g.x)**2+(y-g.y)**2<(g.r*0.9)**2)return true;return false;}
function underCanopy(w,x,y){let u=false;gridQuery(w,x-1,y-1,x+1,y+1,o=>{if(o.canopy&&(x-o.x)**2+(y-o.y)**2<(o.r*0.8)**2)u=true;});return u;}
function findFree(w,x,y,r){for(let k=0;k<40;k++){const a=k*2.4,d=k*7,nx=clamp(x+Math.cos(a)*d,r+6,W-r-6),ny=clamp(y+Math.sin(a)*d,r+6,H-r-6);if(!hitsObstacle(w,nx,ny,r)&&!isWater(w,nx,ny))return{x:nx,y:ny};}return{x,y};}

/* =====================================================================
   world generation
   ===================================================================== */
function freeSpot(w,x,y,r,o={}){
  if(x<r||x>W-r||y<r||y>H-r)return false;
  if(Math.abs(x-w.roadX(y))<r+36)return false;
  if(Math.abs(y-w.riverY(x))<w.riverHW(x)+r+16)return false;
  for(const c of w.camps)if(dist(x,y,c.x,c.y)<c.r+r)return false;
  if(dist(x,y,w.lz.x,w.lz.y)<w.lz.r+r+50)return false;
  if(!o.noObs&&hitsObstacle(w,x,y,r+2))return false;
  return true;
}
function placeRect(w,c,rw,rh,minR){
  for(let k=0;k<50;k++){
    const a=w.R()*TAU,d=minR+w.R()*Math.max(1,c.r*0.8-minR),cx=c.x+Math.cos(a)*d,cy=c.y+Math.sin(a)*d,x=cx-rw/2,y=cy-rh/2;
    if(Math.abs(cx-w.roadX(cy))<rw/2+38)continue;
    if(Math.abs(cy-w.riverY(cx))<w.riverHW(cx)+rh/2+24)continue;
    if(rectHits(w,x-16,y-16,rw+32,rh+32))continue;
    return{x,y};
  }
  return null;
}
function ringPath(w,c,rad,n){
  const pts=[],a0=w.R()*TAU;
  for(let i=0;i<n;i++){const a=a0+i*TAU/n,x=c.x+Math.cos(a)*rad,y=c.y+Math.sin(a)*rad;if(!hitsObstacle(w,x,y,14)&&!isWater(w,x,y))pts.push({x,y});}
  return pts.length>=2?pts:[{x:c.x+rad,y:c.y},{x:c.x-rad,y:c.y}];
}
function roadPatrol(w,yc,len){const pts=[];for(let y=yc-len/2;y<=yc+len/2;y+=110){const x=w.roadX(y)+14;if(!isWater(w,x,y))pts.push({x,y});}return pts;}
function wanderPath(w,x,y){
  const pts=[{x,y}];
  for(let i=0;i<3;i++)for(let k=0;k<12;k++){const a=w.R()*TAU,d=120+w.R()*220,nx=clamp(x+Math.cos(a)*d,60,W-60),ny=clamp(y+Math.sin(a)*d,60,H-60);
    if(!hitsObstacle(w,nx,ny,14)&&!isWater(w,nx,ny)){pts.push({x:nx,y:ny});break;}}
  return pts;
}
function buildCamp(w,c){
  const R=w.R,big=c.kind==='objective',wallY=c.y+c.r*0.78,half=c.r*0.62,SB=[150,134,100];
  addRect(w,c.x-half,wallY-6,half-30,12,'sandbag',{move:1,bullet:1},5,SB);
  addRect(w,c.x+30,wallY-6,half-30,12,'sandbag',{move:1,bullet:1},5,SB);
  if(big){addRect(w,c.x-c.r*0.82,c.y-c.r*0.25,12,c.r*0.55,'sandbag',{move:1,bullet:1},5,SB);addRect(w,c.x+c.r*0.82-12,c.y-c.r*0.25,12,c.r*0.55,'sandbag',{move:1,bullet:1},5,SB);}
  const nb=big?3:1+(R()<0.5?1:0);
  for(let i=0;i<nb;i++){const bw=70+R()*34,bh=50+R()*20,p=placeRect(w,c,bw,bh,big?130:40);if(p)addRect(w,p.x,p.y,bw,bh,'building',{move:1,bullet:1,los:1},16,R()<0.5?[132,94,70]:[140,138,128]);}
  const nt=big?3:1;
  for(let i=0;i<nt;i++){const hz=R()<0.5,tw=hz?52:36,th=hz?36:52,p=placeRect(w,c,tw,th,big?120:30);if(p)addRect(w,p.x,p.y,tw,th,'tent',{move:1,bullet:1,los:1},10,[94,104,66]);}
  const nc=big?4:2;
  for(let i=0;i<nc;i++){const p=placeRect(w,c,20,20,30);if(p){addRect(w,p.x,p.y,20,20,'crate',{move:1,bullet:1},6,[126,96,60]);if(R()<0.6&&!rectHits(w,p.x+22,p.y,20,20))addRect(w,p.x+22,p.y,20,20,'crate',{move:1,bullet:1},6,[118,90,56]);}}
  const nbar=big?6:2;
  for(let i=0;i<nbar;i++){const p=placeRect(w,c,16,16,40);if(p){const x=p.x+8,y=p.y+8,ob=addCirc(w,x,y,7,'barrel',{move:1,bullet:1});w.props.push({kind:'barrel',x,y,r:7,col:R()<0.5?[70,86,60]:[156,60,42],ob});}}
  const nl=big?4:2;
  for(let i=0;i<nl;i++){const p=placeRect(w,c,10,10,50);if(p){const x=p.x+5,y=p.y+5;w.lamps.push({x,y,r:185});w.props.push({kind:'lamp',x,y});}}
}
function genWorld(mi,dk,map=true){
  const M=MISSIONS[mi],D=DIFFS[dk],R=mulberry32(M.seed),N=makeNoise(M.seed),T=THEMES[M.theme];
  const w={M,D,R,N,T,grid:new Map(),obs:[],trees:[],rocks:[],rects:[],props:[],grass:[],mines:[],mineFields:[],signs:[],lamps:[],camps:[],bridges:[],targets:[],bunkers:[],enemies:[],pods:[],pickups:[],scorches:[],chunks:new Map()};
  w.wind=(R()-0.5)*40;
  const rb=H*0.52,ph=R()*10;w.riverBase=rb;
  w.riverY=x=>rb+Math.sin(x*0.0032+ph)*95+Math.sin(x*0.0105+ph*1.7)*24;
  w.riverHW=x=>46+Math.sin(x*0.006+ph*0.5)*12;
  const rp=[];let rx=W*0.5;
  for(let i=0;i<=Math.ceil((H+400)/200)+1;i++){rx=clamp(rx+(R()-0.5)*320,420,W-420);rp.push(rx);}
  w.roadX=y=>{const t=(y+100)/200,i=clamp(Math.floor(t),0,rp.length-2),f=clamp(t-i,0,1),s=f*f*(3-2*f);return rp[i]+(rp[i+1]-rp[i])*s;};
  // bridges
  let by=rb,bx=W/2;for(let k=0;k<8;k++){bx=w.roadX(by);by=w.riverY(bx);}
  const addBridge=(x,bw)=>{const y=w.riverY(x),hw=w.riverHW(x),b={x,y,w:bw,h:2*(hw+34),ry0:y-hw-12,rh:2*hw+24};w.bridges.push(b);
    addRect(w,x-bw/2-5,b.ry0,5,b.rh,'rail',{move:1});addRect(w,x+bw/2,b.ry0,5,b.rh,'rail',{move:1});return b;};
  addBridge(bx,64);
  addBridge(bx<W/2?W*0.74+R()*W*0.14:W*0.12+R()*W*0.14,34);
  // camps
  const side=R()<0.5?-1:1;
  const oy=H*0.3,ox=clamp(w.roadX(oy)+side*(240+R()*70),320,W-320);
  const obj={x:ox,y:oy,r:270,kind:'objective'};
  const ny=H*0.16,north={x:clamp(w.roadX(ny)-side*190,240,W-240),y:ny,r:130,kind:'outpost'};
  const bcx=clamp(bx+(bx<W/2?1:-1)*170,200,W-200),bridgeC={x:bcx,y:w.riverY(bcx)-w.riverHW(bcx)-175,r:120,kind:'outpost'};
  const my=H*0.71,mid={x:clamp(w.roadX(my)+side*170,240,W-240),y:my,r:130,kind:'outpost'};
  w.camps.push(obj,north,bridgeC,mid);w.objCamp=obj;
  w.lz={x:clamp(w.roadX(300)+(R()<0.5?-1:1)*(200+R()*250),260,W-260),y:300,r:85};
  // objective
  if(M.objective==='radar'){const ob=addCirc(w,ox,oy,36,'radar',{move:1,bullet:1,los:1});w.targets.push({type:'radar',x:ox,y:oy,hp:100,done:false,ob,rot:0,hitT:0,label:'Destroy the radar array'});}
  else if(M.objective==='intel'){addRect(w,ox-60,oy-40,120,80,'hq',{move:1,bullet:1,los:1},13,[86,96,62]);w.targets.push({type:'intel',x:ox,y:oy+58,done:false,hitT:0,label:'Steal the codebook'});
    w.lamps.push({x:ox+74,y:oy+62,r:190});w.props.push({kind:'lamp',x:ox+74,y:oy+62});}
  else{for(let k=0;k<3;k++){const a=-Math.PI/2+k*TAU/3+0.35,tx=ox+Math.cos(a)*112,ty=oy+Math.sin(a)*112,ob=addCirc(w,tx,ty,30,'tank',{move:1,bullet:1,los:1});
    w.targets.push({type:'fuel',x:tx,y:ty,hp:100,done:false,ob,hitT:0,label:`Destroy fuel tank ${'ABC'[k]}`});}}
  for(const c of w.camps)buildCamp(w,c);
  // bunkers
  const bpos=[[obj.x-obj.r*0.62-36,obj.y+obj.r*0.78],[obj.x+obj.r*0.62+36,obj.y+obj.r*0.78],[bx+78,by-w.riverHW(bx)-52],[north.x+north.r*0.62+36,north.y+north.r*0.78]];
  for(let i=0;i<Math.min(M.bunkers,bpos.length);i++){const[x,y]=bpos[i],ob=addCirc(w,x,y,24,'bunker',{move:1,bullet:1,los:1});
    w.bunkers.push({x,y,face:Math.PI/2,aim:Math.PI/2,hp:100,dead:false,aware:0,fireCd:0,burst:0,burstT:0,reactT:0,flash:0,lostT:0,ob});}
  // minefields
  for(let f=0;f<5;f++)for(let k=0;k<60;k++){
    const r=85+R()*45,x=r+40+R()*(W-2*r-80),y=H*(0.18+R()*0.52);
    if(Math.abs(x-w.roadX(y))<r+40)continue;if(Math.abs(y-w.riverY(x))<w.riverHW(x)+r+30)continue;
    if(w.camps.some(c=>dist(x,y,c.x,c.y)<c.r+r+30))continue;if(w.mineFields.some(m=>dist(x,y,m.x,m.y)<m.r+r+100))continue;
    w.mineFields.push({x,y,r});const n=9+Math.floor(R()*6);
    for(let i=0;i<n;i++){const a=R()*TAU,d=Math.sqrt(R())*r;w.mines.push({x:x+Math.cos(a)*d,y:y+Math.sin(a)*d,found:false,dead:false});}
    for(let s=0;s<6;s++){const a=s*TAU/6+R()*0.4;w.signs.push({x:x+Math.cos(a)*(r+14),y:y+Math.sin(a)*(r+14)});}
    break;
  }
  // vegetation
  const treeAt=(x,y,r)=>{if(!freeSpot(w,x,y,r*0.45))return;w.trees.push({x,y,r,v:Math.floor(R()*8)});addCirc(w,x,y,4+r*0.12,'trunk',{move:1,bullet:1});addCirc(w,x,y,r,'canopy',{canopy:1});};
  for(let i=0;i<36;i++){const cx=R()*W,cy=R()*H,rad=120+R()*280,n=rad*rad/2300;for(let k=0;k<n;k++){const a=R()*TAU,d=Math.sqrt(R())*rad;treeAt(cx+Math.cos(a)*d,cy+Math.sin(a)*d,16+R()*16);}}
  for(let i=0;i<300;i++)treeAt(R()*W,R()*H,14+R()*14);
  for(let y=30;y<H;y+=38){treeAt(18+R()*45,y,18+R()*12);treeAt(W-18-R()*45,y,18+R()*12);}
  for(let i=0;i<170;i++){const r=7+R()*15,x=R()*W,y=R()*H;if(freeSpot(w,x,y,r+4)){w.rocks.push({x,y,r,v:Math.floor(R()*6)});addCirc(w,x,y,r*0.9,'rock',{move:1,bullet:1,los:r>13});}}
  for(let i=0;i<55;i++){const r=60+R()*110,x=R()*W,y=R()*H;if(freeSpot(w,x,y,r*0.35,{noObs:true}))w.grass.push({x,y,r,seed:R()*1e9|0});}
  // enemies
  const sc=D.count,T2=T;
  const mk=(x,y,path,o={})=>{const f=findFree(w,x,y,11),ang=o.ang!==undefined?o.ang:R()*TAU;
    const e={x:f.x,y:f.y,ang,baseAng:ang,hp:50,state:'patrol',path,pi:o.pi||0,dir:1,pingpong:!!o.pingpong,wait:R()*2,speed:40+R()*12,view:T2.dark?215:320,fov:1.9,aware:0,
      lastX:f.x,lastY:f.y,tx:f.x,ty:f.y,lostT:0,fireCd:0,burst:0,burstT:0,reactT:0,stuckT:0,avoidT:0,avoidA:0,deadT:0,hit:0,flash:0,walk:R()*6,moving:false,scan:R()*10,searchT:0,bodyT:R(),found:false,scanA:ang};
    w.enemies.push(e);return e;};
  const ring=ringPath(w,obj,obj.r*0.6,10),ng=Math.round(4*sc);
  for(let i=0;i<ng;i++){const pi=Math.floor(i*ring.length/ng)%ring.length,q=ring[pi];mk(q.x,q.y,ring,{pi});}
  const wy0=obj.y+obj.r*0.78;
  mk(obj.x-22,wy0-24,[{x:obj.x-22,y:wy0-24}],{ang:Math.PI/2});
  mk(obj.x+22,wy0-24,[{x:obj.x+22,y:wy0-24}],{ang:Math.PI/2});
  if(sc>=1)mk(obj.x,obj.y-obj.r*0.75,[{x:obj.x,y:obj.y-obj.r*0.75}],{ang:-Math.PI/2});
  const inner=ringPath(w,obj,obj.r*0.34,6);mk(inner[0].x,inner[0].y,inner,{});
  for(const c of[north,bridgeC,mid]){const rg=ringPath(w,c,c.r*0.55,6);mk(rg[0].x,rg[0].y,rg,{});const wy=c.y+c.r*0.78;mk(c.x,wy-22,[{x:c.x,y:wy-22}],{ang:Math.PI/2});
    if(sc>=1){const h=Math.floor(rg.length/2);mk(rg[h].x,rg[h].y,rg,{pi:h});}}
  for(const yc of[H*0.41,H*0.22,H*0.64]){const pth=roadPatrol(w,yc,600);if(pth.length<2)continue;mk(pth[0].x,pth[0].y,pth,{pingpong:1});mk(pth[0].x+20,pth[0].y+30,pth.map(q=>({x:q.x+20,y:q.y})),{pingpong:1});}
  let rest=Math.max(4,Math.round(M.enemies*sc)-w.enemies.length),guard=0;
  while(rest>0&&guard++<500){const x=80+R()*(W-160),y=H*(0.07+R()*0.74);if(isWater(w,x,y)||hitsObstacle(w,x,y,14))continue;if(dist(x,y,w.lz.x,w.lz.y)<260)continue;mk(x,y,wanderPath(w,x,y),{});rest--;}
  w.treeSpr=makeTreeSprites(T,M.seed);w.rockSpr=makeRockSprites(T,M.seed);
  w.mapImg=map?M._map||(M._map=genMapImage(w)):null;
  return w;
}
function terrainColor(w,x,y){
  const N=w.N,T=w.T;
  const n=N.fbm(x*0.0018,y*0.0018,4),m=N.fbm(x*0.005+50,y*0.005+50,3),d=N.fbm(x*0.004+200,y*0.004-100,3);
  let c=mix3(T.grassA,T.grassB,clamp((n-0.3)*2.2,0,1));
  if(m>0.56)c=mix3(c,T.dry,clamp((m-0.56)*4,0,0.85));
  if(d>0.64)c=mix3(c,T.dirt,clamp((d-0.64)*5,0,0.75));
  for(const cp of w.camps){const dd=Math.hypot(x-cp.x,y-cp.y);if(dd<cp.r*1.15)c=mix3(c,T.dirt,clamp((cp.r*1.15-dd)/(cp.r*0.35),0,1)*0.85);}
  const lz=w.lz,dl=Math.hypot(x-lz.x,y-lz.y);if(dl<lz.r*1.7)c=mix3(c,shade(T.grassB,1.08),clamp((lz.r*1.7-dl)/(lz.r*0.6),0,1)*0.7);
  const v=0.92+N.n2(x*0.05,y*0.05)*0.16;
  return[c[0]*v,c[1]*v,c[2]*v];
}
function roadPath(g,w,y0,y1,off){g.beginPath();let f=true;for(let y=y0;y<=y1;y+=14){const x=w.roadX(y)+off;if(f){g.moveTo(x,y);f=false;}else g.lineTo(x,y);}}
function riverPoly(g,w,x0,x1,fn){g.beginPath();for(let x=x0;x<=x1;x+=10)g.lineTo(x,w.riverY(x)-fn(w.riverHW(x)));for(let x=x1;x>=x0;x-=10)g.lineTo(x,w.riverY(x)+fn(w.riverHW(x)));g.closePath();}
function genMapImage(w){
  const S=0.1,mw=Math.round(W*S),mh=Math.round(H*S),c=mkCanvas(mw,mh),g=c.getContext('2d');
  const L=0.05,lw=Math.round(W*L),lh=Math.round(H*L),lo=mkCanvas(lw,lh),lg=lo.getContext('2d'),id=lg.createImageData(lw,lh);
  for(let j=0;j<lh;j++)for(let i=0;i<lw;i++){const col=terrainColor(w,(i+0.5)/L,(j+0.5)/L),k=(j*lw+i)*4;id.data[k]=col[0];id.data[k+1]=col[1];id.data[k+2]=col[2];id.data[k+3]=255;}
  lg.putImageData(id,0,0);g.imageSmoothingEnabled=true;g.drawImage(lo,0,0,mw,mh);
  g.save();g.scale(S,S);const T=w.T;
  g.fillStyle=rgba(T.leafDark,0.35);for(const p of w.grass){g.beginPath();g.arc(p.x,p.y,p.r,0,TAU);g.fill();}
  riverPoly(g,w,-50,W+50,h=>h+14);g.fillStyle=rgb(T.bank);g.fill();riverPoly(g,w,-50,W+50,h=>h);g.fillStyle=rgb(T.water);g.fill();
  roadPath(g,w,-50,H+50,0);g.strokeStyle=rgb(T.road);g.lineWidth=50;g.lineCap='round';g.stroke();
  g.fillStyle='#6b4f33';for(const b of w.bridges)g.fillRect(b.x-b.w/2,b.y-b.h/2,b.w,b.h);
  g.fillStyle=rgb(T.leafDark);for(const t of w.trees){g.beginPath();g.arc(t.x,t.y,t.r*1.05,0,TAU);g.fill();}
  g.fillStyle=rgb(T.leafMid);for(const t of w.trees){g.beginPath();g.arc(t.x-t.r*0.2,t.y-t.r*0.2,t.r*0.6,0,TAU);g.fill();}
  for(const o of w.rects){g.fillStyle=o.kind==='sandbag'?'#a08e6a':o.kind==='crate'?'#7a5e3a':'#3b3b35';g.fillRect(o.x,o.y,o.w,o.h);}
  g.fillStyle=rgb(T.rock);for(const r of w.rocks){g.beginPath();g.arc(r.x,r.y,r.r,0,TAU);g.fill();}
  g.restore();
  return c;
}

/* =====================================================================
   terrain chunks
   ===================================================================== */
function paintScorch(g,x,y,r,seed){
  const gr=g.createRadialGradient(x,y,0,x,y,r);gr.addColorStop(0,'rgba(14,11,9,0.75)');gr.addColorStop(0.55,'rgba(22,17,12,0.4)');gr.addColorStop(1,'rgba(22,17,12,0)');
  g.fillStyle=gr;g.beginPath();g.arc(x,y,r,0,TAU);g.fill();
  const R=mulberry32(seed);g.fillStyle='rgba(10,8,6,0.5)';for(let i=0;i<14;i++){const a=R()*TAU,d=r*(0.6+R()*0.7);g.beginPath();g.arc(x+Math.cos(a)*d,y+Math.sin(a)*d,1+R()*2.5,0,TAU);g.fill();}
}
function addScorch(w,x,y,r){
  const s={x,y,r,seed:rnd()*1e9|0};w.scorches.push(s);
  for(const[k,c]of w.chunks){const cx=(k%1000)-100,cy=Math.floor(k/1000)-100,ox=cx*CHUNK,oy=cy*CHUNK;
    if(x+r>ox&&x-r<ox+CHUNK&&y+r>oy&&y-r<oy+CHUNK)paintScorch(c.getContext('2d'),x-ox,y-oy,r,s.seed);}
}
function getChunk(w,cx,cy,frame){
  const key=(cy+100)*1000+(cx+100);
  let c=w.chunks.get(key);if(c){c.used=frame;return c;}
  c=mkCanvas(CHUNK,CHUNK);const g=c.getContext('2d'),T=w.T,ox=cx*CHUNK,oy=cy*CHUNK,SUB=8,n=CHUNK/SUB+1;
  const lo=mkCanvas(n,n),lg=lo.getContext('2d'),id=lg.createImageData(n,n),dd=id.data;
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){const col=terrainColor(w,ox+i*SUB,oy+j*SUB),k=(j*n+i)*4;dd[k]=col[0];dd[k+1]=col[1];dd[k+2]=col[2];dd[k+3]=255;}
  lg.putImageData(id,0,0);g.imageSmoothingEnabled=true;g.imageSmoothingQuality='high';
  g.drawImage(lo,0,0,n,n,-SUB/2,-SUB/2,n*SUB,n*SUB);
  g.save();g.translate(-ox,-oy);
  const cr=mulberry32((key*2654435761)^w.M.seed);
  // camp gravel
  for(const cp of w.camps){if(cp.x+cp.r<ox||cp.x-cp.r>ox+CHUNK||cp.y+cp.r<oy||cp.y-cp.r>oy+CHUNK)continue;
    for(let i=0;i<500;i++){const a=cr()*TAU,d=Math.sqrt(cr())*cp.r;g.fillStyle=cr()<0.5?'rgba(0,0,0,0.13)':'rgba(255,240,210,0.09)';g.fillRect(cp.x+Math.cos(a)*d,cp.y+Math.sin(a)*d,1+cr()*2.5,1+cr()*2.5);}
    g.strokeStyle='rgba(40,28,16,0.12)';g.lineWidth=5;g.beginPath();g.arc(cp.x,cp.y,cp.r*0.6,0,TAU);g.stroke();}
  // road
  const y0=oy-40,y1=oy+CHUNK+40;g.lineCap='round';g.lineJoin='round';
  roadPath(g,w,y0,y1,0);g.strokeStyle=rgba(shade(T.dirt,0.8),0.55);g.lineWidth=64;g.stroke();
  roadPath(g,w,y0,y1,0);g.strokeStyle=rgb(T.road);g.lineWidth=48;g.stroke();
  for(const off of[-12,12]){roadPath(g,w,y0,y1,off);g.strokeStyle='rgba(40,28,16,0.16)';g.lineWidth=7;g.stroke();}
  roadPath(g,w,y0,y1,0);g.strokeStyle=rgba(T.grassA,0.25);g.lineWidth=5;g.stroke();
  for(let i=0;i<160;i++){const y=oy+cr()*CHUNK,x=w.roadX(y)+(cr()-0.5)*46;g.fillStyle=cr()<0.5?'rgba(0,0,0,0.12)':'rgba(255,240,210,0.1)';g.fillRect(x,y,1.5+cr()*2,1.5+cr()*2);}
  // river
  if(!(oy>w.riverBase+280||oy+CHUNK<w.riverBase-280)){
    const x0=ox-30,x1=ox+CHUNK+30,hasF='filter' in g;
    g.save();if(hasF)g.filter='blur(3px)';
    riverPoly(g,w,x0,x1,h=>h+18);g.fillStyle=rgba(T.bank,0.9);g.fill();
    riverPoly(g,w,x0,x1,h=>h+5);g.fillStyle=rgb(mix3(T.bank,T.deep,0.4));g.fill();
    riverPoly(g,w,x0,x1,h=>h);g.fillStyle=rgb(T.water);g.fill();
    if(hasF)g.filter='blur(9px)';
    riverPoly(g,w,x0,x1,h=>h*0.55);g.fillStyle=rgb(T.deep);g.fill();
    g.restore();
    g.strokeStyle='rgba(255,255,255,0.06)';g.lineWidth=1.5;g.beginPath();
    for(let k=-2;k<=2;k++){let f=true;for(let x=x0;x<=x1;x+=6){const y=w.riverY(x)+k*w.riverHW(x)*0.3+Math.sin(x*0.03+k)*3;if(f){g.moveTo(x,y);f=false;}else g.lineTo(x,y);}}
    g.stroke();
  }
  // bridges
  for(const b of w.bridges){if(b.x+b.w<ox-20||b.x-b.w>ox+CHUNK+20||b.y+b.h/2<oy||b.y-b.h/2>oy+CHUNK)continue;
    const x=b.x-b.w/2,y=b.y-b.h/2;
    g.fillStyle='rgba(0,0,0,0.3)';g.fillRect(x+8,y+10,b.w,b.h);
    g.fillStyle='#6b4f33';g.fillRect(x,y,b.w,b.h);
    for(let yy=y;yy<y+b.h;yy+=7){g.fillStyle=`rgba(255,220,170,${0.03+((yy*13)%7)/90})`;g.fillRect(x,yy,b.w,6);}
    g.strokeStyle='rgba(30,18,8,0.5)';g.lineWidth=1;g.beginPath();for(let yy=y+6.5;yy<y+b.h;yy+=7){g.moveTo(x,yy);g.lineTo(x+b.w,yy);}g.stroke();
    g.fillStyle='#3b2a1a';g.fillRect(x-5,b.ry0,5,b.rh);g.fillRect(x+b.w,b.ry0,5,b.rh);}
  // tall grass
  for(const p of w.grass){if(p.x+p.r<ox-10||p.x-p.r>ox+CHUNK+10||p.y+p.r<oy-10||p.y-p.r>oy+CHUNK+10)continue;
    const gr=g.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r*1.05);gr.addColorStop(0,rgba(T.leafDark,0.5));gr.addColorStop(0.75,rgba(T.leafDark,0.3));gr.addColorStop(1,rgba(T.leafDark,0));
    g.fillStyle=gr;g.beginPath();g.arc(p.x,p.y,p.r*1.05,0,TAU);g.fill();
    const pr=mulberry32(p.seed),cols=[rgba(T.leafDark,0.85),rgba(T.leafMid,0.8),rgba(T.leafLight,0.6)],cnt=Math.floor(p.r*p.r/14);
    g.lineWidth=1.3;
    for(let ci=0;ci<3;ci++){g.strokeStyle=cols[ci];g.beginPath();
      for(let i=0;i<cnt/3;i++){const a=pr()*TAU,d=Math.sqrt(pr())*p.r,x=p.x+Math.cos(a)*d,y=p.y+Math.sin(a)*d,skip=pr(),ba=-Math.PI/2+(pr()-0.5)*2.2,l=5+pr()*7;
        if(d>p.r*0.75&&skip<(d/p.r-0.75)*4)continue;g.moveTo(x,y);g.lineTo(x+Math.cos(ba)*l,y+Math.sin(ba)*l);}
      g.stroke();}}
  // tufts and pebbles
  g.lineWidth=1.2;
  const tc=[rgba(T.leafDark,0.5),rgba(T.leafMid,0.45),rgba(T.leafLight,0.32)];
  for(let ci=0;ci<3;ci++){g.strokeStyle=tc[ci];g.beginPath();
    for(let i=0;i<240;i++){const x=ox+8+cr()*(CHUNK-16),y=oy+8+cr()*(CHUNK-16);if(Math.abs(x-w.roadX(y))<32||isWater(w,x,y))continue;
      for(let b=0;b<3;b++){const a=-Math.PI/2+(cr()-0.5)*1.6,l=3+cr()*4;g.moveTo(x,y);g.lineTo(x+Math.cos(a)*l,y+Math.sin(a)*l);}}
    g.stroke();}
  for(let i=0;i<140;i++){const x=ox+cr()*CHUNK,y=oy+cr()*CHUNK;g.fillStyle=cr()<0.6?'rgba(0,0,0,0.1)':'rgba(255,250,230,0.1)';g.beginPath();g.arc(x,y,0.8+cr()*1.6,0,TAU);g.fill();}
  g.restore();
  g.globalCompositeOperation='overlay';g.globalAlpha=0.32;g.fillStyle=g.createPattern(GRAIN,'repeat');g.fillRect(0,0,CHUNK,CHUNK);
  g.globalCompositeOperation='source-over';g.globalAlpha=1;
  for(const s of w.scorches)if(s.x+s.r>ox&&s.x-s.r<ox+CHUNK&&s.y+s.r>oy&&s.y-s.r<oy+CHUNK)paintScorch(g,s.x-ox,s.y-oy,s.r,s.seed);
  c.used=frame;w.chunks.set(key,c);
  if(w.chunks.size>56)for(const[k,v]of w.chunks)if(v.used<frame-120)w.chunks.delete(k);
  return c;
}

/* =====================================================================
   game state
   ===================================================================== */
export function boot(canvas,{demo=false,reducedMotion=false,op=0,pilot:makePilot=null,sound=true,onExit=null}={}){
  // dom: the standalone page, with its screens, HUD, listeners, sound and saved scores
  const dom=!demo,offs=[],listen=(t,type,fn)=>{t.addEventListener(type,fn);offs.push(()=>t.removeEventListener(type,fn));};
  const audio=makeAudio();audio.muted=!sound;if(!dom)audio.unlock=()=>{};
  const cv=canvas,ctx=cv.getContext('2d'),darkCv=mkCanvas(2,2),darkCtx=darkCv.getContext('2d');
  const miniCv=dom?$('mini'):null,miniCtx=miniCv&&miniCv.getContext('2d');
  let CW=0,CH=0,DPR=1,VIGNETTE=null;
  const G={state:'title',world:null,player:null,plane:null,heli:null,heliT:-1,cam:{x:W/2,y:H*0.8,zoom:1,zf:0.85,shake:0},
    bullets:[],grenades:[],charges:[],particles:[],flashes:[],emitters:[],pending:[],stats:{},timeLeft:0,objDone:false,anyAlert:false,pVis:1,
    time:0,frame:0,dt:0.016,hurt:0,lastAlertSfx:-9,aaY:H*0.6,flakT:0,sel:0,diffKey:'veteran',diff:DIFFS.veteran,endT:0,paused:false,groundT:0,
    clouds:[],cloudSh:[],view:null,toastT:0};
  (()=>{const R=mulberry32(5);for(let i=0;i<70;i++)G.clouds.push({x:-800+R()*(W+1600),y:R()*H,s:220+R()*260});for(let i=0;i<34;i++)G.cloudSh.push({x:R()*(W+1600),y:R()*H,s:380+R()*420});})();
  function baseZoom(){return clamp(Math.min(CW/1350,CH/820),0.5,1.6);}
  function resize(){
    DPR=Math.min(2,window.devicePixelRatio||1);
    CW=innerWidth;CH=innerHeight;
    cv.width=Math.round(CW*DPR);cv.height=Math.round(CH*DPR);cv.style.width=CW+'px';cv.style.height=CH+'px';
    darkCv.width=Math.max(2,Math.round(CW/2));darkCv.height=Math.max(2,Math.round(CH/2));
    VIGNETTE=mkCanvas(Math.max(2,Math.round(CW/2)),Math.max(2,Math.round(CH/2)));const v=VIGNETTE.getContext('2d'),gr=v.createRadialGradient(VIGNETTE.width/2,VIGNETTE.height/2,Math.min(VIGNETTE.width,VIGNETTE.height)*0.35,VIGNETTE.width/2,VIGNETTE.height/2,Math.hypot(VIGNETTE.width,VIGNETTE.height)*0.6);
    gr.addColorStop(0,'rgba(0,0,0,0)');gr.addColorStop(1,'rgba(0,0,0,0.6)');v.fillStyle=gr;v.fillRect(0,0,VIGNETTE.width,VIGNETTE.height);
  }
  listen(window,'resize',resize);resize();

  /* ---------- input ---------- */
  // bindings come from game.json: keyboard+mouse are the original ones, pad bindings are positional (South = A / ✕).
  // The demo's input hears nothing but the autopilot's virtual pad, on a private target, and stays unregistered
  // so the host's <input-glyph> elements keep following the host's own input.
  const pilot=!dom&&makePilot?makePilot({G,restart:()=>startPreview(++op)}):null;
  const input=dom?createInput({...meta.input,mouseTarget:cv,preventDefault:['Space','Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight']})
    :createInput({...meta.input,target:new EventTarget(),getGamepads:()=>pilot?[pilot.pad]:[],register:false});
  const mouse={x:CW/2,y:CH/2-100};
  const padAim=()=>input.device.kind==='gamepad',AIM_D=230;   // pad: aim point this far along the facing
  const SCREENS=['title','brief','pause','end'];
  const menuRoot=()=>SCREENS.map($).find(s=>!s.classList.contains('hidden'));
  function menuDefault(){const r=menuRoot();return r&&(r.querySelector('.primary')||r.querySelector('.mcard[aria-selected="true"]'));}
  function menuFocus(){const r=menuRoot(),a=document.activeElement;return r&&a&&a.classList.contains('pad-focus')&&r.contains(a)?a:null;}
  let nav=null;
  if(dom){
    listen(window,'keydown',()=>audio.unlock());
    listen(window,'mousemove',e=>{mouse.x=e.clientX;mouse.y=e.clientY;});
    listen(cv,'mousedown',()=>audio.unlock());
    listen(cv,'contextmenu',e=>e.preventDefault());
    listen(window,'blur',()=>{if(inPlay()&&!G.paused)setPaused(true);});
    input.on('mute',()=>{audio.setMuted(!audio.muted);toast(audio.muted?'Sound off':'Sound on');});
    // pad Start outside play goes forward: the focused operation card or the screen's primary button (Start, Start deploys)
    input.on('pause',()=>{if(inPlay())setPaused(!G.paused);else if(padAim()){const f=menuFocus(),el=f&&f.classList.contains('mcard')?f:menuDefault();if(el)el.click();}});
    input.on('back',()=>{if(G.state==='brief')toTitle();else if(G.state==='title'&&onExit)onExit();});
    nav=menuNav(input,{root:menuRoot,enabled:()=>!inPlay()||G.paused,onBack:()=>{if(G.state==='brief')toTitle();else if(G.paused)setPaused(false);else if(G.state==='title'&&onExit)onExit();}});
    $('exitHint').hidden=!onExit;
  }
  const padFocus=el=>{if(nav)nav.focus(el);};
  // a pad press that leaves a menu for play (South on Deploy / Resume) must not also act in the game:
  // gameplay buttons stay dead until they are all let go
  const PLAY_ACTS=['fire','grenade','charge','reload','crouch','prone','interact','medkit','pod','jump','sprint'];
  let inputLock=false;
  const pr=a=>!inputLock&&input.pressed(a),hd=a=>!inputLock&&input.held(a);
  function rumble(ms,strong,weak){if(padAim())input.rumble(ms,strong,weak);}
  const inPlay=()=>['flight','para','ground'].includes(G.state);
  function screenToWorld(sx,sy){const c=G.cam;return{x:(sx-CW/2)/c.zoom+c.x,y:(sy-CH/2)/c.zoom+c.y};}
  const aimPoint=p=>({x:p.x+Math.cos(p.ang)*AIM_D,y:p.y+Math.sin(p.ang)*AIM_D});
  const volAt=(x,y)=>Math.pow(clamp(1-dist(x,y,G.cam.x,G.cam.y)/1300,0,1),1.6);

  /* ---------- fx helpers ---------- */
  function addP(o){if(G.particles.length>1600)return;if(o.vx===undefined)o.vx=0;if(o.vy===undefined)o.vy=0;G.particles.push(o);}
  function addFlash(x,y,r,life,c){G.flashes.push({x,y,r,life,max:life,c});}
  function puff(x,y,n,c,spd,size,life,a=0.45){for(let i=0;i<n;i++){const an=rnd()*TAU,s=rr(spd*0.3,spd);addP({type:'smoke',c,x,y,vx:Math.cos(an)*s,vy:Math.sin(an)*s,life:rr(life*0.6,life),max:life,size:rr(size*0.6,size),grow:size*0.8,drag:2.5,a});}}
  function splash(x,y,n=6){for(let i=0;i<n;i++){const an=rnd()*TAU;addP({type:'splash',x:x+Math.cos(an)*rr(0,6),y:y+Math.sin(an)*rr(0,6),life:rr(0.4,0.8),max:0.8,size:rr(3,8)});}}
  function impactFX(x,y,kind,ang){
    const hard=kind==='bunker'||kind==='tank'||kind==='radar'||kind==='rock'||kind==='rail'||kind==='barrel';
    if(hard)for(let i=0;i<5;i++){const a=ang+rr(-0.9,0.9),s=rr(120,320);addP({type:'spark',x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:rr(0.1,0.25),max:0.25,drag:4});}
    puff(x,y,hard?2:4,hard?'grey':'dust',40,8,0.7,0.5);
    if(kind==='trunk'||kind==='crate')for(let i=0;i<3;i++){const a=ang+rr(-1,1),s=rr(40,120);addP({type:'debris',x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,z:4,vz:rr(40,120),life:1,max:1,size:rr(1,2),col:'#5a4026'});}
  }
  function toast(msg,t=2.6){if(!dom)return;const el=$('toast');el.innerHTML=msg;el.classList.add('show');G.toastT=t;}
  function flak(x,y){addFlash(x,y,260,0.25,'255,180,90');puff(x,y,6,'dark',60,40,2.4,0.6);for(let i=0;i<6;i++){const a=rnd()*TAU;addP({type:'fire',x,y,vx:Math.cos(a)*90,vy:Math.sin(a)*90,life:0.3,max:0.3,size:22,grow:30,drag:3});}
    audio.boom(0.25,0.6);G.cam.shake=Math.max(G.cam.shake,4);rumble(90,0.25,0.35);}

  /* =====================================================================
     mission flow
     ===================================================================== */
  function makePlayer(x,y){return{x,y,z:1,ang:-Math.PI/2,stance:'stand',stanceT:0,hp:100,ammo:30,mags:3,grenades:2,charges:1,medkits:1,reloadT:0,fireCd:0,throwCd:0,walk:0,moving:false,sprint:false,lastShot:-9,flash:0,interactT:0,interacting:false,inWater:false,boarded:false,hurtT:0,bloom:0};}
  function resetRun(){
    G.player=null;G.heli=null;G.heliT=-1;G.bullets=[];G.grenades=[];G.charges=[];G.particles=[];G.flashes=[];G.emitters=[];G.pending=[];
    G.stats={kills:0,shots:0,hits:0,bunkers:0};G.objDone=false;G.anyAlert=false;G.paused=false;G.hurt=0;G.groundT=0;
  }
  function selectMission(i){
    G.sel=i;resetRun();G.world=genWorld(i,G.diffKey);G.state='brief';
    G.cam.x=G.world.objCamp.x;G.cam.y=G.world.objCamp.y+400;
    const M=MISSIONS[i];
    $('bKicker').textContent=`${M.code} · ${DIFFS[G.diffKey].label}`;$('bName').textContent=`Operation ${M.name}`;$('bText').textContent=M.brief;
    $('bTime').textContent=fmtTime(M.time);$('bEnemy').textContent='~'+G.world.enemies.length;$('bCond').textContent=M.cond;
    drawBriefMap();show('brief');
  }
  function startMission(i,map=true){
    G.sel=i;resetRun();const w=G.world=genWorld(i,G.diffKey,map),M=w.M;G.diff=DIFFS[G.diffKey];
    G.plane={x:clamp(w.roadX(H-500)+rr(-200,200),300,W-300),y:H-500,vx:0,speed:250,pods:3,bank:0,prop:0,heading:-Math.PI/2,leaving:false,warned:false,t:0};
    G.state='flight';G.cam.x=G.plane.x;G.cam.y=G.plane.y-140;G.cam.zf=0.45;G.timeLeft=M.time;G.flakT=0;
    if(dom){$('hMission').textContent=`${M.code} · Operation ${M.name}`;
      show(null);$('hud').classList.remove('hidden');for(const k in hudCache)delete hudCache[k];}
    audio.unlock();audio.setLoop('plane',0.35);
    toast(`Over the drop area. ${glyphHTML('pod')} drops a supply pod, ${glyphHTML('jump')} jumps.`,4);
  }
  function jump(){
    const pl=G.plane;G.player=makePlayer(pl.x,pl.y+20);G.state='para';pl.leaving=true;pl.t=0;
    audio.setLoop('wind',0.22);toast(pl.y<=G.aaY+2?'Flak line! You are out of the door.':`Out of the door. Steer your canopy with ${glyphHTML('move')}.`);
  }
  function checkObjectives(){
    const w=G.world;if(G.objDone||!w.targets.every(t=>t.done))return;
    G.objDone=true;G.heliT=8;toast('Objective complete. Extraction inbound, get to the LZ!',4);
    const p=G.player;
    for(const e of w.enemies){if(e.state==='dead'||e.state==='alert')continue;if(dist(e.x,e.y,p.x,p.y)<1200){e.state='search';e.lastX=e.tx=p.x+rr(-120,120);e.lastY=e.ty=p.y+rr(-120,120);e.searchT=14;e.aware=Math.max(e.aware,0.6);}}
    let spawned=0;
    for(let k=0;k<60&&spawned<Math.round(4*G.diff.count);k++){
      const a=rnd()*TAU,d=rr(520,760),x=p.x+Math.cos(a)*d,y=p.y+Math.sin(a)*d;
      if(x<60||x>W-60||y<60||y>H-60||hitsObstacle(w,x,y,14)||isWater(w,x,y))continue;
      w.enemies.push({x,y,ang:Math.atan2(p.y-y,p.x-x),baseAng:0,hp:50,state:'search',path:[{x,y}],pi:0,dir:1,pingpong:false,wait:0,speed:48,view:w.T.dark?215:320,fov:1.9,aware:0.6,
        lastX:p.x,lastY:p.y,tx:p.x,ty:p.y,lostT:0,fireCd:0,burst:0,burstT:0,reactT:0,stuckT:0,avoidT:0,avoidA:0,deadT:0,hit:0,flash:0,walk:0,moving:false,scan:rnd()*10,searchT:20,bodyT:0,found:false,scanA:0});
      spawned++;
    }
  }
  function finish(win,reason){
    if(G.state==='end')return;
    if(!dom){G.state='end';audio.stopLoops();return;}   // demo: no scores, the autopilot fades to the next run
    const w=G.world,M=w.M,p=G.player;
    G.state='end';G.paused=false;audio.stopLoops();playing(false);$('hud').classList.add('hidden');
    const objs=w.targets.filter(t=>t.done).length,tot=w.targets.length,acc=G.stats.shots?Math.round(G.stats.hits/G.stats.shots*100):0;
    let score=G.stats.kills*100+Math.round(objs*1500/tot)+G.stats.bunkers*250;
    if(win)score+=2000+Math.round(G.timeLeft)*5+Math.round(p?p.hp:0)*10;
    score=Math.round(score*G.diff.mult);
    const rank=win?(score>9000?'★★★':score>6000?'★★':'★'):'';
    const card=$('endCard');card.classList.toggle('fail',!win);
    $('eKicker').textContent=`${M.code} · Operation ${M.name} · ${G.diff.label}`;
    $('eTitle').textContent=win?'Mission accomplished':reason==='timeout'?'Left behind':'Killed in action';
    $('eText').textContent=win?'The helicopter clears the treeline with you aboard. Command sends its thanks.':reason==='timeout'?'The extraction window closed and the helicopter turned for home without you.':'Your war ended in the long grass, far from home.';
    const used=M.time-G.timeLeft,pods=w.pods.filter(q=>q.collected).length;
    $('eStats').innerHTML=[['Hostiles neutralized',G.stats.kills],['Bunkers destroyed',G.stats.bunkers],['Objectives',`${objs}/${tot}`],['Accuracy',acc+'%'],['Time in the field',fmtTime(used)],['Supply pods recovered',`${pods}/${w.pods.length}`]]
      .map(([k,v])=>`<div>${k}<b>${v}</b></div>`).join('');
    $('eScore').textContent=score.toLocaleString();$('eRank').textContent=rank;
    if(win){try{const key='dropzone-best-'+G.sel,b=+localStorage.getItem(key)||0;if(score>b)localStorage.setItem(key,score);}catch{/* storage blocked */}}
    show('end');
  }
  function setPaused(p){G.paused=p;show(p?'pause':null);if(p)playing(false);else if(G.state==='ground')playing(true);}
  function toTitle(){resetRun();G.state='title';audio.stopLoops();$('hud').classList.add('hidden');playing(false);buildMenu();show('title');}
  const playing=on=>{if(dom)document.body.classList.toggle('playing',on);};
  function show(id){if(!dom)return;for(const s of SCREENS)$(s).classList.toggle('hidden',s!==id);padFocus(id&&padAim()?menuDefault():null);}
  const fmtTime=s=>{s=Math.max(0,Math.ceil(s));return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');};

  /* =====================================================================
     update: player
     ===================================================================== */
  function computeVis(){
    const p=G.player,w=G.world;if(!p)return;
    let v=1;
    if(p.stance==='crouch')v*=0.62;else if(p.stance==='prone')v*=0.36;
    if(p.moving&&p.stance==='stand')v*=p.sprint?1.35:1.1;if(!p.moving)v*=0.85;
    if(p.stance!=='stand'&&inGrass(w,p.x,p.y))v*=0.5;
    if(underCanopy(w,p.x,p.y))v*=0.6;
    p.lit=false;if(w.T.dark){for(const l of w.lamps)if(dist(l.x,l.y,p.x,p.y)<l.r*0.75){p.lit=true;break;}if(p.lit)v*=1.6;}
    if(p.inWater)v*=1.1;
    if(G.time-p.lastShot<0.5)v=Math.max(v,1.4);
    G.pVis=v;
  }
  function noiseAt(x,y,r,amt,search){
    for(const e of G.world.enemies){if(e.state==='dead'||e.state==='alert')continue;const d=dist(x,y,e.x,e.y);if(d>=r)continue;
      if(search){e.state='search';e.lastX=e.tx=x+rr(-70,70);e.lastY=e.ty=y+rr(-70,70);e.searchT=10;e.wait=0;e.aware=Math.max(e.aware,0.6);e.ang=turnTo(e.ang,Math.atan2(y-e.y,x-e.x),1.6);}
      else e.aware=Math.min(0.95,e.aware+amt*G.dt);}
    if(search)for(const b of G.world.bunkers)if(!b.dead&&dist(x,y,b.x,b.y)<r)b.aware=Math.max(b.aware,0.6);
  }
  function updatePlayer(dt){
    const p=G.player,w=G.world;if(p.hp<=0)return;
    G.groundT+=dt;
    p.flash=Math.max(0,p.flash-dt);p.hurtT=Math.max(0,p.hurtT-dt);p.fireCd-=dt;p.throwCd-=dt;p.bloom=Math.max(0,p.bloom-dt*0.12);
    if(pr('crouch')){p.stance=p.stance==='crouch'?'stand':'crouch';p.stanceT=0.2;}
    if(pr('prone')){p.stance=p.stance==='prone'?'crouch':'prone';p.stanceT=0.4;}
    p.inWater=isWater(w,p.x,p.y);
    if(p.inWater&&p.stance==='prone'){p.stance='crouch';toast('Too deep to crawl');}
    let mx=input.axis('left','right'),my=input.axis('up','down');
    const ml=Math.hypot(mx,my);if(ml>1){mx/=ml;my/=ml;}   // keys: unit speed; stick: analog
    p.sprint=hd('sprint')&&p.stance==='stand';
    let sp=p.stance==='stand'?(p.sprint?200:135):p.stance==='crouch'?80:42;
    if(p.inWater)sp*=0.5;
    if(p.stanceT>0){p.stanceT-=dt;sp*=0.35;}
    if(p.interacting)sp=0;
    p.moving=ml>0&&sp>0;
    if(p.moving){p.x+=mx*sp*dt;p.y+=my*sp*dt;p.walk+=dt*sp*0.085;
      if(p.inWater&&rnd()<dt*8)splash(p.x,p.y,3);else if(p.sprint&&rnd()<dt*6)puff(p.x,p.y+4,1,'dust',20,8,0.8,0.35);}
    resolve(w,p,9);
    let m;
    if(padAim()){const r=input.stick('right');   // right stick aims; centred: hold the angle, or face the walk when not firing
      if(Math.hypot(r.x,r.y)>0.3)p.ang=Math.atan2(r.y,r.x);else if(ml>0&&!hd('fire'))p.ang=turnTo(p.ang,Math.atan2(my,mx),dt*8);
      m=aimPoint(p);}
    else{m=screenToWorld(mouse.x,mouse.y);p.ang=Math.atan2(m.y-p.y,m.x-p.x);}
    if(p.reloadT>0){p.reloadT-=dt;if(p.reloadT<=0){p.ammo=30;p.mags--;}}
    if(pr('reload')&&p.reloadT<=0&&p.ammo<30){if(p.mags>0){p.reloadT=1.5;audio.reload();}else toast('No magazines left');}
    if(hd('fire')&&!p.interacting&&p.fireCd<=0&&p.reloadT<=0){
      if(p.ammo>0)playerFire();
      else if(p.mags>0){p.reloadT=1.5;audio.reload();}
      else{audio.click();p.fireCd=0.35;toast('Out of ammo');}
    }
    if(pr('grenade')&&p.throwCd<=0){if(p.grenades>0)throwGrenade(m.x,m.y);else toast('No grenades');}
    if(pr('charge')){if(p.charges>0){p.charges--;G.charges.push({x:p.x+Math.cos(p.ang)*10,y:p.y+Math.sin(p.ang)*10,t:5,beep:0});audio.beep();toast('Charge armed, 5 seconds. Move!');}else toast('No demolition charges');}
    if(pr('medkit')){if(p.medkits<=0)toast('No medkits');else if(p.hp>=100)toast('Already at full health');else{p.medkits--;p.hp=Math.min(100,p.hp+60);audio.pickup();toast('+60 health');}}
    const it=w.targets.find(t=>t.type==='intel'&&!t.done&&dist(t.x,t.y,p.x,p.y)<46);
    p.interacting=false;G.hintNear='';
    if(it){if(hd('interact')){p.interacting=true;p.interactT+=dt;if(p.interactT>=1.8){it.done=true;p.interactT=0;audio.pickup();toast('Codebook secured');checkObjectives();}}else{p.interactT=0;G.hintNear=`Hold ${glyphHTML('interact')} to take the codebook`;}}
    else p.interactT=0;
    for(const pod of w.pods)if(pod.landed&&!pod.collected&&dist(pod.x,pod.y,p.x,p.y)<26){pod.collected=true;p.mags+=3;p.grenades+=2;p.charges+=1;p.medkits+=1;audio.pickup();toast('Supply pod: +3 mags · +2 grenades · +1 charge · +1 medkit',3.2);}
    for(let i=w.pickups.length-1;i>=0;i--){const k=w.pickups[i];if(dist(k.x,k.y,p.x,p.y)<22){p.mags++;w.pickups.splice(i,1);audio.pickup();toast('+1 magazine');}}
    for(const mn of w.mines){if(mn.dead)continue;const d=dist(mn.x,mn.y,p.x,p.y);
      if(!mn.found&&d<(p.stance==='stand'?26:64)){mn.found=true;toast('Mine spotted!');}
      if(d<10){mn.dead=true;explode(mn.x,mn.y,70,85,{src:'mine'});if(p.hp<=0)return;}}
    if(p.sprint&&p.moving)noiseAt(p.x,p.y,120,0.9,false);
    if(!G.objDone&&dist(p.x,p.y,w.lz.x,w.lz.y)<w.lz.r)G.hintNear='The helicopter only comes once the objective is complete';
  }
  function playerFire(){
    const p=G.player;p.ammo--;p.fireCd=0.105;p.lastShot=G.time;p.flash=0.05;G.stats.shots++;
    let spread=p.stance==='prone'?0.012:p.stance==='crouch'?0.022:0.034;if(p.moving)spread+=p.stance==='stand'?0.04:0.02;
    p.bloom=Math.min(0.06,p.bloom+0.012);spread+=p.bloom;
    const a=p.ang+(rnd()-0.5)*2*spread,ca=Math.cos(p.ang),sa=Math.sin(p.ang),mx=p.x+ca*22-sa*1.5,my=p.y+sa*22+ca*1.5;
    G.bullets.push({x:mx,y:my,vx:Math.cos(a)*1300,vy:Math.sin(a)*1300,life:0.55,owner:'p',dmg:30+rnd()*12});
    addFlash(mx,my,150,0.06,'255,210,140');audio.shot(1,1);G.cam.shake=Math.max(G.cam.shake,2);
    addP({type:'shell',x:p.x,y:p.y,vx:Math.cos(p.ang+1.6)*rr(60,110),vy:Math.sin(p.ang+1.6)*rr(60,110),z:6,vz:rr(60,120),life:1.2,max:1.2,rot:rnd()*TAU});
    noiseAt(p.x,p.y,G.world.T.dark?560:460,1,true);
  }
  function throwGrenade(tx,ty){
    const p=G.player;p.grenades--;p.throwCd=0.9;
    const maxR=p.stance==='prone'?170:p.stance==='crouch'?250:310;let dx=tx-p.x,dy=ty-p.y;const d=Math.hypot(dx,dy)||1,dd=Math.min(d,maxR);dx=dx/d*dd;dy=dy/d*dd;
    const t=clamp(dd/360,0.35,0.95),z0=14,vz=(0.5*900*t*t-z0)/t;
    G.grenades.push({x:p.x+Math.cos(p.ang)*8,y:p.y+Math.sin(p.ang)*8,z:z0,vx:dx/t,vy:dy/t,vz,fuse:2.2,spin:0,rest:false});
    audio.tone(500,0.05,'triangle',0.05);
  }
  function damagePlayer(dmg){
    const p=G.player;if(!p||p.hp<=0||p.boarded)return;
    p.hp-=dmg;if(!dom&&p.hp<35)p.hp=35;   // attract mode: the ranger takes hits but stays up
    p.hurtT=0.4;G.hurt=Math.min(1,G.hurt+dmg/40);audio.hurt();G.cam.shake=Math.max(G.cam.shake,6);rumble(150,Math.min(1,0.4+dmg/50),0.5);
    for(let i=0;i<3;i++)addP({type:'blood',x:p.x+rr(-5,5),y:p.y+rr(-5,5),life:0.8,max:0.8,size:rr(5,9),vx:rr(-20,20),vy:rr(-20,20),drag:3});
    if(p.hp<=0){p.hp=0;G.state='dead';G.endT=2.6;toast('Ranger down',3);playing(false);}
  }

  /* =====================================================================
     update: enemies, bunkers
     ===================================================================== */
  function setAlert(e,shout){
    const p=G.player;
    if(e.state!=='alert'){e.reactT=0.45*G.diff.react+rnd()*0.3;if(G.time-G.lastAlertSfx>3){audio.alert();G.lastAlertSfx=G.time;}}
    e.state='alert';e.aware=1;e.lastX=p.x;e.lastY=p.y;e.lostT=0;
    if(shout)for(const o of G.world.enemies){if(o===e||o.state==='dead'||o.state==='alert')continue;
      if(dist(o.x,o.y,e.x,e.y)<320){o.state='search';o.lastX=o.tx=p.x+rr(-40,40);o.lastY=o.ty=p.y+rr(-40,40);o.searchT=10;o.wait=0;o.aware=Math.max(o.aware,0.65);}}
  }
  function moveEnemy(e,tx,ty,sp,dt,face){
    const w=G.world;let a=Math.atan2(ty-e.y,tx-e.x);
    if(e.avoidT>0){e.avoidT-=dt;a=e.avoidA;}
    if(isWater(w,e.x,e.y))sp*=0.5;
    const ox=e.x,oy=e.y;e.x+=Math.cos(a)*sp*dt;e.y+=Math.sin(a)*sp*dt;resolve(w,e,9);
    const moved=Math.hypot(e.x-ox,e.y-oy);
    if(moved<sp*dt*0.35){e.stuckT+=dt;if(e.stuckT>0.35){e.stuckT=0;e.avoidT=0.5+rnd()*0.6;e.avoidA=a+(rnd()<0.5?1:-1)*(Math.PI/2+rnd()*0.6);}}
    else e.stuckT=Math.max(0,e.stuckT-dt);
    e.moving=moved>0.1;e.walk+=moved*0.085;
    if(face&&e.moving)e.ang=turnTo(e.ang,Math.atan2(e.y-oy,e.x-ox),dt*5);
  }
  function enemyFire(e){
    const p=G.player;if(!p)return;
    let spread=0.05/G.diff.acc+(p.stance==='prone'?0.05:p.stance==='crouch'?0.02:0)+(p.moving?0.025:0);
    const a=e.ang+(rnd()-0.5)*2*spread,mx=e.x+Math.cos(e.ang)*22,my=e.y+Math.sin(e.ang)*22;
    G.bullets.push({x:mx,y:my,vx:Math.cos(a)*900,vy:Math.sin(a)*900,life:0.75,owner:'e',dmg:G.diff.dmg*(0.8+rnd()*0.4)});
    e.flash=0.05;addFlash(mx,my,110,0.06,'255,200,120');audio.shot(volAt(e.x,e.y)*0.8,0.82);
  }
  function killEnemy(e){
    if(e.state==='dead')return;
    e.state='dead';e.burst=0;e.deadT=0;e.hp=0;e.ang+=rr(-0.4,0.4);G.stats.kills++;
    for(let i=0;i<4;i++)addP({type:'blood',x:e.x+rr(-6,6),y:e.y+rr(-6,6),life:1,max:1,size:rr(5,10),vx:rr(-30,30),vy:rr(-30,30),drag:3});
    if(rnd()<0.42)G.world.pickups.push({x:e.x+rr(-10,10),y:e.y+rr(-10,10)});
  }
  function hitEnemy(e,b){
    const dmg=b.dmg*(rnd()<0.2?2:1);e.hp-=dmg;e.hit=0.12;G.stats.hits++;
    for(let i=0;i<2;i++)addP({type:'blood',x:e.x,y:e.y,life:0.6,max:0.6,size:rr(4,7),vx:b.vx*0.04+rr(-20,20),vy:b.vy*0.04+rr(-20,20),drag:4});
    if(e.hp<=0)killEnemy(e);else setAlert(e,true);
  }
  function updateEnemies(dt){
    const w=G.world,p=G.player,ground=G.state==='ground'&&p&&p.hp>0&&!p.boarded;
    let anyAlert=false;
    for(const e of w.enemies){
      if(e.state==='dead'){e.deadT+=dt;continue;}
      e.hit=Math.max(0,e.hit-dt);e.flash=Math.max(0,e.flash-dt);e.fireCd-=dt;e.reactT-=dt;
      let sees=false,d=1e9,a=0;
      if(ground){d=dist(e.x,e.y,p.x,p.y);
        if(d<720){a=Math.atan2(p.y-e.y,p.x-e.x);const range=e.state==='alert'?600:e.view*G.pVis;
          if(d<range){const inF=e.state==='alert'||Math.abs(angDiff(e.ang,a))<e.fov/2||d<40+30*G.pVis;
            if(inF&&losFactor(w,e.x,e.y,p.x,p.y)>(e.state==='alert'?0.15:0.3))sees=true;}}}
      if(e.state!=='alert'){
        if(sees){e.aware+=dt*(0.5+2.2*(1-d/Math.max(60,e.view*G.pVis)))*G.diff.aware*(e.state==='search'?1.7:1);
          if(e.aware>0.35)e.ang=turnTo(e.ang,a,dt*2.5);if(e.aware>=1)setAlert(e,true);}
        else e.aware=Math.max(0,e.aware-dt*0.1);
      }
      if(e.state==='alert'){
        anyAlert=true;
        if(sees){e.lastX=p.x;e.lastY=p.y;e.lostT=0;e.ang=turnTo(e.ang,a,dt*6);
          if(d>300)moveEnemy(e,p.x,p.y,e.speed*1.7,dt,false);
          else if(d<110)moveEnemy(e,e.x-(p.x-e.x),e.y-(p.y-e.y),e.speed,dt,false);
          else e.moving=false;
          if(e.reactT<=0&&e.fireCd<=0&&e.burst===0&&Math.abs(angDiff(e.ang,a))<0.25){e.burst=G.diff.burst;e.burstT=0;e.fireCd=(1.0+rnd())*G.diff.react+G.diff.burst*0.12;}
        }else{
          e.lostT+=dt;moveEnemy(e,e.lastX,e.lastY,e.speed*1.6,dt,true);
          if(dist(e.x,e.y,e.lastX,e.lastY)<24||e.lostT>7||!ground){e.state='search';e.searchT=9;e.aware=0.6;e.tx=e.lastX;e.ty=e.lastY;e.wait=0;}
        }
      }else if(e.state==='search'){
        e.searchT-=dt;
        if(dist(e.x,e.y,e.tx,e.ty)<20){e.moving=false;e.wait-=dt;e.ang+=Math.sin(G.time*2+e.scan)*dt*1.5;
          if(e.wait<=0){const an=rnd()*TAU,r=60+rnd()*140;e.tx=clamp(e.lastX+Math.cos(an)*r,20,W-20);e.ty=clamp(e.lastY+Math.sin(an)*r,20,H-20);e.wait=1+rnd()*1.5;}}
        else moveEnemy(e,e.tx,e.ty,e.speed*1.25,dt,true);
        if(e.searchT<=0){e.state='patrol';e.aware=0.25;let bi=0,bd=1e9;e.path.forEach((q,i)=>{const dd=dist(e.x,e.y,q.x,q.y);if(dd<bd){bd=dd;bi=i;}});e.pi=bi;}
      }else{
        const q=e.path[e.pi];
        if(e.path.length===1){
          if(dist(e.x,e.y,q.x,q.y)>14)moveEnemy(e,q.x,q.y,e.speed,dt,true);
          else{e.moving=false;e.ang=turnTo(e.ang,e.baseAng+Math.sin(G.time*0.45+e.scan)*1.0,dt*1.2);}
        }else if(dist(e.x,e.y,q.x,q.y)<12){
          e.moving=false;e.wait-=dt;e.ang=turnTo(e.ang,e.scanA,dt*1.5);
          if(e.wait<=0){if(e.pingpong){if(e.pi+e.dir<0||e.pi+e.dir>=e.path.length)e.dir=-e.dir;e.pi+=e.dir;}else e.pi=(e.pi+1)%e.path.length;
            e.wait=rnd()<0.35?1+rnd()*2.5:0;e.scanA=e.ang+rr(-1.4,1.4);}
        }else moveEnemy(e,q.x,q.y,e.speed,dt,true);
      }
      if(e.burst>0){e.burstT-=dt;if(e.burstT<=0){e.burst--;e.burstT=0.12;enemyFire(e);}}
      if(ground&&e.state!=='alert'){e.bodyT-=dt;if(e.bodyT<=0){e.bodyT=0.5;
        for(const o of w.enemies){if(o.state!=='dead'||o.found)continue;const dd=dist(e.x,e.y,o.x,o.y);if(dd>240)continue;
          if(Math.abs(angDiff(e.ang,Math.atan2(o.y-e.y,o.x-e.x)))>e.fov/2)continue;if(losFactor(w,e.x,e.y,o.x,o.y)<0.3)continue;
          o.found=true;e.state='search';e.lastX=e.tx=o.x;e.lastY=e.ty=o.y;e.searchT=12;e.wait=0;e.aware=Math.max(e.aware,0.7);break;}}}
    }
    const es=w.enemies;
    for(let i=0;i<es.length;i++){const a=es[i];if(a.state==='dead')continue;
      for(let j=i+1;j<es.length;j++){const b=es[j];if(b.state==='dead')continue;const dx=b.x-a.x,dy=b.y-a.y,d2=dx*dx+dy*dy;
        if(d2<324&&d2>0.01){const d=Math.sqrt(d2),push=(18-d)/2;a.x-=dx/d*push;a.y-=dy/d*push;b.x+=dx/d*push;b.y+=dy/d*push;}}}
    G.anyAlert=anyAlert;
  }
  function updateBunkers(dt){
    const w=G.world,p=G.player,ground=G.state==='ground'&&p&&p.hp>0&&!p.boarded;
    for(const b of w.bunkers){
      if(b.dead)continue;
      b.flash=Math.max(0,b.flash-dt);b.fireCd-=dt;
      let sees=false,a=0,d=1e9;
      if(ground){d=dist(b.x,b.y,p.x,p.y);
        if(d<(b.aware>=1?470:360*G.pVis)){a=Math.atan2(p.y-b.y,p.x-b.x);
          if(Math.abs(angDiff(b.face,a))<1.35&&losFactor(w,b.x+Math.cos(a)*30,b.y+Math.sin(a)*30,p.x,p.y)>0.25)sees=true;}}
      if(sees){if(b.aware<1){b.aware+=dt*(0.8+1.5*(1-d/360))*G.diff.aware;if(b.aware>=1){b.aware=1;b.reactT=0.6*G.diff.react;if(G.time-G.lastAlertSfx>3){audio.alert();G.lastAlertSfx=G.time;}}}b.lostT=0;}
      else{b.lostT+=dt;if(b.aware>=1&&b.lostT>4)b.aware=0.6;if(b.aware<1)b.aware=Math.max(0,b.aware-dt*0.1);}
      const target=sees&&b.aware>=1?a:b.face+Math.sin(G.time*0.4+b.x)*0.9;
      b.aim=turnTo(b.aim,b.face+clamp(angDiff(b.face,target),-1.35,1.35),dt*(b.aware>=1?1.8:0.6));
      if(b.aware>=1){G.anyAlert=true;b.reactT-=dt;}
      if(sees&&b.aware>=1&&b.reactT<=0&&b.fireCd<=0&&b.burst===0&&Math.abs(angDiff(b.aim,a))<0.15){b.burst=5;b.burstT=0;b.fireCd=1.6*G.diff.react+0.5;}
      if(b.burst>0){b.burstT-=dt;if(b.burstT<=0){b.burst--;b.burstT=0.09;
        const pl=G.player,spread=0.07/G.diff.acc+(pl.stance==='prone'?0.04:0),an=b.aim+(rnd()-0.5)*2*spread,mx=b.x+Math.cos(b.aim)*32,my=b.y+Math.sin(b.aim)*32;
        G.bullets.push({x:mx,y:my,vx:Math.cos(an)*950,vy:Math.sin(an)*950,life:0.7,owner:'e',dmg:G.diff.dmg*1.1});
        b.flash=0.05;addFlash(mx,my,130,0.06,'255,200,120');audio.shot(volAt(b.x,b.y)*0.9,0.7);}}
    }
  }
  function destroyBunker(b){
    if(b.dead)return;b.dead=true;b.ob.los=false;G.stats.bunkers++;
    G.emitters.push({x:b.x,y:b.y,t:30,type:'smoke',acc:0,rate:0.25});
    G.pending.push({t:0.15,x:b.x,y:b.y,r:60,dmg:40,o:{src:'bunker'}});
    toast('Bunker destroyed');
  }
  function destroyTarget(t){
    if(t.done)return;t.done=true;t.hp=0;if(t.ob)t.ob.los=false;
    if(t.type==='fuel'){G.pending.push({t:0.25,x:t.x,y:t.y,r:165,dmg:220,o:{src:'tank',big:true}});G.emitters.push({x:t.x,y:t.y,t:50,type:'fire',acc:0,rate:0.05});}
    else{G.pending.push({t:0.2,x:t.x,y:t.y,r:90,dmg:80,o:{src:'radar'}});G.emitters.push({x:t.x,y:t.y,t:35,type:'smoke',acc:0,rate:0.18});}
    const left=G.world.targets.filter(q=>!q.done).length;
    toast(left?`Target destroyed, ${left} remaining`:'Target destroyed');
    checkObjectives();
  }

  /* =====================================================================
     update: projectiles, explosions, fx
     ===================================================================== */
  function explode(x,y,r,dmg,o={}){
    const w=G.world,v=volAt(x,y);
    audio.boom(Math.max(0.12,v),o.big?1.5:1);
    const dc=dist(x,y,G.cam.x,G.cam.y);G.cam.shake=Math.max(G.cam.shake,(o.big?22:14)*clamp(1-dc/1000,0,1));
    const rk=clamp(1-dc/800,0,1);if(rk>0.05)rumble(o.big?380:240,rk,rk*0.7);
    addFlash(x,y,r*3.4,0.55,'255,170,90');
    const k=r/100;
    if(o.water){splash(x,y,24);puff(x,y,10,'white',120,30,1.6,0.5);}
    else for(let i=0;i<22;i++){const a=rnd()*TAU,s=rr(40,220)*k;addP({type:'fire',x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:rr(0.25,0.6),max:0.6,size:rr(18,34)*k,grow:30,drag:4});}
    for(let i=0;i<16;i++){const a=rnd()*TAU,s=rr(20,90)*k;addP({type:'smoke',c:'dark',x:x+rr(-10,10),y:y+rr(-10,10),vx:Math.cos(a)*s+w.wind*0.5,vy:Math.sin(a)*s,life:rr(1.8,3.6),max:3.6,size:rr(22,40)*k,grow:rr(18,32),drag:1.2,a:0.55});}
    for(let i=0;i<14;i++){const a=rnd()*TAU,s=rr(80,260);addP({type:'debris',x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,z:2,vz:rr(120,320),life:2,max:2,size:rr(1.5,3.5),col:'#2c2620'});}
    for(let i=0;i<18;i++){const a=rnd()*TAU,s=rr(200,520);addP({type:'spark',x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:rr(0.2,0.5),max:0.5,drag:3});}
    addP({type:'ring',x,y,life:0.35,max:0.35,size:r*1.3});
    if(!o.water)addScorch(w,x,y,r*0.6);
    const fall=(d,R)=>clamp(1-d/R*0.75,0,1);
    for(const e of w.enemies){if(e.state==='dead')continue;const d=dist(x,y,e.x,e.y);if(d<r){e.hp-=dmg*fall(d,r);e.hit=0.2;if(e.hp<=0)killEnemy(e);}}
    const p=G.player;if(p&&p.hp>0&&!p.boarded&&G.state==='ground'){const d=dist(x,y,p.x,p.y);if(d<r)damagePlayer(dmg*fall(d,r)*(p.stance==='prone'?0.6:0.85));}
    for(const b of w.bunkers){if(b.dead)continue;const d=dist(x,y,b.x,b.y);if(d<r+24){b.hp-=dmg*fall(Math.max(0,d-24),r)*(o.src==='grenade'?0.6:1);if(b.hp<=0)destroyBunker(b);else b.aware=Math.max(b.aware,0.8);}}
    const tm=o.src==='grenade'?0.35:1;
    for(const t of w.targets){if(t.done||t.type==='intel')continue;const d=dist(x,y,t.x,t.y);if(d<r+34){t.hp-=dmg*fall(Math.max(0,d-30),r)*tm;t.hitT=0.2;if(t.hp<=0)destroyTarget(t);}}
    for(const m of w.mines){if(m.dead)continue;if(dist(x,y,m.x,m.y)<r*0.7){m.dead=true;G.pending.push({t:rr(0.12,0.35),x:m.x,y:m.y,r:70,dmg:85,o:{src:'mine'}});}}
    noiseAt(x,y,850,1,true);
  }
  function updateBullets(dt){
    const w=G.world,p=G.player,pTarget=G.state==='ground'&&p&&p.hp>0&&!p.boarded;
    for(let i=G.bullets.length-1;i>=0;i--){
      const b=G.bullets[i];let dead=false;const steps=3,sx=b.vx*dt/steps,sy=b.vy*dt/steps;
      for(let s=0;s<steps&&!dead;s++){
        const ox=b.x,oy=b.y;b.x+=sx;b.y+=sy;
        const ob=bulletHitOb(w,b.x,b.y);
        if(ob){impactFX(b.x,b.y,ob.kind,Math.atan2(-sy,-sx));dead=true;break;}
        if(b.owner==='p'){for(const e of w.enemies){if(e.state==='dead')continue;if(Math.abs(e.x-b.x)<26&&Math.abs(e.y-b.y)<26&&segPointDist(ox,oy,b.x,b.y,e.x,e.y)<10){hitEnemy(e,b);dead=true;break;}}}
        else if(pTarget){const hr=p.stance==='prone'?7:p.stance==='crouch'?8:9;if(segPointDist(ox,oy,b.x,b.y,p.x,p.y)<hr){damagePlayer(b.dmg);dead=true;}}
      }
      b.life-=dt;
      if(b.life<=0&&!dead){dead=true;if(isWater(w,b.x,b.y))splash(b.x,b.y,3);else puff(b.x,b.y,2,'dust',30,6,0.6,0.4);}
      if(dead){G.bullets[i]=G.bullets[G.bullets.length-1];G.bullets.pop();}
    }
  }
  function updateGrenades(dt){
    const w=G.world;
    for(let i=G.grenades.length-1;i>=0;i--){
      const n=G.grenades[i];n.fuse-=dt;n.spin+=dt*(n.rest?2:12);
      if(!n.rest){n.vz-=900*dt;n.z+=n.vz*dt;
        if(n.z<=0){n.z=0;if(isWater(w,n.x,n.y)){n.rest=true;n.vx=n.vy=0;splash(n.x,n.y,6);}
          else if(n.vz<-120){n.vz=-n.vz*0.28;n.vx*=0.5;n.vy*=0.5;audio.clink(volAt(n.x,n.y));}else{n.vz=0;n.rest=true;}}}
      else{const f=Math.pow(0.05,dt);n.vx*=f;n.vy*=f;}
      const nx=n.x+n.vx*dt,ny=n.y+n.vy*dt;
      if(n.z<30&&hitsObstacle(w,nx,ny,3)){if(hitsObstacle(w,nx,n.y,3))n.vx*=-0.45;if(hitsObstacle(w,n.x,ny,3))n.vy*=-0.45;}
      else{n.x=clamp(nx,5,W-5);n.y=clamp(ny,5,H-5);}
      if(n.fuse<=0){G.grenades.splice(i,1);explode(n.x,n.y,95,140,{src:'grenade',water:isWater(w,n.x,n.y)});}
    }
  }
  function updateCharges(dt){
    for(let i=G.charges.length-1;i>=0;i--){const c=G.charges[i];c.t-=dt;c.beep-=dt;
      if(c.beep<=0){audio.beep(volAt(c.x,c.y));c.beep=c.t>2?0.5:c.t>1?0.25:0.1;}
      if(c.t<=0){G.charges.splice(i,1);explode(c.x,c.y,130,320,{src:'charge',big:true,water:isWater(G.world,c.x,c.y)});}}
  }
  function updatePending(dt){for(let i=G.pending.length-1;i>=0;i--){const q=G.pending[i];q.t-=dt;if(q.t<=0){G.pending.splice(i,1);explode(q.x,q.y,q.r,q.dmg,q.o);}}}
  function updateEmitters(dt){
    const w=G.world;
    for(let i=G.emitters.length-1;i>=0;i--){const e=G.emitters[i];e.t-=dt;if(e.t<=0){G.emitters.splice(i,1);continue;}
      e.acc+=dt;const fade=Math.min(1,e.t/8);
      while(e.acc>e.rate){e.acc-=e.rate;
        if(e.type==='fire'){if(rnd()<fade)addP({type:'fire',x:e.x+rr(-18,18),y:e.y+rr(-18,18),vx:w.wind*0.6+rr(-10,10),vy:rr(-40,-10),life:rr(0.4,0.9),max:0.9,size:rr(14,26),grow:-8,drag:0.5});
          if(rnd()<0.5)addP({type:'smoke',c:'dark',x:e.x+rr(-10,10),y:e.y+rr(-10,10),vx:w.wind+rr(-8,8),vy:rr(-30,-10),life:rr(3,5),max:5,size:rr(18,28),grow:22,drag:0.3,a:0.5*fade});}
        else addP({type:'smoke',c:rnd()<0.5?'dark':'grey',x:e.x+rr(-8,8),y:e.y+rr(-8,8),vx:w.wind+rr(-8,8),vy:rr(-25,-8),life:rr(3,5),max:5,size:rr(12,20),grow:18,drag:0.3,a:0.45*fade});}}
  }
  function updateParticles(dt){
    const ps=G.particles;
    for(let i=ps.length-1;i>=0;i--){const q=ps[i];q.life-=dt;if(q.life<=0){ps[i]=ps[ps.length-1];ps.pop();continue;}
      if(q.drag){const d=Math.exp(-q.drag*dt);q.vx*=d;q.vy*=d;}
      q.x+=q.vx*dt;q.y+=q.vy*dt;if(q.grow)q.size=Math.max(0.5,q.size+q.grow*dt);
      if(q.vz!==undefined){q.vz-=600*dt;q.z+=q.vz*dt;if(q.z<0){q.z=0;q.vz*=-0.3;q.vx*=0.6;q.vy*=0.6;if(Math.abs(q.vz)<20)q.vz=0;}}}
  }
  function updateFlashes(dt){for(let i=G.flashes.length-1;i>=0;i--){const f=G.flashes[i];f.life-=dt;if(f.life<=0){G.flashes[i]=G.flashes[G.flashes.length-1];G.flashes.pop();}}}
  function updatePods(dt){
    const w=G.world;
    for(const pod of w.pods){if(pod.landed)continue;pod.z-=dt/5;pod.x=clamp(pod.x+(w.wind+pod.vx)*dt,30,W-30);pod.y=clamp(pod.y+pod.vy*dt,30,H-30);pod.vy*=Math.pow(0.4,dt);
      if(pod.z<=0){pod.z=0;pod.landed=true;const f=findFree(w,pod.x,pod.y,14);pod.x=f.x;pod.y=f.y;puff(pod.x,pod.y,6,'dust',60,14,1,0.4);}}
  }
  function updatePlaneLeaving(dt){
    const pl=G.plane;if(!pl||!pl.leaving)return;pl.t+=dt;
    pl.heading=turnTo(pl.heading,-Math.PI*0.95,dt*0.35);pl.x+=Math.cos(pl.heading)*pl.speed*dt;pl.y+=Math.sin(pl.heading)*pl.speed*dt;pl.prop+=dt*40;pl.bank=lerp(pl.bank,-0.6,dt);
    audio.setLoop('plane',0.35*clamp(1-pl.t/7,0,1));
    if(pl.t>12)G.plane=null;
  }
  function updateHeli(dt){
    const w=G.world;
    if(G.objDone&&!G.heli){G.heliT-=dt;if(G.heliT<=0){G.heli={x:w.lz.x+260,y:-300,z:1,ang:Math.PI/2,state:'inbound',rot:0};toast('Extraction helicopter inbound');G.emitters.push({x:w.lz.x+w.lz.r*0.7,y:w.lz.y,t:600,type:'flare',acc:0,rate:0.12});}}
    for(const e of G.emitters)if(e.type==='flare'&&rnd()<0.6)addP({type:'smoke',c:'green',x:e.x,y:e.y,vx:w.wind+rr(-6,6),vy:rr(-20,-5),life:rr(3,4.5),max:4.5,size:rr(8,14),grow:16,drag:0.2,a:0.28});
    const h=G.heli;if(!h)return;
    h.rot+=dt*28;
    if(h.state==='inbound'){const tx=w.lz.x,ty=w.lz.y,d=dist(h.x,h.y,tx,ty),sp=Math.min(240,d*1.2+20),a=Math.atan2(ty-h.y,tx-h.x);
      h.ang=turnTo(h.ang,a,dt*1.5);h.x+=Math.cos(a)*sp*dt;h.y+=Math.sin(a)*sp*dt;h.z=clamp(d/400,0,1);
      if(d<4){h.state='landed';h.z=0;toast('Helicopter on the ground. Board now!',3);}}
    else if(h.state==='landed'){const p=G.player;if(G.state==='ground'&&p.hp>0&&dist(p.x,p.y,h.x,h.y)<62){p.boarded=true;h.state='leaving';G.state='extract';G.endT=3.4;playing(false);toast('Ranger aboard. Dust off!');}}
    else{h.z=Math.min(1.4,h.z+dt*0.35);h.ang=turnTo(h.ang,-Math.PI/2,dt*1.2);h.x+=Math.cos(h.ang)*h.z*220*dt;h.y+=Math.sin(h.ang)*h.z*220*dt;}
    if(h.z<0.5&&rnd()<dt*30){const a=rnd()*TAU;addP({type:'smoke',c:'dust',x:h.x+Math.cos(a)*30,y:h.y+Math.sin(a)*30,vx:Math.cos(a)*rr(120,220),vy:Math.sin(a)*rr(120,220),life:1.2,max:1.2,size:14,grow:30,drag:2,a:0.35});}
    audio.setLoop('rotor',0.5*volAt(h.x,h.y)+0.04);
  }
  function updateFlight(dt){
    const pl=G.plane,w=G.world;
    const steer=input.axis('left','right');
    pl.vx=lerp(pl.vx,steer*150,1-Math.exp(-dt*2));pl.x=clamp(pl.x+pl.vx*dt,150,W-150);pl.y-=pl.speed*dt;pl.bank=pl.vx/150;pl.prop+=dt*40;
    if(pr('pod')&&pl.pods>0){pl.pods--;w.pods.push({x:pl.x,y:pl.y+30,z:1,vx:rr(-10,10),vy:-110,landed:false,collected:false});audio.tone(300,0.12,'triangle',0.12);toast(`Supply pod away, ${pl.pods} left`);}
    if(pl.y<G.aaY+650&&!pl.warned){pl.warned=true;toast('Flak ahead. Jump before the red line!',3);}
    if(pl.y<G.aaY+750){G.flakT-=dt;if(G.flakT<=0){G.flakT=rr(0.25,0.7);const a=rnd()*TAU,d=rr(120,320);flak(pl.x+Math.cos(a)*d,pl.y+Math.sin(a)*d-100);}}
    if(pr('jump')||pl.y<=G.aaY)jump();
  }
  function updatePara(dt){
    const p=G.player,w=G.world;p.z-=dt/5.5;
    const mx=input.axis('left','right'),my=input.axis('up','down');
    p.x=clamp(p.x+(mx*85+w.wind)*dt,40,W-40);p.y=clamp(p.y+(my*85-15)*dt,40,H-40);
    if(mx||my)p.ang=turnTo(p.ang,Math.atan2(my,mx),dt*2);
    if(p.z<=0){p.z=0;G.state='ground';p.stance='crouch';p.stanceT=0.5;const f=findFree(w,p.x,p.y,10);p.x=f.x;p.y=f.y;resolve(w,p,9);
      audio.setLoop('wind',0);puff(p.x,p.y,8,'dust',70,14,1,0.4);toast(`Boots on the ground. ${glyphHTML('map')} shows the map.`,3.5);playing(true);}
  }
  function updateCamera(dt){
    const c=G.cam;let tx,ty,zf;
    if(G.state==='flight'&&G.plane){tx=G.plane.x;ty=G.plane.y-140;zf=0.45;}
    else if(G.state==='extract'&&G.heli){tx=G.heli.x;ty=G.heli.y;zf=0.85;}
    else if(G.player){const p=G.player;tx=p.x;ty=p.y;
      if(G.state==='para')zf=lerp(1,0.45,clamp(p.z,0,1));
      else{zf=1;if(G.state==='ground'){
        if(padAim()){tx+=Math.cos(p.ang)*380*0.28;ty+=Math.sin(p.ang)*300*0.28;}   // look ahead along the aim
        else{tx+=clamp((mouse.x-CW/2)/c.zoom,-500,500)*0.28;ty+=clamp((mouse.y-CH/2)/c.zoom,-400,400)*0.28;}}}}
    else{tx=c.x;ty=c.y;zf=c.zf;}
    c.zf=lerp(c.zf,zf,1-Math.exp(-dt*3));c.zoom=baseZoom()*c.zf;
    const k=1-Math.exp(-dt*(G.state==='flight'?4:7));c.x=lerp(c.x,tx,k);c.y=lerp(c.y,ty,k);
    clampCam();c.shake=Math.max(0,c.shake-dt*30);
  }
  function clampCam(){const c=G.cam,hw=CW/2/c.zoom,hh=CH/2/c.zoom;c.x=W>2*hw?clamp(c.x,hw,W-hw):W/2;c.y=clamp(c.y,hh,H-hh);}

  /* =====================================================================
     main update
     ===================================================================== */
  function update(dt){
    G.time+=dt;G.frame++;G.dt=dt;
    if(G.toastT>0){G.toastT-=dt;if(G.toastT<=0)$('toast').classList.remove('show');}
    G.hurt=Math.max(0,G.hurt-dt*1.2);
    const s=G.state;
    if(s==='title'||s==='brief'||s==='end'){
      if(s!=='end'){const c=G.cam;c.y-=dt*24;c.x+=Math.sin(G.time*0.05)*dt*20;c.zf=0.85;c.zoom=baseZoom()*c.zf;if(c.y<H*0.08)c.y=H*0.9;clampCam();}
      if(G.world){updateEnemies(dt);updateParticles(dt);updateEmitters(dt);updateFlashes(dt);}
      return;
    }
    if(G.paused)return;
    computeVis();
    if(s==='flight')updateFlight(dt);
    else if(s==='para')updatePara(dt);
    else if(s==='ground')updatePlayer(dt);
    updatePlaneLeaving(dt);updatePods(dt);updateEnemies(dt);updateBunkers(dt);updateBullets(dt);updateGrenades(dt);updateCharges(dt);
    updatePending(dt);updateEmitters(dt);updateParticles(dt);updateFlashes(dt);updateHeli(dt);
    for(const t of G.world.targets){t.hitT=Math.max(0,(t.hitT||0)-dt);if(t.type==='radar'&&!t.done)t.rot+=dt*0.8;}
    if(G.state==='para'||G.state==='ground'){G.timeLeft-=dt;if(G.timeLeft<=0){G.timeLeft=0;finish(false,'timeout');return;}}
    if(G.state==='dead'||G.state==='extract'){G.endT-=dt;if(G.endT<=0){finish(G.state==='extract');return;}}
    updateCamera(dt);updateHUD();
  }

  /* =====================================================================
     rendering: world objects
     ===================================================================== */
  function rectShadow(g,o,sx,sy){g.beginPath();g.moveTo(o.x,o.y);g.lineTo(o.x+o.w,o.y);g.lineTo(o.x+o.w+sx,o.y+sy);g.lineTo(o.x+o.w+sx,o.y+o.h+sy);g.lineTo(o.x+sx,o.y+o.h+sy);g.lineTo(o.x,o.y+o.h);g.closePath();g.fill();}
  function drawRect(g,o){
    const x=o.x,y=o.y,w2=o.w,h2=o.h,c=o.col,hz=w2>=h2;
    if(o.kind==='building'){
      g.fillStyle=rgb(shade(c,0.5));g.fillRect(x,y,w2,h2);
      if(hz){g.fillStyle=rgb(shade(c,1.12));g.fillRect(x+2,y+2,w2-4,h2/2-2);g.fillStyle=rgb(shade(c,0.78));g.fillRect(x+2,y+h2/2,w2-4,h2/2-2);}
      else{g.fillStyle=rgb(shade(c,1.12));g.fillRect(x+2,y+2,w2/2-2,h2-4);g.fillStyle=rgb(shade(c,0.78));g.fillRect(x+w2/2,y+2,w2/2-2,h2-4);}
      g.strokeStyle='rgba(0,0,0,0.13)';g.lineWidth=1;g.beginPath();
      if(hz)for(let i=x+5;i<x+w2-2;i+=5){g.moveTo(i,y+2);g.lineTo(i,y+h2-2);}else for(let i=y+5;i<y+h2-2;i+=5){g.moveTo(x+2,i);g.lineTo(x+w2-2,i);}
      g.stroke();
      g.strokeStyle=rgb(shade(c,1.35));g.lineWidth=2;g.beginPath();if(hz){g.moveTo(x+2,y+h2/2);g.lineTo(x+w2-2,y+h2/2);}else{g.moveTo(x+w2/2,y+2);g.lineTo(x+w2/2,y+h2-2);}g.stroke();
      g.fillStyle='rgba(90,40,20,0.2)';g.beginPath();g.arc(x+w2*0.3,y+h2*0.3,6,0,TAU);g.arc(x+w2*0.72,y+h2*0.7,8,0,TAU);g.fill();
    }else if(o.kind==='hq'||o.kind==='tent'){
      g.fillStyle=rgb(shade(c,0.6));g.beginPath();g.roundRect(x,y,w2,h2,4);g.fill();
      const gr=hz?g.createLinearGradient(0,y,0,y+h2):g.createLinearGradient(x,0,x+w2,0);
      gr.addColorStop(0,rgb(shade(c,1.22)));gr.addColorStop(0.49,rgb(shade(c,0.96)));gr.addColorStop(0.51,rgb(shade(c,0.68)));gr.addColorStop(1,rgb(shade(c,0.86)));
      g.fillStyle=gr;g.beginPath();g.roundRect(x+1.5,y+1.5,w2-3,h2-3,3);g.fill();
      if(o.kind==='hq'){const r2=mulberry32(o.x|0);for(let i=0;i<16;i++){g.fillStyle=i%2?'rgba(40,50,30,0.35)':'rgba(130,120,80,0.25)';g.beginPath();g.ellipse(x+6+r2()*(w2-12),y+6+r2()*(h2-12),5+r2()*9,3+r2()*6,r2()*3,0,TAU);g.fill();}}
      g.strokeStyle='rgba(30,30,20,0.45)';g.lineWidth=1;g.beginPath();
      g.moveTo(x,y);g.lineTo(x-6,y-6);g.moveTo(x+w2,y);g.lineTo(x+w2+6,y-6);g.moveTo(x,y+h2);g.lineTo(x-6,y+h2+6);g.moveTo(x+w2,y+h2);g.lineTo(x+w2+6,y+h2+6);g.stroke();
    }else if(o.kind==='sandbag'){
      const len=hz?w2:h2,th=hz?h2:w2,n=Math.max(1,Math.round(len/12)),bl=len/n;
      for(let row=0;row<2;row++){const cnt=row?n-1:n;
        for(let i=0;i<cnt;i++){const p0=i*bl+(row?bl/2:0),bx=hz?x+p0:x+row*th/2,byy=hz?y+row*th/2:y+p0,bw=hz?bl-1:th/2-0.5,bh=hz?th/2-0.5:bl-1;
          g.fillStyle=rgb(shade(c,row?0.84:1.06));g.beginPath();g.roundRect(bx,byy,bw,bh,3);g.fill();g.strokeStyle='rgba(0,0,0,0.25)';g.lineWidth=0.8;g.stroke();}}
    }else if(o.kind==='crate'){
      g.fillStyle=rgb(shade(c,0.7));g.fillRect(x,y,w2,h2);g.fillStyle=rgb(c);g.fillRect(x+2,y+2,w2-4,h2-4);
      g.strokeStyle=rgb(shade(c,0.55));g.lineWidth=2;g.beginPath();g.moveTo(x+2,y+2);g.lineTo(x+w2-2,y+h2-2);g.moveTo(x+w2-2,y+2);g.lineTo(x+2,y+h2-2);g.stroke();
      g.strokeStyle='rgba(255,255,255,0.15)';g.lineWidth=1;g.strokeRect(x+2.5,y+2.5,w2-5,h2-5);
    }
  }
  function drawBunker(g,b){
    g.save();g.translate(b.x,b.y);
    if(b.dead){const R=mulberry32(b.x|0);for(let i=0;i<9;i++){g.fillStyle=i%2?'#3b3a34':'#57554b';g.beginPath();g.ellipse((R()-0.5)*40,(R()-0.5)*36,6+R()*9,4+R()*7,R()*3,0,TAU);g.fill();}g.restore();return;}
    const gr=g.createRadialGradient(-8,-8,4,0,0,32);gr.addColorStop(0,'#a8a593');gr.addColorStop(1,'#5b594e');
    g.fillStyle=gr;g.beginPath();g.roundRect(-25,-23,50,46,13);g.fill();g.strokeStyle='rgba(0,0,0,0.35)';g.lineWidth=2;g.stroke();
    g.fillStyle='rgba(60,70,40,0.45)';const R=mulberry32(b.y|0);for(let i=0;i<10;i++){g.beginPath();g.arc((R()-0.5)*38,(R()-0.5)*34,2+R()*4,0,TAU);g.fill();}
    g.rotate(b.face);g.fillStyle='#121210';g.fillRect(15,-13,9,26);
    g.rotate(b.aim-b.face);g.strokeStyle='#20201b';g.lineWidth=3.5;g.lineCap='round';g.beginPath();g.moveTo(10,0);g.lineTo(34,0);g.stroke();
    if(b.flash>0){g.globalCompositeOperation='lighter';g.drawImage(SOFT.hot,28,-9,18,18);g.globalCompositeOperation='source-over';}
    g.restore();
  }
  function drawTarget(g,t){
    const hit=t.hitT>0;
    if(t.type==='radar'){
      g.save();g.translate(t.x,t.y);
      g.fillStyle='#77756b';g.beginPath();g.roundRect(-38,-38,76,76,6);g.fill();g.strokeStyle='rgba(0,0,0,0.3)';g.lineWidth=2;g.stroke();
      g.strokeStyle='rgba(230,190,60,0.55)';g.lineWidth=3;g.setLineDash([6,6]);g.strokeRect(-34,-34,68,68);g.setLineDash([]);
      if(t.done){g.strokeStyle='#2a2925';g.lineWidth=3;g.beginPath();for(let i=0;i<6;i++){const a=i*1.1;g.moveTo(0,0);g.lineTo(Math.cos(a)*24,Math.sin(a)*20);}g.stroke();g.restore();return;}
      g.rotate(t.rot);
      const gr=g.createLinearGradient(-14,0,14,0);gr.addColorStop(0,'#f2f0ea');gr.addColorStop(1,'#8d8b84');
      g.fillStyle=gr;g.beginPath();g.ellipse(0,0,14,33,0,0,TAU);g.fill();g.strokeStyle='#5b5a55';g.lineWidth=2;g.stroke();
      g.strokeStyle='rgba(0,0,0,0.15)';g.lineWidth=1;g.beginPath();for(let k=-2;k<=2;k++){g.moveTo(-12,k*11);g.quadraticCurveTo(0,k*11+4,12,k*11);}g.stroke();
      g.strokeStyle='#3d3c38';g.lineWidth=2;g.beginPath();g.moveTo(0,0);g.lineTo(28,0);g.stroke();g.fillStyle='#2b2a27';g.beginPath();g.arc(28,0,3.5,0,TAU);g.fill();
      g.restore();
      if(Math.sin(G.time*5)>0.3){g.globalCompositeOperation='lighter';g.drawImage(SOFT.red,t.x+28,t.y-38,14,14);g.fillStyle='#ff4a3a';g.beginPath();g.arc(t.x+35,t.y-31,2,0,TAU);g.fill();g.globalCompositeOperation='source-over';}
    }else if(t.type==='fuel'){
      g.save();g.translate(t.x,t.y);const r=30;
      if(t.done){g.fillStyle='#1d1a17';g.beginPath();g.arc(0,0,r,0,TAU);g.fill();g.strokeStyle='#3a332b';g.lineWidth=4;g.beginPath();g.arc(0,0,r-3,0.3,4.5);g.stroke();g.restore();return;}
      const gr=g.createRadialGradient(-10,-10,4,0,0,r);gr.addColorStop(0,'#f3f1e8');gr.addColorStop(0.7,'#bab7ab');gr.addColorStop(1,'#77756c');
      g.fillStyle=gr;g.beginPath();g.arc(0,0,r,0,TAU);g.fill();g.strokeStyle='#55534c';g.lineWidth=2;g.stroke();
      g.strokeStyle='rgba(0,0,0,0.15)';g.lineWidth=1;g.beginPath();g.arc(0,0,r*0.72,0,TAU);g.stroke();g.beginPath();g.arc(0,0,r*0.35,0,TAU);g.stroke();
      g.strokeStyle='#b8322a';g.lineWidth=3;g.beginPath();g.arc(0,0,r-4,2.2,3.8);g.stroke();
      g.fillStyle='#a42c25';g.font='bold 9px ui-sans-serif,system-ui,sans-serif';g.textAlign='center';g.fillText('FUEL',0,3);
      g.restore();
    }else if(t.type==='intel'&&!t.done){
      const pu=0.5+0.5*Math.sin(G.time*4);
      g.fillStyle=`rgba(255,210,80,${0.18+pu*0.22})`;g.beginPath();g.arc(t.x,t.y,12+pu*5,0,TAU);g.fill();
      g.fillStyle='#3b2a18';g.fillRect(t.x-8,t.y-6,16,12);g.fillStyle='#f2c14e';g.fillRect(t.x-6,t.y-4,12,8);g.fillStyle='#3b2a18';g.fillRect(t.x-2,t.y-8,4,3);
    }
    if(hit&&!t.done){g.fillStyle=`rgba(255,255,255,${t.hitT*2})`;g.beginPath();g.arc(t.x,t.y,34,0,TAU);g.fill();}
  }
  function drawSoldier(g,x,y,ang,stance,moving,walk,pal,flash,hit){
    g.save();g.translate(x,y);
    g.fillStyle='rgba(0,0,0,0.28)';g.beginPath();
    if(stance==='prone')g.ellipse(2-Math.cos(ang)*8,3-Math.sin(ang)*8,17,9,ang,0,TAU);else g.ellipse(2.5,3.5,10,9,0,0,TAU);g.fill();
    g.rotate(ang);g.lineCap='round';
    const wk=moving?Math.sin(walk):0;
    if(stance==='prone'){
      g.strokeStyle=pal.dark;g.lineWidth=4.5;g.beginPath();g.moveTo(-10,-3);g.lineTo(-25,-5+wk*2);g.moveTo(-10,3);g.lineTo(-25,5-wk*2);g.stroke();
      g.fillStyle=pal.boots;g.beginPath();g.arc(-26,-5+wk*2,2.6,0,TAU);g.arc(-26,5-wk*2,2.6,0,TAU);g.fill();
      g.fillStyle=pal.body;g.beginPath();g.ellipse(-3,0,10,7,0,0,TAU);g.fill();
      g.fillStyle=pal.pack;g.beginPath();g.roundRect(-11,-5,9,10,3);g.fill();
      g.strokeStyle=pal.body;g.lineWidth=3.2;g.beginPath();g.moveTo(3,-6);g.lineTo(12,-2);g.moveTo(3,6);g.lineTo(10,2);g.stroke();
      g.strokeStyle=pal.gun;g.lineWidth=2.6;g.beginPath();g.moveTo(6,1);g.lineTo(24,1);g.stroke();
    }else{
      const cr=stance==='crouch';
      if(moving){g.fillStyle=pal.boots;g.beginPath();g.ellipse(wk*6,-4.5,3.6,2.5,0,0,TAU);g.fill();g.beginPath();g.ellipse(-wk*6,4.5,3.6,2.5,0,0,TAU);g.fill();}
      else if(cr){g.fillStyle=pal.boots;g.beginPath();g.ellipse(5,-5,3.4,2.4,0,0,TAU);g.fill();g.beginPath();g.ellipse(-4,5,3.4,2.4,0,0,TAU);g.fill();}
      g.fillStyle=pal.pack;g.beginPath();g.roundRect(-10,-6.5,7,13,2.5);g.fill();
      g.fillStyle=pal.body;g.beginPath();g.ellipse(0,0,cr?7.5:6.5,cr?9.5:10,0,0,TAU);g.fill();
      if(pal.band){g.strokeStyle=pal.band;g.lineWidth=2.2;g.beginPath();g.arc(0,0,7.5,-2.0,-1.3);g.stroke();}
      g.strokeStyle=pal.body;g.lineWidth=3.4;g.beginPath();g.moveTo(1,-8);g.lineTo(12,-1.5);g.moveTo(1,8);g.lineTo(7,2.5);g.stroke();
      g.strokeStyle=pal.gun;g.lineWidth=2.6;g.beginPath();g.moveTo(3,1.5);g.lineTo(23,1);g.stroke();
    }
    if(flash>0){g.globalCompositeOperation='lighter';g.fillStyle='rgba(255,220,140,0.95)';g.beginPath();g.moveTo(24,1);g.lineTo(37,-3.5);g.lineTo(31,1);g.lineTo(37,5.5);g.closePath();g.fill();g.drawImage(SOFT.hot,18,-8,18,18);g.globalCompositeOperation='source-over';}
    g.restore();
    const off=stance==='prone'?7:0.5,hx=x+Math.cos(ang)*off,hy=y+Math.sin(ang)*off,hr=stance==='prone'?5:5.6;
    const gr=g.createRadialGradient(hx-1.8,hy-1.8,0.4,hx,hy,hr);gr.addColorStop(0,pal.helmHi);gr.addColorStop(1,pal.helm);
    g.fillStyle=gr;g.beginPath();g.arc(hx,hy,hr,0,TAU);g.fill();
    if(hit>0){g.fillStyle=`rgba(255,255,255,${Math.min(0.8,hit*4)})`;g.beginPath();g.arc(x,y,10,0,TAU);g.fill();}
  }
  function drawHeli(g,h){
    const z=h.z,sc=1+z*0.5;
    g.save();g.translate(h.x+z*90,h.y+z*120);g.rotate(h.ang);g.globalAlpha=0.3*(1-z*0.4);g.fillStyle='#000';
    g.beginPath();g.ellipse(0,0,32,14,0,0,TAU);g.fill();g.fillRect(-72,-3,48,6);g.beginPath();g.arc(0,0,54,0,TAU);g.globalAlpha=0.08*(1-z*0.4);g.fill();g.restore();g.globalAlpha=1;
    g.save();g.translate(h.x,h.y);g.scale(sc,sc);g.rotate(h.ang);
    g.strokeStyle='#22241c';g.lineWidth=2.5;g.beginPath();g.moveTo(-18,-17);g.lineTo(22,-17);g.moveTo(-18,17);g.lineTo(22,17);g.stroke();
    g.fillStyle='#3e4630';g.fillRect(-74,-3.5,52,7);g.fillStyle='#4a5338';g.beginPath();g.roundRect(-80,-10,12,20,3);g.fill();
    g.globalAlpha=0.3;g.fillStyle='#ccc';g.beginPath();g.ellipse(-74,12,9,2.5,0,0,TAU);g.fill();g.globalAlpha=1;
    const gr=g.createLinearGradient(0,-14,0,14);gr.addColorStop(0,'#6b7752');gr.addColorStop(1,'#3a4229');
    g.fillStyle=gr;g.beginPath();g.ellipse(0,0,34,14,0,0,TAU);g.fill();g.strokeStyle='rgba(0,0,0,0.35)';g.lineWidth=1.5;g.stroke();
    const gl=g.createLinearGradient(16,-9,34,9);gl.addColorStop(0,'#bfe3f2');gl.addColorStop(1,'#3d6a80');g.fillStyle=gl;g.beginPath();g.ellipse(22,0,11,10,0,-1.3,1.3);g.fill();
    g.fillStyle='rgba(0,0,0,0.25)';g.fillRect(-8,-6,16,12);
    g.fillStyle='rgba(20,20,20,0.16)';g.beginPath();g.arc(0,0,56,0,TAU);g.fill();
    g.strokeStyle='rgba(20,20,18,0.85)';g.lineWidth=3.5;g.beginPath();for(let i=0;i<2;i++){const a=h.rot+i*Math.PI/2;g.moveTo(-Math.cos(a)*56,-Math.sin(a)*56);g.lineTo(Math.cos(a)*56,Math.sin(a)*56);}g.stroke();
    g.strokeStyle='rgba(20,20,18,0.25)';g.lineWidth=10;g.beginPath();g.arc(0,0,48,h.rot,h.rot+0.6);g.stroke();g.beginPath();g.arc(0,0,48,h.rot+Math.PI,h.rot+Math.PI+0.6);g.stroke();
    g.fillStyle='#1c1d18';g.beginPath();g.arc(0,0,4,0,TAU);g.fill();
    if(Math.sin(G.time*6)>0.5){g.globalCompositeOperation='lighter';g.drawImage(SOFT.red,-86,-8,16,16);g.globalCompositeOperation='source-over';}
    g.restore();
  }
  function drawPlane(g,pl){
    const sc=1.6;
    g.save();g.translate(pl.x+140,pl.y+190);g.rotate(pl.heading+Math.PI/2);g.scale(sc*0.8,sc*0.8);g.fillStyle='rgba(0,0,0,0.22)';
    g.beginPath();g.ellipse(0,0,12,66,0,0,TAU);g.fill();g.beginPath();g.roundRect(-92,-14,184,22,8);g.fill();g.beginPath();g.roundRect(-32,48,64,12,4);g.fill();g.restore();
    g.save();g.translate(pl.x,pl.y);g.rotate(pl.heading+Math.PI/2);g.scale(sc*(1-Math.abs(pl.bank)*0.12),sc);
    const wg=g.createLinearGradient(-92,0,92,0);wg.addColorStop(0,'#46503a');wg.addColorStop(0.5,'#6c7856');wg.addColorStop(1,'#3e4734');
    g.fillStyle=wg;g.beginPath();g.moveTo(-94,-6);g.lineTo(94,-6);g.lineTo(88,10);g.lineTo(-88,10);g.closePath();g.fill();
    g.beginPath();g.moveTo(-34,50);g.lineTo(34,50);g.lineTo(30,60);g.lineTo(-30,60);g.closePath();g.fill();
    const fg=g.createLinearGradient(-12,0,12,0);fg.addColorStop(0,'#46503a');fg.addColorStop(0.45,'#7c8964');fg.addColorStop(1,'#3a4230');
    g.fillStyle=fg;g.beginPath();g.ellipse(0,0,12,68,0,0,TAU);g.fill();
    g.fillStyle='#2c3324';g.fillRect(-2,44,4,20);
    for(const ex of[-44,44]){g.fillStyle='#3a4230';g.beginPath();g.roundRect(ex-6,-22,12,34,4);g.fill();
      g.fillStyle='rgba(30,30,30,0.18)';g.beginPath();g.arc(ex,-24,16,0,TAU);g.fill();
      g.strokeStyle='rgba(20,20,20,0.7)';g.lineWidth=2;g.beginPath();const a=pl.prop+ex;g.moveTo(ex-Math.cos(a)*16,-24-Math.sin(a)*16);g.lineTo(ex+Math.cos(a)*16,-24+Math.sin(a)*16);g.stroke();}
    g.fillStyle='rgba(180,220,240,0.7)';g.beginPath();g.ellipse(0,-58,6,6,0,Math.PI,TAU);g.fill();
    g.fillStyle='#f2c14e';g.beginPath();g.arc(-70,0,3,0,TAU);g.arc(70,0,3,0,TAU);g.fill();
    g.restore();
  }
  function drawChute(g,x,y,R,cA,cB,rot){
    g.save();g.translate(x,y);g.rotate(rot);
    for(let i=0;i<8;i++){g.fillStyle=i%2?cA:cB;g.beginPath();g.moveTo(0,0);g.arc(0,0,R,i*TAU/8,(i+1)*TAU/8);g.closePath();g.fill();}
    const gr=g.createRadialGradient(-R*0.35,-R*0.35,0,0,0,R);gr.addColorStop(0,'rgba(255,255,255,0.3)');gr.addColorStop(1,'rgba(0,0,0,0.25)');g.fillStyle=gr;g.beginPath();g.arc(0,0,R,0,TAU);g.fill();
    g.fillStyle='rgba(0,0,0,0.45)';g.beginPath();g.arc(0,0,R*0.12,0,TAU);g.fill();
    g.restore();
  }

  /* =====================================================================
     rendering: frame
     ===================================================================== */
  function collectLights(v){
    const L=[],w=G.world,inV=(x,y,r)=>x+r>v.vx0&&x-r<v.vx1&&y+r>v.vy0&&y-r<v.vy1;
    if(w.T.dark)for(const l of w.lamps)if(inV(l.x,l.y,l.r))L.push({x:l.x,y:l.y,r:l.r,i:0.95,c:'255,196,120',g:0.1});
    for(const f of G.flashes)if(inV(f.x,f.y,f.r)){const k=f.life/f.max;L.push({x:f.x,y:f.y,r:f.r,i:Math.min(1,k*1.2),c:f.c,g:0.5*k});}
    for(const e of G.emitters)if(e.type==='fire'&&inV(e.x,e.y,260)){const k=Math.min(1,e.t/8);L.push({x:e.x,y:e.y,r:(240+Math.sin(G.time*13+e.x)*20)*k,i:0.9*k,c:'255,140,50',g:0.22*k});}
    const p=G.player;if(w.T.dark&&p&&!p.boarded&&G.state!=='flight')L.push({x:p.x,y:p.y,r:155,i:0.55,c:'180,200,255',g:0});
    for(const c of G.charges)if(Math.sin(G.time*(c.t<2?30:12))>0)L.push({x:c.x,y:c.y,r:60,i:0.8,c:'255,40,30',g:0.4});
    if(G.objDone&&inV(w.lz.x,w.lz.y,200))L.push({x:w.lz.x+w.lz.r*0.7,y:w.lz.y,r:170,i:0.75,c:'90,255,120',g:0.12});
    if(G.heli&&w.T.dark)L.push({x:G.heli.x+Math.cos(G.heli.ang)*70,y:G.heli.y+Math.sin(G.heli.ang)*70,r:200,i:0.8,c:'220,235,255',g:0.06});
    return L;
  }
  // the demo paints only a few new terrain chunks per frame (a cold flight view needs ~30 at ~10 ms each);
  // the rest show flat ground until their turn. The standalone page and stills paint all of them at once.
  const budgeted=!dom&&!reducedMotion,warmCtx=budgeted&&mkCanvas(1,1).getContext('2d');let chunkBudget=Infinity;
  function chunkAt(w,cx,cy){
    if(chunkBudget<=0&&!w.chunks.has((cy+100)*1000+(cx+100)))return null;
    if(w.chunks.has((cy+100)*1000+(cx+100)))return getChunk(w,cx,cy,G.frame);
    // a new chunk: pay its first scaled draw now, into a scrap canvas, rather than in the frame where
    // a whole row of them scrolls into view (that frame cost ~90 ms in a software-rendered demo)
    chunkBudget--;const c=getChunk(w,cx,cy,G.frame);if(budgeted){const k=G.cam.zoom*DPR;warmCtx.drawImage(c,0,0,CHUNK*k,CHUNK*k);}return c;
  }
  function render(){
    const w=G.world;
    ctx.setTransform(1,0,0,1,0,0);ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;ctx.fillStyle='#0b0e0a';ctx.fillRect(0,0,cv.width,cv.height);
    if(!w)return;
    const T=w.T,z=G.cam.zoom,sh=G.cam.shake;
    const camX=G.cam.x+(rnd()-0.5)*sh/z,camY=G.cam.y+(rnd()-0.5)*sh/z;
    const v={vx0:camX-CW/2/z,vy0:camY-CH/2/z,vx1:camX+CW/2/z,vy1:camY+CH/2/z,camX,camY,z};G.view=v;
    const g=ctx;g.setTransform(DPR*z,0,0,DPR*z,DPR*(CW/2-camX*z),DPR*(CH/2-camY*z));
    const inV=(x,y,m)=>x>v.vx0-m&&x<v.vx1+m&&y>v.vy0-m&&y<v.vy1+m;
    // ground
    const cx0=Math.floor(v.vx0/CHUNK),cx1=Math.floor(v.vx1/CHUNK),cy0=Math.floor(v.vy0/CHUNK),cy1=Math.floor(v.vy1/CHUNK);
    if(budgeted){chunkBudget=pilot&&pilot.fade>0.3?3:1;g.fillStyle=rgb(mix3(T.grassA,T.grassB,0.4));}
    for(let cy=cy0;cy<=cy1;cy++)for(let cx=cx0;cx<=cx1;cx++){const c=chunkAt(w,cx,cy);if(c)g.drawImage(c,cx*CHUNK,cy*CHUNK,CHUNK+1,CHUNK+1);else g.fillRect(cx*CHUNK,cy*CHUNK,CHUNK+1,CHUNK+1);}
    // demo: spare budget paints the ring just outside the view, before the camera gets there
    if(budgeted)for(let cy=cy0-1;cy<=cy1+1&&chunkBudget>0;cy++)for(let cx=cx0-1;cx<=cx1+1;cx++)if(cy<cy0||cy>cy1||cx<cx0||cx>cx1)chunkAt(w,cx,cy);
    // river shimmer
    if(Math.abs(camY-w.riverBase)<v.vy1-v.vy0){g.strokeStyle='rgba(220,240,255,0.10)';g.lineWidth=1.4;g.beginPath();
      for(let x=Math.floor(v.vx0/22)*22;x<v.vx1;x+=22){const hw=w.riverHW(x),ry=w.riverY(x);for(let k=0;k<2;k++){const ph=G.time*1.3+x*0.07+k*2.1,y=ry+Math.sin(ph)*hw*0.6,xx=x+((G.time*18+k*11)%22);if(isWater(w,xx,y)){g.moveTo(xx,y);g.lineTo(xx+7,y+0.5);}}}
      g.stroke();}
    // LZ
    const lz=w.lz;if(inV(lz.x,lz.y,lz.r+40)){const pu=0.5+0.5*Math.sin(G.time*3);
      g.strokeStyle=G.objDone?`rgba(120,240,140,${0.35+pu*0.35})`:'rgba(255,255,255,0.22)';g.lineWidth=3;g.setLineDash([14,10]);g.beginPath();g.arc(lz.x,lz.y,lz.r,0,TAU);g.stroke();g.setLineDash([]);
      g.fillStyle='rgba(255,120,40,0.85)';for(let i=0;i<4;i++){const a=i*TAU/4+Math.PI/4;g.save();g.translate(lz.x+Math.cos(a)*lz.r*0.75,lz.y+Math.sin(a)*lz.r*0.75);g.rotate(a);g.fillRect(-7,-3,14,6);g.restore();}
      g.font='700 13px ui-monospace,Menlo,monospace';g.textAlign='center';g.fillStyle='rgba(255,255,255,0.4)';g.fillText('LZ',lz.x,lz.y+5);}
    // vision cones
    const p=G.player;
    if(p&&G.state!=='flight'){
      for(const e of w.enemies){if(e.state==='dead'||Math.abs(e.x-p.x)>760||Math.abs(e.y-p.y)>640)continue;
        const R=e.state==='alert'?260:e.view,col=e.state==='alert'?'255,70,50':(e.state==='search'||e.aware>0.3)?'255,200,60':'255,255,255',al=e.state==='alert'?0.1:0.075;
        const gr=g.createRadialGradient(e.x,e.y,8,e.x,e.y,R);gr.addColorStop(0,`rgba(${col},${al})`);gr.addColorStop(1,`rgba(${col},0)`);
        g.fillStyle=gr;g.beginPath();g.moveTo(e.x,e.y);g.arc(e.x,e.y,R,e.ang-e.fov/2,e.ang+e.fov/2);g.closePath();g.fill();}
      for(const b of w.bunkers){if(b.dead||!inV(b.x,b.y,400))continue;const col=b.aware>=1?'255,70,50':'255,255,255',gr=g.createRadialGradient(b.x,b.y,20,b.x,b.y,360);
        gr.addColorStop(0,`rgba(${col},0.09)`);gr.addColorStop(1,`rgba(${col},0)`);g.fillStyle=gr;g.beginPath();g.moveTo(b.x,b.y);g.arc(b.x,b.y,360,b.aim-0.45,b.aim+0.45);g.closePath();g.fill();}
    }
    // shadows
    const sx=T.sh[0],sy=T.sh[1];
    g.fillStyle=`rgba(0,0,0,${T.shA})`;
    for(const o of w.rects)if(inV(o.x+o.w/2,o.y+o.h/2,Math.max(o.w,o.h)))rectShadow(g,o,sx*o.hgt,sy*o.hgt);
    for(const b of w.bunkers)if(inV(b.x,b.y,60)){g.beginPath();g.arc(b.x+sx*12,b.y+sy*12,24,0,TAU);g.fill();}
    for(const t of w.targets)if(t.type!=='intel'&&inV(t.x,t.y,80)){const hh=t.type==='fuel'?24:18;g.beginPath();g.arc(t.x+sx*hh,t.y+sy*hh,t.type==='fuel'?30:28,0,TAU);g.fill();}
    for(const pr of w.props)if(inV(pr.x,pr.y,30)){g.beginPath();g.arc(pr.x+sx*(pr.kind==='lamp'?20:7),pr.y+sy*(pr.kind==='lamp'?20:7),pr.kind==='lamp'?3:7,0,TAU);g.fill();}
    g.globalAlpha=Math.min(0.7,T.shA*1.6);
    for(const t of w.trees){if(!inV(t.x,t.y,t.r+70))continue;const s=t.r*2.7;g.drawImage(SOFT.black,t.x+sx*t.r*0.9-s/2,t.y+sy*t.r*0.9-s/2,s,s);}
    for(const r of w.rocks){if(!inV(r.x,r.y,40))continue;const s=r.r*2.6;g.drawImage(SOFT.black,r.x+sx*r.r*0.5-s/2,r.y+sy*r.r*0.5-s/2,s,s);}
    g.globalAlpha=1;
    // statics
    for(const r of w.rocks)if(inV(r.x,r.y,30)){const s=56*r.r/20;g.drawImage(w.rockSpr[r.v],r.x-s/2,r.y-s/2,s,s);}
    for(const o of w.rects)if(inV(o.x+o.w/2,o.y+o.h/2,Math.max(o.w,o.h)))drawRect(g,o);
    for(const pr of w.props){if(!inV(pr.x,pr.y,30))continue;
      if(pr.kind==='barrel'){const gr=g.createRadialGradient(pr.x-2,pr.y-2,1,pr.x,pr.y,pr.r);gr.addColorStop(0,rgb(shade(pr.col,1.4)));gr.addColorStop(1,rgb(shade(pr.col,0.7)));g.fillStyle=gr;g.beginPath();g.arc(pr.x,pr.y,pr.r,0,TAU);g.fill();g.strokeStyle='rgba(0,0,0,0.35)';g.lineWidth=1;g.beginPath();g.arc(pr.x,pr.y,pr.r*0.6,0,TAU);g.stroke();}
      else{g.fillStyle='#2a2a26';g.beginPath();g.arc(pr.x,pr.y,3,0,TAU);g.fill();g.fillStyle=T.dark?'#ffe2a6':'#d8d2bf';g.beginPath();g.arc(pr.x,pr.y,1.8,0,TAU);g.fill();}}
    for(const b of w.bunkers)if(inV(b.x,b.y,60))drawBunker(g,b);
    for(const t of w.targets)if(inV(t.x,t.y,60))drawTarget(g,t);
    for(const s of w.signs)if(inV(s.x,s.y,20)){g.strokeStyle='#3a2c1c';g.lineWidth=2;g.beginPath();g.moveTo(s.x,s.y);g.lineTo(s.x+3,s.y+4);g.stroke();
      g.fillStyle='#d23a2a';g.beginPath();g.moveTo(s.x,s.y-9);g.lineTo(s.x+7,s.y+3);g.lineTo(s.x-7,s.y+3);g.closePath();g.fill();g.fillStyle='#fff3d0';g.fillRect(s.x-0.8,s.y-5,1.6,4.5);g.fillRect(s.x-0.8,s.y+0.6,1.6,1.4);}
    for(const m of w.mines)if(m.found&&!m.dead&&inV(m.x,m.y,10)){g.fillStyle='#262420';g.beginPath();g.arc(m.x,m.y,5,0,TAU);g.fill();g.strokeStyle='#5a564c';g.lineWidth=1;g.stroke();
      if(Math.sin(G.time*6+m.x)>0){g.fillStyle='#ff4030';g.beginPath();g.arc(m.x,m.y,1.6,0,TAU);g.fill();}}
    // pickups and pods
    for(const k of w.pickups)if(inV(k.x,k.y,20)){const pu=0.5+0.5*Math.sin(G.time*5+k.x);g.fillStyle=`rgba(255,220,120,${0.15+pu*0.2})`;g.beginPath();g.arc(k.x,k.y,9,0,TAU);g.fill();g.fillStyle='#2b2b26';g.fillRect(k.x-3,k.y-5,6,10);g.fillStyle='#c9a24a';g.fillRect(k.x-2,k.y-6,4,2);}
    for(const pod of w.pods){if(!pod.landed||pod.collected||!inV(pod.x,pod.y,40))continue;
      g.fillStyle='rgba(240,236,226,0.85)';g.beginPath();g.ellipse(pod.x+16,pod.y+6,15,8,0.4,0,TAU);g.fill();g.strokeStyle='rgba(0,0,0,0.2)';g.lineWidth=1;g.stroke();
      g.fillStyle='rgba(0,0,0,0.3)';g.beginPath();g.roundRect(pod.x-12,pod.y-5,26,14,5);g.fill();
      g.fillStyle='#55603c';g.beginPath();g.roundRect(pod.x-13,pod.y-7,26,14,5);g.fill();g.fillStyle='#f2c14e';g.fillRect(pod.x-4,pod.y-7,3,14);g.fillRect(pod.x+3,pod.y-7,3,14);
      const pu=(G.time*0.8)%1;g.strokeStyle=`rgba(140,210,255,${0.6*(1-pu)})`;g.lineWidth=2;g.beginPath();g.arc(pod.x,pod.y,14+pu*22,0,TAU);g.stroke();}
    // bodies
    for(const e of w.enemies)if(e.state==='dead'&&inV(e.x,e.y,30)){g.fillStyle='rgba(70,10,8,0.35)';g.beginPath();g.ellipse(e.x-Math.cos(e.ang)*6,e.y-Math.sin(e.ang)*6,14,9,e.ang,0,TAU);g.fill();drawSoldier(g,e.x,e.y,e.ang,'prone',false,0,PAL.dead,0,0);}
    // charges, grenades
    for(const c of G.charges)if(inV(c.x,c.y,20)){g.fillStyle='#3a3a2e';g.beginPath();g.roundRect(c.x-6,c.y-4,12,8,2);g.fill();g.fillStyle='#c9b37a';g.fillRect(c.x-5,c.y-3,10,2);
      if(Math.sin(G.time*(c.t<2?30:12))>0){g.fillStyle='#ff3020';g.beginPath();g.arc(c.x+3,c.y+1.5,1.8,0,TAU);g.fill();}}
    for(const n of G.grenades)if(inV(n.x,n.y,30)){g.fillStyle='rgba(0,0,0,0.3)';g.beginPath();g.ellipse(n.x+n.z*0.3+1,n.y+n.z*0.5+1,3.5,2.5,0,0,TAU);g.fill();
      g.save();g.translate(n.x,n.y-n.z*0.6);g.rotate(n.spin);g.fillStyle='#3d4a2c';g.beginPath();g.ellipse(0,0,4,3,0,0,TAU);g.fill();g.fillStyle='#8a8a7a';g.fillRect(2.5,-1,2.5,2);g.restore();}
    // units
    for(const e of w.enemies)if(e.state!=='dead'&&inV(e.x,e.y,30))drawSoldier(g,e.x,e.y,e.ang,'stand',e.moving,e.walk,PAL.enemy,e.flash,e.hit);
    if(p&&p.z===0&&!p.boarded){if(p.hp<=0)drawSoldier(g,p.x,p.y,p.ang,'prone',false,0,PAL.deadP,0,0);else drawSoldier(g,p.x,p.y,p.ang,p.stance,p.moving,p.walk,PAL.player,p.flash,p.hurtT>0.25?0.1:0);}
    // tracers
    g.globalCompositeOperation='lighter';g.lineCap='round';
    for(const b of G.bullets){if(!inV(b.x,b.y,40))continue;g.strokeStyle=b.owner==='p'?'rgba(255,224,150,0.9)':'rgba(255,140,100,0.9)';g.lineWidth=1.6;g.beginPath();g.moveTo(b.x-b.vx*0.022,b.y-b.vy*0.022);g.lineTo(b.x,b.y);g.stroke();}
    g.globalCompositeOperation='source-over';
    // canopies
    const px=p&&!p.boarded&&p.z===0?p.x:-1e5,py=p?p.y:-1e5;
    for(const t of w.trees){if(t.x+t.r<v.vx0||t.x-t.r>v.vx1||t.y+t.r<v.vy0||t.y-t.r>v.vy1)continue;
      const d=Math.hypot(t.x-px,t.y-py);g.globalAlpha=d<t.r+16?0.35+0.65*clamp((d-t.r*0.3)/(t.r*0.7+16),0,1):1;
      const s=t.r*2.5;g.drawImage(w.treeSpr[t.v],t.x+Math.sin(G.time*0.9+t.x*0.01)*0.8-s/2,t.y-s/2,s,s);}
    g.globalAlpha=1;
    // particles
    for(const q of G.particles){if(!inV(q.x,q.y,80))continue;const k=q.life/q.max;
      if(q.type==='smoke'){g.globalAlpha=(q.a||0.5)*(k>0.9?(1-k)*10:k/0.9);const s=q.size;g.drawImage(SOFT[q.c||'grey'],q.x-s,q.y-s,s*2,s*2);}
      else if(q.type==='debris'){g.globalAlpha=Math.min(1,k*3);g.fillStyle='rgba(0,0,0,0.3)';g.fillRect(q.x+q.z*0.3,q.y+q.z*0.4,q.size,q.size);g.fillStyle=q.col||'#2c2620';g.fillRect(q.x,q.y-q.z*0.6,q.size,q.size);}
      else if(q.type==='shell'){g.globalAlpha=Math.min(1,k*3);g.fillStyle='#d6b25a';g.save();g.translate(q.x,q.y-q.z*0.6);g.rotate(q.rot+q.life*10);g.fillRect(-1.5,-0.8,3,1.6);g.restore();}
      else if(q.type==='blood'){g.globalAlpha=0.55*k;g.drawImage(SOFT.red,q.x-q.size,q.y-q.size,q.size*2,q.size*2);}
      else if(q.type==='splash'){g.globalAlpha=0.6*k;g.strokeStyle='#dff0ff';g.lineWidth=1.2;g.beginPath();g.arc(q.x,q.y,q.size*(1.6-k),0,TAU);g.stroke();}}
    g.globalAlpha=1;g.globalCompositeOperation='lighter';
    for(const q of G.particles){if(!inV(q.x,q.y,80))continue;const k=q.life/q.max;
      if(q.type==='fire'){g.globalAlpha=k;const s=q.size;g.drawImage(SOFT.fire,q.x-s,q.y-s,s*2,s*2);g.drawImage(SOFT.hot,q.x-s*0.4,q.y-s*0.4,s*0.8,s*0.8);}
      else if(q.type==='spark'){g.globalAlpha=k;g.strokeStyle='rgb(255,210,120)';g.lineWidth=1.3;g.beginPath();g.moveTo(q.x,q.y);g.lineTo(q.x-q.vx*0.03,q.y-q.vy*0.03);g.stroke();}
      else if(q.type==='ring'){g.globalAlpha=k*0.5;g.strokeStyle='#fff6e0';g.lineWidth=3*k+1;g.beginPath();g.arc(q.x,q.y,q.size*(1-k)+4,0,TAU);g.stroke();}}
    g.globalAlpha=1;g.globalCompositeOperation='source-over';
    // cloud shadows
    if(!T.dark){g.globalAlpha=0.5;for(const c of G.cloudSh){const x=((c.x+G.time*14)%(W+1600))-800;if(!inV(x,c.y,c.s))continue;g.drawImage(CLOUD_SH,x-c.s,c.y-c.s*0.62,c.s*2,c.s*1.25);}g.globalAlpha=1;}
    // aerial
    for(const pod of w.pods){if(pod.landed||!inV(pod.x,pod.y,120))continue;const zz=pod.z;
      g.fillStyle='rgba(0,0,0,0.25)';g.beginPath();g.ellipse(pod.x+zz*110,pod.y+zz*140,10,6,0,0,TAU);g.fill();
      g.fillStyle='#55603c';g.fillRect(pod.x-8,pod.y-5,16,10);drawChute(g,pod.x,pod.y-4,14*(1+zz*0.8),'#efe9dc','#e07a3a',G.time*0.3);}
    if(p&&G.state==='para'){const zz=p.z,sc=1+zz*0.7;
      g.globalAlpha=0.35*(1-zz*0.5);g.fillStyle='#000';g.beginPath();g.ellipse(p.x+zz*120,p.y+zz*150,16*sc,12*sc,0,0,TAU);g.fill();g.globalAlpha=1;
      g.save();g.translate(p.x,p.y);g.scale(sc,sc);drawSoldier(g,0,0,p.ang,'stand',false,0,PAL.player,0,0);g.restore();
      g.globalAlpha=0.92;drawChute(g,p.x,p.y-6*sc,26*sc,'#7d8a55','#66723f',p.ang);g.globalAlpha=1;}
    if(G.heli)drawHeli(g,G.heli);
    if(G.plane&&inV(G.plane.x,G.plane.y,300))drawPlane(g,G.plane);
    // flak line during flight
    if(G.state==='flight'&&inV(v.camX,G.aaY,10)){g.strokeStyle='rgba(255,60,40,0.65)';g.lineWidth=4/z;g.setLineDash([30/z,18/z]);g.beginPath();g.moveTo(v.vx0,G.aaY);g.lineTo(v.vx1,G.aaY);g.stroke();g.setLineDash([]);
      g.font=`700 ${14/z}px ui-monospace,Menlo,monospace`;g.fillStyle='rgba(255,90,70,0.9)';g.textAlign='left';g.fillText('FLAK LINE: AUTOMATIC JUMP',v.vx0+20/z,G.aaY-10/z);}
    // screen-space
    ctx.setTransform(DPR,0,0,DPR,0,0);
    drawClouds(v);
    drawLighting(v);
    // indicators (unlit)
    g.setTransform(DPR*z,0,0,DPR*z,DPR*(CW/2-camX*z),DPR*(CH/2-camY*z));
    if(p&&G.state!=='flight'){g.textAlign='center';
      for(const e of w.enemies){if(e.state==='dead'||!inV(e.x,e.y,20))continue;
        if(e.state==='alert'){g.font='800 16px ui-sans-serif,system-ui,sans-serif';g.fillStyle='#ff4a3a';g.fillText('!',e.x,e.y-17);}
        else if(e.aware>0.05||e.state==='search'){const aw=e.state==='search'?Math.max(e.aware,0.5):e.aware;g.strokeStyle='rgba(0,0,0,0.5)';g.lineWidth=3.5;g.beginPath();g.arc(e.x,e.y-22,6,0,TAU);g.stroke();
          g.strokeStyle='#ffc93c';g.lineWidth=2.2;g.beginPath();g.arc(e.x,e.y-22,6,-Math.PI/2,-Math.PI/2+aw*TAU);g.stroke();
          if(e.state==='search'){g.font='800 9px ui-sans-serif,system-ui,sans-serif';g.fillStyle='#ffc93c';g.fillText('?',e.x,e.y-19);}}}
      for(const b of w.bunkers){if(b.dead||!inV(b.x,b.y,30))continue;if(b.aware>=1){g.font='800 16px ui-sans-serif,system-ui,sans-serif';g.fillStyle='#ff4a3a';g.fillText('!',b.x,b.y-30);}
        else if(b.aware>0.05){g.strokeStyle='#ffc93c';g.lineWidth=2.2;g.beginPath();g.arc(b.x,b.y-34,6,-Math.PI/2,-Math.PI/2+b.aware*TAU);g.stroke();}}}
    ctx.setTransform(DPR,0,0,DPR,0,0);
    ctx.drawImage(VIGNETTE,0,0,CW,CH);
    if(G.hurt>0.01){const gr=ctx.createRadialGradient(CW/2,CH/2,Math.min(CW,CH)*0.3,CW/2,CH/2,Math.hypot(CW,CH)*0.55);gr.addColorStop(0,'rgba(180,0,0,0)');gr.addColorStop(1,`rgba(180,0,0,${0.55*G.hurt})`);ctx.fillStyle=gr;ctx.fillRect(0,0,CW,CH);}
    if(p&&p.hp>0&&p.hp<30&&G.state==='ground'){ctx.fillStyle=`rgba(140,0,0,${0.12+0.08*Math.sin(G.time*5)})`;ctx.fillRect(0,0,CW,CH);}
    if(inPlay()||G.state==='dead'||G.state==='extract')drawArrows(v);
    if(dom&&G.state==='ground'&&!G.paused)drawCrosshair();
    if(dom&&input.held('map')&&(G.state==='ground'||G.state==='para'||G.state==='flight'))drawBigMap();
    if(pilot&&pilot.fade>0){ctx.fillStyle=`rgba(0,0,0,${pilot.fade})`;ctx.fillRect(0,0,CW,CH);}
  }
  function drawClouds(v){
    let a=0;if(G.state==='flight')a=0.55;else if(G.state==='para')a=0.55*clamp(G.player.z,0,1);else if(G.state==='title'||G.state==='brief')a=0.2;
    if(a<0.01)return;const par=1.7;ctx.globalAlpha=a;
    for(const c of G.clouds){const s=c.s*v.z*par,sx=CW/2+(c.x+G.time*8-v.camX)*v.z*par,sy=CH/2+(c.y-v.camY)*v.z*par;if(sx+s<0||sx-s>CW||sy+s<0||sy-s>CH)continue;ctx.drawImage(CLOUD,sx-s,sy-s*0.62,s*2,s*1.25);}
    ctx.globalAlpha=1;
  }
  function drawLighting(v){
    const T=G.world.T;
    ctx.globalCompositeOperation='multiply';ctx.fillStyle=T.mult;ctx.fillRect(0,0,CW,CH);ctx.globalCompositeOperation='source-over';
    const L=collectLights(v);
    if(T.dark){const d=darkCtx,sc=darkCv.width/CW;
      d.setTransform(1,0,0,1,0,0);d.globalCompositeOperation='source-over';d.clearRect(0,0,darkCv.width,darkCv.height);d.fillStyle=`rgba(4,8,22,${T.dark})`;d.fillRect(0,0,darkCv.width,darkCv.height);
      d.globalCompositeOperation='destination-out';d.setTransform(sc*v.z,0,0,sc*v.z,sc*(CW/2-v.camX*v.z),sc*(CH/2-v.camY*v.z));
      for(const l of L){const gr=d.createRadialGradient(l.x,l.y,0,l.x,l.y,l.r);gr.addColorStop(0,`rgba(0,0,0,${l.i})`);gr.addColorStop(0.5,`rgba(0,0,0,${l.i*0.6})`);gr.addColorStop(1,'rgba(0,0,0,0)');d.fillStyle=gr;d.beginPath();d.arc(l.x,l.y,l.r,0,TAU);d.fill();}
      ctx.drawImage(darkCv,0,0,CW,CH);}
    if(T.warm){const gr=ctx.createLinearGradient(0,0,CW,CH);gr.addColorStop(0,T.warm);gr.addColorStop(0.65,'rgba(0,0,0,0)');ctx.globalCompositeOperation='screen';ctx.fillStyle=gr;ctx.fillRect(0,0,CW,CH);}
    ctx.globalCompositeOperation='lighter';ctx.setTransform(DPR*v.z,0,0,DPR*v.z,DPR*(CW/2-v.camX*v.z),DPR*(CH/2-v.camY*v.z));
    for(const l of L){if(!l.g)continue;const r=l.r*0.8,gr=ctx.createRadialGradient(l.x,l.y,0,l.x,l.y,r);gr.addColorStop(0,`rgba(${l.c},${l.g})`);gr.addColorStop(1,`rgba(${l.c},0)`);ctx.fillStyle=gr;ctx.beginPath();ctx.arc(l.x,l.y,r,0,TAU);ctx.fill();}
    ctx.globalCompositeOperation='source-over';ctx.setTransform(DPR,0,0,DPR,0,0);
  }
  function drawCrosshair(){
    const p=G.player;if(!p||p.hp<=0)return;let x=mouse.x,y=mouse.y;
    if(padAim()){const a=aimPoint(p),v=G.view;x=(a.x-v.camX)*v.z+CW/2;y=(a.y-v.camY)*v.z+CH/2;}
    const spread=(p.stance==='prone'?0.012:p.stance==='crouch'?0.022:0.034)+(p.moving?(p.stance==='stand'?0.04:0.02):0)+p.bloom;
    const gap=5+spread*dist(p.x,p.y,screenToWorld(x,y).x,screenToWorld(x,y).y)*G.cam.zoom*0.9;
    ctx.lineCap='round';
    for(const[c,lw]of[['rgba(0,0,0,0.55)',4],['rgba(255,255,255,0.95)',1.8]]){ctx.strokeStyle=c;ctx.lineWidth=lw;ctx.beginPath();
      ctx.moveTo(x-gap-8,y);ctx.lineTo(x-gap,y);ctx.moveTo(x+gap,y);ctx.lineTo(x+gap+8,y);ctx.moveTo(x,y-gap-8);ctx.lineTo(x,y-gap);ctx.moveTo(x,y+gap);ctx.lineTo(x,y+gap+8);ctx.stroke();}
    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(x,y,1.4,0,TAU);ctx.fill();
    if(p.reloadT>0){ctx.strokeStyle='rgba(242,193,78,0.95)';ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y,gap+14,-Math.PI/2,-Math.PI/2+(1-p.reloadT/1.5)*TAU);ctx.stroke();}
    if(p.interactT>0){ctx.strokeStyle='rgba(242,193,78,0.95)';ctx.lineWidth=4;const s=(G.player.x-G.cam.x)*G.cam.zoom+CW/2,t=(G.player.y-G.cam.y)*G.cam.zoom+CH/2;ctx.beginPath();ctx.arc(s,t,22,-Math.PI/2,-Math.PI/2+p.interactT/1.8*TAU);ctx.stroke();}
  }
  function drawArrows(v){
    const w=G.world,ref=G.player||G.plane;if(!ref)return;const m=[];
    for(const t of w.targets)if(!t.done)m.push({x:t.x,y:t.y,c:'#f2c14e',l:'OBJ'});
    m.push({x:w.lz.x,y:w.lz.y,c:G.objDone?'#7be08a':'rgba(123,224,138,0.55)',l:'LZ'});
    if(G.state!=='flight')for(const pod of w.pods)if(pod.landed&&!pod.collected)m.push({x:pod.x,y:pod.y,c:'#8fd3ff',l:'POD'});
    ctx.font='700 11px ui-monospace,Menlo,monospace';ctx.textAlign='center';
    for(const k of m){const sx=(k.x-v.camX)*v.z+CW/2,sy=(k.y-v.camY)*v.z+CH/2;
      if(sx>24&&sx<CW-24&&sy>24&&sy<CH-24)continue;
      const dx=sx-CW/2,dy=sy-CH/2,f=Math.min((CW/2-46)/Math.abs(dx||1e-3),(CH/2-46)/Math.abs(dy||1e-3)),ex=CW/2+dx*f,ey=CH/2+dy*f,a=Math.atan2(dy,dx);
      ctx.save();ctx.translate(ex,ey);ctx.rotate(a);ctx.fillStyle=k.c;ctx.beginPath();ctx.moveTo(12,0);ctx.lineTo(-6,-8);ctx.lineTo(-2,0);ctx.lineTo(-6,8);ctx.closePath();ctx.fill();ctx.restore();
      const d=Math.round(dist(ref.x,ref.y,k.x,k.y)/10);ctx.fillStyle='rgba(0,0,0,0.55)';ctx.fillText(`${k.l} ${d}m`,ex-Math.cos(a)*24+1,ey-Math.sin(a)*24+5);ctx.fillStyle=k.c;ctx.fillText(`${k.l} ${d}m`,ex-Math.cos(a)*24,ey-Math.sin(a)*24+4);}
  }
  function drawMapMarkers(g,x0,y0,s,opts={}){
    const w=G.world,M=(x,y)=>[x0+x*s,y0+y*s];
    if(opts.camps){g.fillStyle='rgba(255,90,70,0.22)';g.strokeStyle='rgba(255,106,85,0.8)';g.lineWidth=1;for(const c of w.camps){const[x,y]=M(c.x,c.y);g.beginPath();g.arc(x,y,c.r*s,0,TAU);g.fill();g.stroke();}
      g.fillStyle='#ff6a55';for(const b of w.bunkers){const[x,y]=M(b.x,b.y);g.fillRect(x-2.5,y-2.5,5,5);}}
    if(opts.aa){const[,y]=M(0,G.aaY);g.strokeStyle='#ff3b30';g.lineWidth=2;g.setLineDash([6,4]);g.beginPath();g.moveTo(x0,y);g.lineTo(x0+W*s,y);g.stroke();g.setLineDash([]);}
    for(const m of w.mines)if(m.found&&!m.dead){const[x,y]=M(m.x,m.y);g.fillStyle='#ff4030';g.fillRect(x-1,y-1,2,2);}
    for(const pod of w.pods)if(!pod.collected){const[x,y]=M(pod.x,pod.y);g.fillStyle='#8fd3ff';g.fillRect(x-3,y-3,6,6);}
    {const[x,y]=M(w.lz.x,w.lz.y);g.strokeStyle='#7be08a';g.lineWidth=2;g.beginPath();g.arc(x,y,Math.max(5,w.lz.r*s),0,TAU);g.stroke();}
    for(const t of w.targets)if(!t.done){const[x,y]=M(t.x,t.y);g.fillStyle='#f2c14e';g.save();g.translate(x,y);g.rotate(Math.PI/4);g.fillRect(-4,-4,8,8);g.restore();}
    if(opts.enemies){const p=G.player;for(const e of w.enemies){if(e.state==='dead')continue;if(p&&dist(e.x,e.y,p.x,p.y)>opts.enemies)continue;const[x,y]=M(e.x,e.y);g.fillStyle=e.state==='alert'?'#ff3b30':'rgba(255,110,90,0.85)';g.beginPath();g.arc(x,y,2.4,0,TAU);g.fill();}}
    const ref=G.state==='flight'?G.plane:G.player;
    if(ref){const[x,y]=M(ref.x,ref.y);g.save();g.translate(x,y);g.rotate((G.state==='flight'?-Math.PI/2:ref.ang)+Math.PI/2);g.fillStyle='#fff';g.strokeStyle='#000';g.lineWidth=1;g.beginPath();g.moveTo(0,-6);g.lineTo(4.5,5);g.lineTo(0,2.5);g.lineTo(-4.5,5);g.closePath();g.fill();g.stroke();g.restore();}
  }
  function drawBigMap(){
    const img=G.world.mapImg,h=CH*0.86,s=h/img.height,mw=img.width*s,x0=(CW-mw)/2,y0=(CH-h)/2;
    ctx.fillStyle='rgba(5,8,5,0.6)';ctx.fillRect(0,0,CW,CH);
    ctx.drawImage(img,x0,y0,mw,h);ctx.strokeStyle='rgba(255,255,255,0.3)';ctx.lineWidth=1;ctx.strokeRect(x0,y0,mw,h);
    drawMapMarkers(ctx,x0,y0,s*0.1,{aa:G.state==='flight',enemies:400});
    ctx.font='600 11px ui-monospace,Menlo,monospace';ctx.fillStyle='rgba(255,255,255,0.7)';ctx.textAlign='left';ctx.fillText('N ↑',x0+8,y0+16);
  }
  function drawBriefMap(){
    const c=$('briefMap'),g=c.getContext('2d'),img=G.world.mapImg;
    g.setTransform(1,0,0,1,0,0);g.drawImage(img,0,0,c.width,c.height);
    g.fillStyle='rgba(0,0,0,0.12)';g.fillRect(0,0,c.width,c.height);
    const s=c.width/W;
    g.fillStyle='rgba(255,255,255,0.12)';g.fillRect(0,G.aaY*s,c.width,c.height-G.aaY*s);
    drawMapMarkers(g,0,0,s,{camps:true,aa:true});
    g.font='600 10px ui-monospace,Menlo,monospace';g.fillStyle='rgba(255,255,255,0.85)';g.textAlign='center';g.fillText('DROP AREA',c.width/2,c.height-14);g.fillText('▲',c.width/2,c.height-28);
  }
  function drawMini(){
    const g=miniCtx,w=G.world,ref=G.state==='flight'?G.plane:G.player;if(!ref)return;
    const S=0.1,size=180;g.setTransform(2,0,0,2,0,0);g.fillStyle='#0d110c';g.fillRect(0,0,size,size);
    g.drawImage(w.mapImg,ref.x*S-size/2,ref.y*S-size/2,size,size,0,0,size,size);
    if(w.T.dark){g.fillStyle='rgba(5,10,30,0.35)';g.fillRect(0,0,size,size);}
    drawMapMarkers(g,size/2-ref.x*S,size/2-ref.y*S,S,{enemies:380,aa:G.state==='flight'});
    g.strokeStyle='rgba(255,255,255,0.15)';g.lineWidth=1;g.strokeRect(0.5,0.5,size-1,size-1);
  }

  /* =====================================================================
     HUD / menus
     ===================================================================== */
  const hudCache={};
  function setText(id,v){v=String(v);if(hudCache[id]!==v){hudCache[id]=v;$(id).textContent=v;}}
  function setHTML(id,v){if(hudCache[id]!==v){hudCache[id]=v;$(id).innerHTML=v;}}
  function updateHUD(){
    if(!dom)return;
    const p=G.player,w=G.world,st=G.state;
    setText('hTimer',fmtTime(G.timeLeft));$('hTimer').classList.toggle('low',G.timeLeft<60&&st!=='flight');
    const showInv=!!p&&st!=='flight';$('pHp').classList.toggle('hidden',!showInv);$('pInv').classList.toggle('hidden',!showInv);
    if(p){setText('hHpN',Math.ceil(p.hp));const hw=Math.max(0,p.hp)+'%';if(hudCache.hpw!==hw){hudCache.hpw=hw;$('hHp').style.width=hw;}
      setText('hAmmo',p.reloadT>0?'··':p.ammo);setText('hMags',p.mags);setText('hGren',p.grenades);setText('hChg',p.charges);setText('hMed',p.medkits);
      const vis=G.pVis<0.3?'hidden':G.pVis<0.6?'concealed':G.pVis<1.05?'visible':'exposed';
      setText('hStance',st==='para'?`UNDER CANOPY · ${Math.round(p.z*400)} M`:`${{stand:'STANDING',crouch:'CROUCHED',prone:'PRONE'}[p.stance]}${p.inWater?' · WADING':''} · ${vis.toUpperCase()}`);}
    setHTML('hObj',w.targets.map(t=>`<li class="${t.done?'done':''}">${t.label}</li>`).join('')+`<li class="lz ${G.state==='extract'?'done':''}">${G.objDone?'Reach the LZ and board':'Then extract from the LZ'}</li>`);
    let hint='';
    if(st==='flight')hint=`${glyphHTML('steer')} steer · ${glyphHTML('pod')} drop supply pod (${G.plane.pods}) · ${glyphHTML('jump')} jump`;
    else if(st==='para')hint=`${glyphHTML('move')} steer canopy · ${glyphHTML('map')} map`;
    else if(st==='ground'){if(G.hintNear)hint=G.hintNear;else if(G.groundT<9)hint=`${glyphHTML('crouch')} crouch · ${glyphHTML('prone')} prone · ${glyphHTML('grenade')} grenade · ${glyphHTML('charge')} charge · ${glyphHTML('medkit')} medkit · ${glyphHTML('map')} map`;}
    setHTML('hint',hint);
    $('detect').classList.toggle('on',G.anyAlert&&st==='ground');
    const showP=!!p&&p.interactT>0;$('prog').classList.toggle('hidden',!showP);if(showP)$('progFill').style.width=Math.min(100,p.interactT/1.8*100)+'%';
    if(G.frame%2===0)drawMini();
  }
  function buildMenu(){
    $('diffSeg').innerHTML=Object.entries(DIFFS).map(([k,d])=>`<button data-d="${k}" class="${k===G.diffKey?'on':''}">${d.label}</button>`).join('');
    $('missionList').innerHTML=MISSIONS.map((M,i)=>{let best=0;try{best=+localStorage.getItem('dropzone-best-'+i)||0;}catch{/* storage blocked */}
      return `<button class="mcard" data-i="${i}"${i===G.sel?' aria-selected="true"':''}><div class="sw" style="background:${M.sw}"><span>${M.code} · ${M.cond}</span></div><h3>${M.name}</h3><p>${M.goal}</p><span class="best">${best?'BEST '+best.toLocaleString():'NOT YET COMPLETED'}</span></button>`;}).join('');
  }
  if(dom){
    listen($('diffSeg'),'click',e=>{const b=e.target.closest('button');if(!b)return;G.diffKey=b.dataset.d;audio.unlock();
      const pf=b.classList.contains('pad-focus');buildMenu();if(pf)padFocus($('diffSeg').querySelector(`[data-d="${G.diffKey}"]`));});
    listen($('missionList'),'click',e=>{const b=e.target.closest('.mcard');if(!b)return;audio.unlock();selectMission(+b.dataset.i);});
    listen($('deploy'),'click',()=>startMission(G.sel));
    listen($('bBack'),'click',toTitle);
    listen($('pResume'),'click',()=>setPaused(false));
    listen($('pAbort'),'click',toTitle);
    listen($('eRetry'),'click',()=>startMission(G.sel));
    listen($('eMenu'),'click',toTitle);
  }

  /* =====================================================================
     loop
     ===================================================================== */
  function tick(dt){
    if(pilot)pilot.step(dt);   // the autopilot sets its pad before the input reads it
    const live=inPlay()&&!G.paused;input.update();
    if(!live&&inPlay()&&!G.paused)inputLock=true;if(inputLock&&!PLAY_ACTS.some(a=>input.held(a)))inputLock=false;
    update(dt);render();
  }
  let last=performance.now(),raf=0,stopped=false;
  function frame(now){if(stopped)return;const dt=Math.min(0.05,(now-last)/1000);last=now;try{tick(dt);}catch(e){console.error(e);}raf=requestAnimationFrame(frame);}

  /* ---------- attract mode ---------- */
  // a run starts on the plane's approach to the flak line (or, for a still, on the ground near the objective)
  function startPreview(i,still=false){
    G.diffKey='veteran';startMission(i%MISSIONS.length,false);
    const w=G.world,pl=G.plane;
    if(still){
      const o=w.objCamp,f=findFree(w,o.x+rr(-90,90),o.y+o.r+150,12);   // just outside the wall guards' sight
      G.plane=null;G.player=makePlayer(f.x,f.y);G.player.z=0;G.player.stance='crouch';G.state='ground';G.cam.x=f.x;G.cam.y=f.y-80;G.cam.zf=1;
    }else{
      pl.y=G.aaY+1250;pl.x=clamp(w.roadX(pl.y)+rr(-200,200),300,W-300);G.cam.x=pl.x;G.cam.y=pl.y-140;
    }
    if(pilot){pilot.reset();if(still)pilot.fade=0;}
  }
  if(dom){
    G.world=genWorld(0,'veteran');G.cam.x=W/2;G.cam.y=H*0.85;
    buildMenu();show('title');
    raf=requestAnimationFrame(frame);
  }else if(reducedMotion){
    // one representative frame: a few seconds on the ground in front of the objective, no loop
    startPreview(op,true);
    for(let i=0;i<150;i++){G.player.stance='crouch';update(1/60);}
    render();
    listen(window,'resize',render);
  }else{
    startPreview(op);
    raf=requestAnimationFrame(frame);
  }
  return{stop(){
    if(stopped)return;stopped=true;
    cancelAnimationFrame(raf);
    for(const off of offs)off();offs.length=0;
    if(nav)nav.destroy();input.destroy();audio.close();
    // drop the terrain cache's backing stores now rather than whenever the collector gets to them
    if(G.world)for(const c of G.world.chunks.values())c.width=c.height=0;
    G.world=G.player=G.plane=G.heli=null;
  }};
}

// pure world queries, for the autopilot
export{W,H,TAU,clamp,dist,angDiff,hitsObstacle,isWater,losFactor};
