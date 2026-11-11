/* Structure drawings: one primitive list per view, rendered to SVG on screen and to PDF in the report. */
(function () {
  'use strict';
  const GHD = window.GHD;
  const { clipPoly, rectPts, fmt, PT, STUB, BW } = GHD.StructureGeo;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function drawView(g,o){
  const p=g.p,P=[],fs=o.fs,r=o.dotR,detail=!!o.detail,{xmin,xmax,W}=o;
  const e=1e-6,inWin=x=>x>=xmin-e&&x<=xmax+e;
  const fixIn=g.fix.filter(f=>inWin(f.x));
  const hasI=true,lineIn=g.Is.some(I=>inWin(I.x))||(g.xb!=null&&inWin(g.xb));
  const ybot=hasI?-(PT+STUB):0;
  const rows=(fixIn.length?1:0)+(lineIn?1:0)+1+(detail?0:1);
  const top=p.H,mL=14,mR=detail?104:80,mT=16,mB=(hasI?fs+8:0)+10+2*r+rows*26+(detail?fs*2+6:0);
  const k=(W-mL-mR)/Math.max(1,xmax-xmin);
  const X=x=>mL+(x-xmin)*k,Y=y=>mT+(top-y)*k;
  const Hh=mT+(top-ybot)*k+mB;
  const tw=s=>s.length*fs*0.62;
  const poly=(pts,role)=>{const c=clipPoly(pts,xmin,xmax);if(c.length>2)P.push({t:'poly',pts:c.map(([x,y])=>[X(x),Y(y)]),role})};
  const line=(a,b,role,dash)=>P.push({t:'line',a,b,role,dash});
  const text=(x,y,s,anchor='middle',rot=0,role='dimtext',size=fs)=>P.push({t:'text',x,y,s,anchor,rot,role,size});
  for(const[a,b]of[[0,p.pw],[p.L,p.L+p.pw]]){if(b<=a)continue;poly(rectPts(a,ybot,b,p.H),'pil');
    const c=clipPoly(rectPts(a,ybot,b,0),xmin,xmax);if(c.length>2){const x0=Math.min(...c.map(q=>q[0])),x1=Math.max(...c.map(q=>q[0])),yb=Y(ybot),n=4,pts=[];
      for(let i=0;i<=n;i++)pts.push([X(x0)+(X(x1)-X(x0))*i/n,yb+(i%2?-3:3)]);P.push({t:'pl',pts,role:'brkm'});
      if(X(x1)-X(x0)>tw('Pillar')+4)text((X(x0)+X(x1))/2,Y(ybot)+fs+3,'Pillar','middle',0,'tag',fs*0.9)}}
  for(const m of g.members)poly(m.pts,'mem');
  if(g.h*k>fs*2){const ty=p.tc+g.h*0.28;for(const t of g.tris)if(t.xc>xmin&&t.xc<xmax)text(X(t.xc),Y(ty)+fs*0.35,t.id,'middle',0,'tag',fs*0.9)}
  // I attachments
  const{half,ub,r:rr}=g.ig,tagY=Y(ybot)+fs+3;
  for(const I of g.Is){const c=I.x,role=I.clash?'iw':'ip';
    poly(rectPts(c-half,-PT,c+half,0),role);poly(rectPts(c-BW/2,ybot,c+BW/2,-PT),role);
    for(const u of[c-ub,c+ub])poly(rectPts(u-rr,-PT-8,u+rr,p.tc+rr),'ub');
    if(inWin(c))text(X(c),tagY,I.id,'middle',0,'tag',fs*0.9)}
  if(g.xb!=null&&inWin(g.xb)){line([X(g.xb),Y(p.tc)],[X(g.xb),Y(ybot)],'brk',true);text(X(g.xb),tagY,'B','middle',0,'tag',fs*0.9)}
  // gutter and culture fixations
  const my=Y(0)+r+1;
  for(const f of fixIn){const role=f.clash?'fixw':f.kind==='g'?'fixg':'fixc',u=X(f.x);
    if(f.kind==='g')P.push({t:'poly',pts:[[u-r,my-r],[u+r,my-r],[u+r,my+r],[u-r,my+r]],role});
    else P.push({t:'circle',c:[u,my],r,role})}
  const tick=(u,v)=>line([u-3,v+3],[u+3,v-3],'dim');
  const chainH=(xs,ref,v,last)=>{xs=xs.filter(inWin);if(xs.length<2)return;
    line([X(xs[0]),v],[X(xs[xs.length-1]),v],'dim');
    xs.forEach(x=>{line([X(x),ref+3],[X(x),v+4],'dim');tick(X(x),v)});
    let alt=0;for(let i=1;i<xs.length;i++){const s=fmt(xs[i]-xs[i-1]),seg=X(xs[i])-X(xs[i-1]),cx=(X(xs[i])+X(xs[i-1]))/2;
      if(tw(s)<seg-4)text(cx,v-4,s);else if(detail&&last){text(cx,v+fs+3+(alt%2)*(fs+2),s);alt++}}};
  const chainV=(ys,u,ref)=>{line([u,Y(ys[0])],[u,Y(ys[ys.length-1])],'dim');
    ys.forEach(y=>{line([ref+3,Y(y)],[u+4,Y(y)],'dim');tick(u,Y(y))});
    for(let i=1;i<ys.length;i++){const s=fmt(ys[i]-ys[i-1]),seg=Y(ys[i-1])-Y(ys[i]),cy=(Y(ys[i])+Y(ys[i-1]))/2;
      if(tw(s)<seg-4)text(u-4,cy,s,'middle',90);else if(detail)text(u+6,cy+fs*0.35,s,'start')}};
  const uniq=a=>[...new Set(a.map(v=>+v.toFixed(4)))].sort((a,b)=>a-b);
  const below=Math.max(Y(0)+2*r+2,hasI?tagY+3:0);
  let v=below+22;
  if(fixIn.length){chainH(uniq([0,...g.fix.map(f=>f.x),p.L]),my+r,v,false);v+=26}
  if(lineIn){chainH(uniq([0,...(g.xb!=null?[g.xb]:[]),...g.Is.map(I=>I.x),p.L]),hasI?tagY+3:Y(0),v,false);v+=26}
  chainH(g.bounds,Y(0),v,detail);v+=26;
  if(!detail)chainH([0,p.L],Y(0),v,true);
  const right=X(xmax);
  chainV([0,p.tc,p.H-p.tc,p.H],right+24,right);
  chainV([0,p.H],right+(detail?80:54),right);
  if(o.focusI){const I=o.focusI;
    for(const v of[I.near.left,I.near.right]){if(!v||v.d<0.5||I.refs.length)continue;
      const yw=v.lvl==='top'?p.tc+Math.min(60,g.h*0.25):-PT-70,yr=v.lvl==='top'?p.tc:-PT,vv=Y(yw),a=X(v.xa),b=X(v.xb);
      line([a,Y(yr)],[a,vv-4],'fdim');line([b,Y(yr)],[b,vv-4],'fdim');line([a,vv],[b,vv],'fdim');
      line([a-3,vv+3],[a+3,vv-3],'fdim');line([b-3,vv+3],[b+3,vv-3],'fdim');
      const s=fmt(v.d);text(b-a>tw(s)+4?(a+b)/2:(v===I.near.left?a-4:b+4),vv-4,s,b-a>tw(s)+4?'middle':(v===I.near.left?'end':'start'),0,'ftext')}}
  if(detail&&o.angleTri&&g.legOK){const t=o.angleTri,th=g.theta,cx=X(t.x0),cy=Y(t.yB),ra=Math.min(36,(t.xc-t.x0)*k*0.8);
    if(t.x0>=xmin&&t.xc<=xmax){
      const pts=[];for(let i=0;i<=18;i++){const a=th*i/18;pts.push([cx+ra*Math.cos(a),cy-ra*Math.sin(a)])}
      P.push({t:'pl',pts,role:'dim'});
      text(cx+(ra+4)*Math.cos(th/2),cy-(ra+4)*Math.sin(th/2)+fs*0.35,(th*180/Math.PI).toFixed(1)+'°','start');
      const A=[X(t.x0),Y(t.yB)],C=[X(t.xc),Y(t.yA)],Ln=Math.hypot(C[0]-A[0],C[1]-A[1]),d=[(C[0]-A[0])/Ln,(C[1]-A[1])/Ln];
      let nrm=[d[1],-d[0]];if(nrm[0]>0)nrm=[-nrm[0],-nrm[1]];
      text((A[0]+C[0])/2+nrm[0]*5,(A[1]+C[1])/2+nrm[1]*5,'bar '+fmt(p.td),'middle',-Math.atan2(d[1],d[0])*180/Math.PI)}}
  return{W,H:Hh,P}}

function toSVG(v){
  let s=`<svg xmlns="http://www.w3.org/2000/svg" class="dwg" width="${v.W}" height="${v.H.toFixed(1)}" viewBox="0 0 ${v.W} ${v.H.toFixed(1)}" role="img">`;
  const f=n=>n.toFixed(2),pts=a=>a.map(p=>f(p[0])+','+f(p[1])).join(' ');
  for(const q of v.P){
    if(q.t==='poly')s+=`<polygon class="${q.role}" points="${pts(q.pts)}"/>`;
    else if(q.t==='line')s+=`<line class="${q.role}" x1="${f(q.a[0])}" y1="${f(q.a[1])}" x2="${f(q.b[0])}" y2="${f(q.b[1])}"${q.dash?' stroke-dasharray="6 3 1.5 3"':''}/>`;
    else if(q.t==='pl')s+=`<polyline class="${q.role}" points="${pts(q.pts)}"/>`;
    else if(q.t==='circle')s+=`<circle class="${q.role}" cx="${f(q.c[0])}" cy="${f(q.c[1])}" r="${q.r}"/>`;
    else if(q.t==='text')s+=`<text class="${q.role}" x="${f(q.x)}" y="${f(q.y)}" font-size="${q.size.toFixed(1)}" text-anchor="${q.anchor}"${q.rot?` transform="rotate(${(-q.rot).toFixed(2)} ${f(q.x)} ${f(q.y)})"`:''}>${esc(q.s)}</text>`;
  }
  return s+'</svg>'}

function windows(g){const p=g.p,n=g.n;
  let hw=n?p.tm/2+p.offMid+p.w*0.62:p.tm/2+p.offMid+400;hw=Math.min(hw,p.L/2);
  const mid={xmin:g.mid-hw,xmax:g.mid+hw,angleTri:g.tris.find(t=>t.x0>=g.mid)};
  const t0=g.tris[0];let ew=t0?Math.max(t0.x1,g.xi0+300)+Math.min(p.offBtw,p.w*0.25)+p.w*0.08:g.xi0+600;ew=Math.min(ew,g.mid);
  return{mid,end:{xmin:0,xmax:ew,angleTri:g.tris.find(t=>t.x0>=g.xi0)}}}

const PR={mem:{f:'#E6F0FF',s:'#001D3B',w:.6},pil:{f:'#EEF3FA',s:'#001D3B',w:.6},brkm:{s:'#001D3B',w:.6},ip:{f:'#D5F5EE',s:'#00806A',w:.5},iw:{f:'#FCEFE8',s:'#B4441C',w:.5},ub:{f:'#40598A'},brk:{s:'#001D3B',w:.8},
  fixg:{f:'#40598A'},fixc:{f:'#00A88A'},fixw:{f:'#B4441C'},dim:{s:'#6A7FA6',w:.45},fdim:{s:'#B4441C',w:.8},ftext:{c:'#B4441C'},dimtext:{c:'#001D3B'},tag:{c:'#40598A'}};
const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
function drawPdf(doc,v,ox,oy){
  for(const q of v.P){const st=PR[q.role]||{};
    if(st.s){doc.setDrawColor(...rgb(st.s));doc.setLineWidth(st.w||.5)}
    if(st.f)doc.setFillColor(...rgb(st.f));
    if(q.t==='poly'){const d=[];for(let i=1;i<q.pts.length;i++)d.push([q.pts[i][0]-q.pts[i-1][0],q.pts[i][1]-q.pts[i-1][1]]);
      doc.lines(d,ox+q.pts[0][0],oy+q.pts[0][1],[1,1],st.s?'FD':'F',true)}
    else if(q.t==='line'){if(q.dash)doc.setLineDashPattern([5,2,1,2],0);doc.line(ox+q.a[0],oy+q.a[1],ox+q.b[0],oy+q.b[1]);if(q.dash)doc.setLineDashPattern([],0)}
    else if(q.t==='pl'){for(let i=1;i<q.pts.length;i++)doc.line(ox+q.pts[i-1][0],oy+q.pts[i-1][1],ox+q.pts[i][0],oy+q.pts[i][1])}
    else if(q.t==='circle')doc.circle(ox+q.c[0],oy+q.c[1],q.r,'F');
    else if(q.t==='text'){doc.setFont(q.role==='tag'||q.role==='ftext'?'LexendMedium':'LexendLight','normal');doc.setFontSize(q.size);doc.setTextColor(...rgb(st.c||'#001D3B'));
      const w=doc.getTextWidth(q.s),sh=q.anchor==='middle'?w/2:q.anchor==='end'?w:0,a=q.rot*Math.PI/180;
      doc.text(q.s,ox+q.x-sh*Math.cos(a),oy+q.y+sh*Math.sin(a),q.rot?{angle:q.rot}:undefined)}}
}

  GHD.StructureDraw = { drawView, toSVG, windows, drawPdf };
})();
