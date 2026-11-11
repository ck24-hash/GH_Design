/* Structure geometry: truss members, gutter and culture fixations, bracket line and I attachments.
   Pure functions, no page access. Units: mm. x runs along the truss from the outer face of the left pillar,
   y is up from the underside of the lower beam. */
(function () {
  'use strict';
  const GHD = window.GHD = window.GHD || {};
  const fmt = v => Number.isFinite(v) ? String(Math.round(v) || 0) : 'n/a';
  const PT = 4, STUB = 200, BW = 55;   // I plate thickness; I bar stub drawn in 2D, its width (from the Voltiris kit, 55 mm)
const rectPts=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
const spread=(first,n,L)=>{n=Math.floor(n);if(n<1)return{xs:[],pitch:0};const pitch=n>1?(L-2*first)/(n-1):0; /* L here is the span the layout is symmetric over */return{xs:Array.from({length:n},(_,i)=>first+i*pitch),pitch}};
const fixName=f=>(f.kind==='g'?'gutter line ':'culture line ')+f.id;
function clipPoly(pts,xmin,xmax){
  const cut=(P,inside,ix)=>{const o=[];for(let i=0;i<P.length;i++){const a=P[i],b=P[(i+1)%P.length],ia=inside(a),ib=inside(b);
    if(ia)o.push(a);if(ia!==ib)o.push(ix(a,b))}return o};
  const at=x=>(a,b)=>{const t=(x-a[0])/(b[0]-a[0]);return[x,a[1]+t*(b[1]-a[1])]};
  let P=cut(pts,q=>q[0]>=xmin,at(xmin));if(P.length<3)return[];
  return cut(P,q=>q[0]<=xmax,at(xmax))}

function build(p){
  const g={p,members:[],tris:[],fix:[],warn:[],bounds:[],Is:[]};
  const L=p.L,H=p.H,tc=p.tc,h=H-2*tc,xl=p.pw,xr=L,mid=(xl+xr)/2,te=p.te,xi0=xl+te,xi1=xr-te;
  Object.assign(g,{h,mid,xl,xr,te,xi0,xi1});
  if(xi1-xi0<=p.tm)g.warn.push('The edge posts leave no room between them.');
  if(xr-xl<=0)g.warn.push('The pillar is wider than the truss length.');
  if(!(L>0))g.warn.push('Truss length must be greater than 0.');
  if(h<=0)g.warn.push('Truss height must be more than twice the beam thickness.');
  g.members.push({pts:rectPts(xi0,0,xi1,tc)},{pts:rectPts(xi0,H-tc,xi1,H)});
  if(te>0)g.members.push({pts:rectPts(xl,0,xi0,H)},{pts:rectPts(xi1,0,xr,H)});
  const clipIn=pts=>{const c=clipPoly(pts,xi0,xi1);if(c.length>2)g.members.push({pts:c})};
  if(p.tm>0)g.members.push({pts:rectPts(mid-p.tm/2,tc,mid+p.tm/2,H-tc)});
  const A=mid-p.tm/2-xi0,step=p.w+p.offBtw;
  let nFit=0;if(p.w>0&&A>=p.offMid+p.w)nFit=Math.floor((A-p.offMid+p.offBtw)/step+1e-9);
  const want=Math.floor(p.nSide);let n=Math.min(want,200);
  if(want===0)g.warn.push('Triangles per side is 0.');
  Object.assign(g,{nFit,n});
  g.endGap=n?A-p.offMid-n*p.w-(n-1)*p.offBtw:A;
  const half=p.w/2,th=Math.atan2(h,half),dx=p.td/Math.sin(th);
  Object.assign(g,{theta:th,dx,legLen:Math.hypot(half,h)});
  g.legOK=h>0&&p.td>0&&dx<half;
  if(n&&h>0&&!g.legOK)g.warn.push('Bar thickness is too large for the triangle length: the two legs overlap at the base.');
  const yB=tc,yA=H-tc,starts=[];
  for(let i=0;i<n;i++){starts.push(mid+p.tm/2+p.offMid+i*step);starts.push(mid-p.tm/2-p.offMid-i*step-p.w)}
  starts.sort((a,b)=>a-b);
  starts.filter(x0=>x0+p.w>xi0&&x0<xi1).forEach((x0,i)=>{
    const x1=x0+p.w,xc=x0+half,cut=x0<xi0-1e-6||x1>xi1+1e-6;
    g.tris.push({id:'T'+(i+1),x0,x1,xc,yB,yA,cut});
    if(g.legOK){const yI=yB+(yA-yB)*(1-2*dx/p.w);
      clipIn([[x0,yB],[x0+dx,yB],[xc,yI],[xc,yA]]);clipIn([[x1-dx,yB],[x1,yB],[xc,yA],[xc,yI]])}
    else if(h>0)clipIn([[x0,yB],[x1,yB],[xc,yA]]);
  });
  g.nCut=g.tris.filter(t=>t.cut).length;
  const b=[0,L,L+p.pw];if(p.pw>0)b.push(p.pw);if(te>0)b.push(xi0,xi1);if(p.tm>0)b.push(mid-p.tm/2,mid+p.tm/2);else b.push(mid);
  g.tris.forEach(t=>b.push(...[t.x0,t.x1].filter(x=>x>=xi0-1e-6&&x<=xi1+1e-6)));
  g.bounds=[...new Set(b.map(v=>+v.toFixed(4)))].sort((a,b)=>a-b);

  // gutter and culture fixations on the underside of the lower beam
  let gx=[],cx=[];
  if(p.gutter){const s=spread(p.gFirst,p.gCount,L+p.pw);gx=s.xs;g.gPitch=s.pitch;
    if(gx.length>1&&s.pitch<=0)g.warn.push('Gutter lines: the first line is too far from the pillar for an even spread.')}
  if(p.culture){
    if(p.gutter){gx.forEach(x=>cx.push(x-p.cDist,x+p.cDist));
      if(p.cDist<=0)g.warn.push('Culture lines sit on the gutter lines: set a distance greater than 0.');
      if(gx.length>1&&2*p.cDist>=g.gPitch)g.warn.push('Culture lines of neighbouring gutter lines meet or cross. Reduce the distance from the gutter line.')}
    else{const s=spread(p.cFirst,p.cCount,L+p.pw);cx=s.xs;g.cPitch=s.pitch;
      if(cx.length>1&&s.pitch<=0)g.warn.push('Culture lines: the first line is too far from the pillar for an even spread.')}
  }
  cx.sort((a,b)=>a-b);
  gx.forEach((x,i)=>g.fix.push({id:'G'+(i+1),kind:'g',x}));
  cx.forEach((x,i)=>g.fix.push({id:'C'+(i+1),kind:'c',x}));
  g.fix.sort((a,b)=>a.x-b.x);
  const out=[],post=[];
  for(const f of g.fix){const z=zoneAt(g,f.x);f.clash=!!z;if(z==='out')out.push(f.id);else if(z)post.push(`${f.id} (${z})`)}
  if(out.length)g.warn.push(`Fixations outside the space between the edge posts: ${out.join(', ')}.`);
  if(post.length)g.warn.push(`Fixations over the pillar: ${post.map(s=>s.split(' ')[0]).join(', ')}.`);
  for(let i=1;i<g.fix.length;i++)if(g.fix[i].x-g.fix[i-1].x<1){g.warn.push(`${g.fix[i-1].id} and ${g.fix[i].id} are at the same position.`);g.fix[i].clash=g.fix[i-1].clash=true}
  g.nG=gx.length;g.nC=cx.length;
  if(p.gutter&&p.gHang>=p.pH-p.H)g.warn.push('The gutter is at or below ground level: the gutter line height is larger than the truss underside height.');
  placeI(g);
  return g;
}
function zoneAt(g,x){const p=g.p,e=1e-6;
  if(x<g.xi0-e||x>g.xi1+e)return'out';
  return''}

/* ---------- I attachments ---------- */
// U-bolt rod centre u hits a triangle leg where the leg meets the lower beam?
function postAt(g,u){const p=g.p,{r}=g.ig,e=1e-6;
  if(u<g.xi0+r-e||u>g.xi1-r+e)return'the edge post';
  if(p.tm>0&&Math.abs(u-g.mid)<p.tm/2+r-e)return'the middle reinforcement';
  return''}
function legAt(g,u){const{r,ri}=g.ig,e=1e-6;
  for(const t of g.tris){
    if(!g.legOK){if(u>t.x0-r+e&&u<t.x1+r-e)return t.id;continue}
    if(u>t.x0-r+e&&u<t.x0+g.dx+ri-e)return t.id+' left leg';
    if(u>t.x1-g.dx-ri+e&&u<t.x1+r-e)return t.id+' right leg'}
  return''}
function checkI(g,c){const p=g.p,{half,ub}=g.ig,e=1e-6,out=[];
  if(c-half<g.xi0-e||c+half>g.xi1+e)return['plate under the edge post or pillar'];
  for(const[u,s]of[[c-ub,'left'],[c+ub,'right']]){const z=postAt(g,u)||legAt(g,u);if(z)out.push(`${s} U-bolt hits ${z}`)}
  const f=g.fix.filter(f=>f.x>c-half+e&&f.x<c+half-e);if(f.length)out.push('plate covers '+f.map(f=>f.id).join(', '));
  return out}
function refCands(g){const p=g.p,{ub,half,ri}=g.ig,list=[];
  const add=(x,part,how)=>list.push({x,part,how,label:part+' '+how});
  const inside=x=>x>=g.xi0-1e-6&&x<=g.xi1+1e-6;
  if(g.legOK)for(const t of g.tris){const uL=t.x0+g.dx+ri,uR=t.x1-g.dx-ri;if(uR<uL)continue;
    for(const[u,leg]of[[uL,'left'],[uR,'right']]){if(!inside(leg==='left'?t.x0:t.x1))continue;const how=`touches the inside of ${t.id} ${leg} leg`;add(u+ub,'Left U-bolt',how);add(u-ub,'Right U-bolt',how)}}
  for(let i=1;i<g.tris.length;i++){const a=g.tris[i-1],b=g.tris[i];if((a.xc-g.mid)*(b.xc-g.mid)<0||!inside(a.x1)||!inside(b.x0))continue;
    const u=(a.x1+b.x0)/2,how=`centred in the gap between ${a.id} and ${b.id}`;add(u+ub,'Left U-bolt',how);add(u-ub,'Right U-bolt',how)}
  for(const f of g.fix){add(f.x+half,'Plate left end',`touches the right side of ${fixName(f)}`);add(f.x-half,'Plate right end',`touches the left side of ${fixName(f)}`)}
  return list}
function targetsFor(g,N){const p=g.p;if(g.xb==null)return Array.from({length:N},(_,k)=>g.xi0+(k+1)*(g.xi1-g.xi0)/(N+1));
  const far=g.xbRep,s=g.xb,pitch=(far-s)/(N+1);
  return Array.from({length:N},(_,k)=>s+(k+1)*pitch).sort((a,b)=>a-b)}
function optimise(g,N){
  const p=g.p,dm=Math.max(p.dmin,p.plate),{half}=g.ig,e=1e-6;
  const ok=x=>!checkI(g,x).length&&(g.xb==null||(Math.abs(x-g.xb)>=p.dmin-e&&Math.abs(x-g.xbRep)>=p.dmin-e));
  const raw=g.refs.filter(c=>ok(c.x)).map(c=>({x:c.x,ref:true,label:c.label}));
  for(let x=Math.ceil((g.xi0+half)/5)*5;x<=g.xi1-half+e;x+=5)if(ok(x))raw.push({x,ref:false,label:''});
  for(let n=N;n>=1;n--){const T=targetsFor(g,n);
    const C=raw.concat(T.filter(ok).map(x=>({x,ref:false,label:''}))).sort((a,b)=>a.x-b.x||(b.ref-a.ref));
    const M=C.length;if(!M)return{xs:[],labels:[]};
    const BIG=1e12,val=k=>(c=>(c.ref?BIG:0)-(c.x-T[k])**2);
    let prev=Float64Array.from(C,val(0));const back=[];
    for(let k=1;k<n;k++){const cur=new Float64Array(M).fill(-Infinity),bk=new Int32Array(M).fill(-1),v=val(k);let bv=-Infinity,bi=-1,ptr=0;
      for(let j=0;j<M;j++){while(ptr<M&&C[ptr].x<=C[j].x-dm+e){if(prev[ptr]>bv){bv=prev[ptr];bi=ptr}ptr++}
        if(bi>=0){cur[j]=bv+v(C[j]);bk[j]=bi}}
      back.push(bk);prev=cur}
    let bj=-1,bv=-Infinity;for(let j=0;j<M;j++)if(prev[j]>bv){bv=prev[j];bj=j}
    if(bj<0||bv===-Infinity)continue;
    const idx=[bj];for(let k=n-2;k>=0;k--)idx.unshift(back[k][idx[0]]);
    return{xs:idx.map(i=>C[i].x),n}}
  return{xs:[],n:0}}
function placeI(g){
  const p=g.p,L=p.L,N=Math.min(200,Math.floor(p.nI)||0);
  g.ig={r:p.rod/2,half:p.plate/2,ub:p.plate/2-p.ubIn,ri:g.theta>0?(p.rod/2)/Math.tan(g.theta/2):0};
  g.xb=p.brk?(p.brkSide==='left'?p.pw+p.brkDist:L-p.brkDist):null;
  g.xbRep=p.brk?(p.brkSide==='left'?L+p.pw+p.brkDist:-p.brkDist):null;
  g.refs=refCands(g);
  if(N<1)return;
  if(p.ubIn*2>=p.plate)g.warn.push('The U-bolts are set further in than half the plate length.');
  const dir=g.xb!=null&&p.brkSide==='right'?-1:1,origin=g.xb!=null?g.xb:g.xl,far=g.xb!=null?g.xbRep:g.xr;
  let xs=[];
  if(p.iMode==='manual'){let x=origin;for(let i=0;i<N;i++){x+=dir*(p.man[i]||0);xs.push(x)}}
  else if(p.iMode==='uniform'){const x1=origin+dir*p.uFirst,pitch=Math.abs(far-x1)/N;for(let k=0;k<N;k++)xs.push(x1+dir*k*pitch);g.iPitch=pitch}
  else{const r=optimise(g,N);xs=r.xs;if(r.n<N)g.warn.push(`Only ${r.n} of ${N} I fit with ${fmt(p.dmin)} mm between module lines and no collisions.`)}
  xs.sort((a,b)=>a-b);
  g.Is=xs.map((x,i)=>{const prob=checkI(g,x),refs=g.refs.filter(c=>Math.abs(c.x-x)<0.5);
    return{id:'I'+(i+1),x,prob,refs,clash:prob.length>0}});
  const bad=g.Is.filter(I=>I.prob.length);
  bad.forEach(I=>g.warn.push(`${I.id} at ${fmt(I.x)}: ${I.prob.join(', ')}.`));
  // module line spacing
  const lines=g.Is.map(I=>({id:I.id,x:I.x,I}));if(g.xb!=null)lines.push({id:'Bracket line',x:g.xb},{id:'Bracket line, adjacent bay',x:g.xbRep,rep:true});
  lines.sort((a,b)=>a.x-b.x);g.lines=lines;g.minSpace=Infinity;
  for(let i=1;i<lines.length;i++){const d=lines[i].x-lines[i-1].x;lines[i].gap=d;g.minSpace=Math.min(g.minSpace,d);
    if(d<p.dmin-0.5){g.warn.push(`${lines[i-1].id} and ${lines[i].id} are ${fmt(d)} mm apart, less than the ${fmt(p.dmin)} mm minimum.`);
      [lines[i],lines[i-1]].forEach(l=>{if(l.I)l.I.clash=true})}}
  g.Is.forEach(I=>I.near=nearest(g,I.x));
  g.nRef=g.Is.filter(I=>I.refs.length).length}
// Closest fixed point on each side of an I: clear gap from a U-bolt rod to a leg foot or post on the beam top,
// or from a plate end to a gutter or culture line under the beam.
function nearest(g,c){const p=g.p,{half,ub,r}=g.ig,e=1e-6,O=[[g.xl,g.xi0,'the left edge post'],[g.xi1,g.xr,'the right edge post']];
  if(p.tm>0)O.push([g.mid-p.tm/2,g.mid+p.tm/2,'the middle reinforcement']);
  for(const t of g.tris){const legs=g.legOK?[[t.x0,t.x0+g.dx,t.id+' left leg'],[t.x1-g.dx,t.x1,t.id+' right leg']]:[[t.x0,t.x1,t.id]];
    for(const[a,b,n]of legs){const a2=Math.max(a,g.xi0),b2=Math.min(b,g.xi1);if(b2>a2+e)O.push([a2,b2,n])}}
  let Lf=null,Rt=null;
  const take=(side,d,desc,xa,xb,lvl)=>{if(d<-e)return;const v={d:Math.max(0,d),desc,xa,xb,lvl};if(side<0){if(!Lf||v.d<Lf.d)Lf=v}else if(!Rt||v.d<Rt.d)Rt=v};
  for(const[s,u]of[['Left U-bolt',c-ub],['Right U-bolt',c+ub]])for(const[a,b,n]of O){
    if(b<=u-r+e)take(-1,u-r-b,`${s} to ${n}`,b,u-r,'top');
    if(a>=u+r-e)take(1,a-u-r,`${s} to ${n}`,u+r,a,'top')}
  for(const f of g.fix){
    if(f.x<=c-half+e)take(-1,c-half-f.x,`Plate left end to ${fixName(f)}`,f.x,c-half,'bot');
    if(f.x>=c+half-e)take(1,f.x-c-half,`Plate right end to ${fixName(f)}`,c+half,f.x,'bot')}
  return{left:Lf,right:Rt}}
const nearTxt=v=>v?`${fmt(v.d)} mm, ${v.desc}`:'none';
function iWin(g,I,W=420){const p=g.p,{half}=g.ig,n=I.near;let w2=Math.max(half+450,p.H*(W-118)/440);
  if(n.left)w2=Math.max(w2,I.x-n.left.xa+120);if(n.right)w2=Math.max(w2,n.right.xb-I.x+120);w2=Math.min(w2,Math.max(1600,p.H*(W-118)/440));
  return{xmin:I.x-w2,xmax:I.x+w2,focusI:I}}
function iCaption(I){return I.refs.length?`${I.id} at x = ${fmt(I.x)} mm. Referenced: ${I.refs.map(r=>r.part+' '+r.how).join('; ')}.`:
  `${I.id} at x = ${fmt(I.x)} mm. Free position. Nearest fixed point on the left: ${nearTxt(I.near.left)}. On the right: ${nearTxt(I.near.right)}.`}


  GHD.StructureGeo = { build, checkI, nearest, nearTxt, iWin, iCaption, clipPoly, rectPts, fixName, fmt, PT, STUB, BW };
})();
