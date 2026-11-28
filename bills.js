/* ===== Bills: electricity + water =====
   Every meter reading has a date AND a time. Readings are points on a timeline.
   - Two readings on one day? Both are kept and shown, with the change between them in hours.
   - A day with no reading? The use is spread evenly between the readings around it (shown with ≈).
   Needs app.js loaded first (it shares $, S, save, fmt, toast, sync, gh ...). */
const BT={
  elec:{name:'Electricity',icon:'⚡',unit:'kWh',col:'#f5b942',price:'elecPrice',bud:'elecBudget',dec:1,card:'#bElec'},
  water:{name:'Water',icon:'💧',unit:'m³',col:'#7aa2ff',price:'waterPrice',bud:'waterBudget',dec:2,card:'#bWater'}
};
let bOff=0, bType='elec', bCharts={}, bEditId=null, bAuto=true, bFound=[];
/* day numbers in UTC so daylight-saving can never shift a day */
const dn=d=>Date.UTC(+d.slice(0,4),+d.slice(5,7)-1,+d.slice(8,10))/864e5;
const fromDn=n=>new Date(n*864e5).toISOString().slice(0,10);
const wd=d=>new Date(d+'T00:00').toLocaleDateString(undefined,{weekday:'short',day:'numeric'});
const num=(v,t)=>(+v).toLocaleString(undefined,{minimumFractionDigits:BT[t].dec,maximumFractionDigits:BT[t].dec});
const sgn=(v,d=0)=>(v>=0?'+':'−')+Math.abs(v).toFixed(d);
/* time helpers. A reading saved by an older version has no time: it counts as the end of its day */
const tmin=t=>{const m=/^(\d\d):(\d\d)/.exec(t||'');return m?(+m[1]*60+ +m[2])/1440:null};
const rT=r=>{const m=tmin(r.time);return dn(r.date)+(m===null?.9993:m)};
const nowHM=()=>{const n=new Date();return String(n.getHours()).padStart(2,'0')+':'+String(n.getMinutes()).padStart(2,'0')};
const nowT=()=>{const n=new Date();return dn(today())+(n.getHours()*60+n.getMinutes())/1440};
const dur=d=>{const m=Math.round(d*1440),h=Math.floor(m/60),mm=m%60;return m>=2880?(m/1440).toFixed(1)+' days':h?h+'h'+(mm?' '+mm+'m':''):mm+'m'};

/* the bill period for a cycle: it can start later than the cycle (like arriving on the 18th) */
function bPeriod(off){
  const c=cycle(off), st=S.bill.starts[c.from];
  return {key:c.from,cFrom:c.from,to:c.to,from:st&&st>=c.from&&st<=c.to?st:c.from};
}
function periodOf(d){
  for(let o=0;o>-24;o--){const c=cycle(o);if(inRange(d,c))return bPeriod(o)}
  return null;
}

/* ---------- the maths ---------- */
function analyze(t,per,prev){
  const cfg=BT[t], price=+S.bill[cfg.price]||0, bud=+S.bill[cfg.bud]||0, endT=dn(per.to)+1;
  const pts=S.readings.filter(r=>r.type===t&&r.date>=per.from&&r.date<=per.to).map(r=>({...r,val:+r.val,T:rT(r)})).sort((a,b)=>a.T-b.T||a.val-b.val);
  /* old readings with no time that share a day: spread them 6 hours apart (lowest meter value first) */
  const grp={}; pts.forEach(p=>{if(!p.time)(grp[p.date]=grp[p.date]||[]).push(p)});
  Object.values(grp).forEach(g=>{if(g.length>1)g.forEach((p,i)=>{p.T=dn(p.date)+.9993-(g.length-1-i)*.25;p.guess=true})});
  pts.sort((a,b)=>a.T-b.T||a.val-b.val);
  for(let i=1;i<pts.length;i++)if(pts[i].T<=pts[i-1].T)pts[i].T=pts[i-1].T+1/1440;
  const an={t,cfg,price,bud,per,pts,ready:false};
  if(pts.length<2)return an;

  /* 1. the meter as a straight line between readings */
  const Ts=pts.map(p=>p.T), Vs=pts.map(p=>p.val), N0=pts.length;
  const T0=Ts[0], TL=Ts[N0-1], V0=Vs[0], VL=Vs[N0-1];
  const Rat=T=>{
    if(T<=T0)return V0; if(T>=TL)return VL;
    let i=1; while(Ts[i]<T)i++;
    return Vs[i-1]+(Vs[i]-Vs[i-1])*(T-Ts[i-1])/(Ts[i]-Ts[i-1]);
  };
  const used=VL-V0, span=TL-T0;
  /* 2. the change between each pair of readings, in hours */
  const ints=[]; let bad=false;
  for(let i=1;i<N0;i++){const dv=Vs[i]-Vs[i-1];if(dv<0)bad=true;ints.push({a:pts[i-1],b:pts[i],days:Ts[i]-Ts[i-1],use:Math.max(0,dv)})}
  /* 3. forecast rate (units a day): recent readings count more (decay of about 3 days) */
  let wn=0,wdn=0; ints.forEach(x=>{const w=Math.exp(-(TL-(x.a.T+x.b.T)/2)/3);wn+=w*x.use;wdn+=w*x.days});
  const ew=wdn>0?wn/wdn:used/span;
  /* 4. calendar-day rows (real readings inside the day are listed on it) */
  const nowTm=Math.max(TL,Math.min(nowT(),endT)), e=nowTm-TL, rem=endT-nowTm;
  const rows=[];
  for(let d=Math.floor(T0);d<=Math.floor(nowTm-1e-9);d++){
    const s=Math.max(d,T0), en=Math.min(d+1,nowTm); if(en<=s)continue;
    const kEnd=Math.min(en,TL), kLen=s<TL?kEnd-s:0, uK=s<TL?Rat(kEnd)-Rat(s):0;
    const eLen=en>TL?en-Math.max(s,TL):0, uE=ew*eLen;
    const rd=pts.filter(p=>Math.floor(p.T)===d);
    rows.push({d:fromDn(d),dnum:d,u:uK+uE,uK,uE,len:en-s,kLen,rd,est:!rd.length||uE>0});
  }
  /* 5. statistics over days that are at least half covered by readings */
  let us=rows.filter(r=>r.kLen>=.5).map(r=>r.uK/r.kLen); if(!us.length)us=[used/span];
  const n=us.length, avgDay=us.reduce((a,b)=>a+b,0)/n;
  const sd=Math.sqrt(us.reduce((s,u)=>s+(u-avgDay)**2,0)/n);
  const avg=used/span, w7=Math.min(7,span);
  const recent=(Rat(TL)-Rat(TL-w7))/w7;
  const prior=span>=10?(Rat(TL-7)-V0)/(TL-7-T0):null;
  let slope=null;
  if(n>=5){const mx=(n-1)/2;let sxy=0,sxx=0;us.forEach((u,i)=>{sxy+=(i-mx)*(u-avgDay);sxx+=(i-mx)**2});slope=sxx?sxy/sxx:0}
  const trendWk=slope!==null&&avg>0?slope*7/avg*100:null;
  const thr=n>=5&&sd>0?avgDay+1.5*sd:Infinity;
  rows.forEach(r=>{r.spike=r.rd.length>0&&r.uE===0&&r.kLen>=.5&&r.uK/r.kLen>thr});
  const full=rows.filter(r=>r.kLen>=.5);
  const peak=full.length?full.reduce((a,b)=>b.uK/b.kLen>a.uK/a.kLen?b:a):{d:rows[0].d,uK:used,kLen:span};
  peak.rate=peak.uK/peak.kLen;
  /* 6. now, and the end of the period */
  const usedNow=used+ew*e, projUsed=usedNow+ew*rem, band=sd*Math.sqrt(e+rem);
  const lowUsed=Math.max(usedNow,projUsed-band), highUsed=projUsed+band;
  const prevAvg=prev?(()=>{const p=analyze(t,prev);return p.ready&&p.span>=3?p.avg:0})():0;
  Object.assign(an,{ready:true,Rat,T0,TL,V0,VL,span,ints,bad,ew,rows,n,avg,avgDay,sd,recent,prior,slope,trendWk,thr,peak,nowTm,e,rem,endT,usedNow,projUsed,lowUsed,highUsed,prevAvg,used,
    costAct:used*price,costNow:usedNow*price,projCost:projUsed*price,lowCost:lowUsed*price,highCost:highUsed*price,last:ints[ints.length-1]});
  /* 7. verdict */
  const v=(r,a,b,c,tx)=>r<=a?['good',tx[0]]:r<=b?['good',tx[1]]:r<=c?['warn',tx[2]]:['bad',tx[3]];
  if(bud>0&&price>0)an.verdict=v(an.projCost/bud,.9,1,1.15,['On track ✓','Okay, near budget ✓','Watch out ⚠','Too high 🔥']);
  else if(prevAvg>0)an.verdict=v(avg/prevAvg,.95,1.05,1.2,['Lower than last time ✓','Same as last time ✓','Higher than last time ⚠','Much higher 🔥']);
  else an.verdict=['neutral','Set a budget for a verdict'];
  return an;
}

/* ---------- drawing ---------- */
const stamp=p=>`${wd(p.date)} ${p.time||'no time'}`;
function bCard(an){
  const c=an.cfg, u=c.unit, t=an.t;
  if(!an.ready){
    return `<div class="card bcard" style="--c:${c.col}"><div class="bhead"><h3>${c.icon} ${c.name}</h3></div>
    <p class="hint">${an.pts.length?'One reading saved. Add a second one (even a few hours later) and I will work everything out.':`Add your starting meter reading for ${nice(an.per.from)}, then another one later. I will work out the cost, per-day use, a forecast and a verdict.`}</p>${readingsList(an)}</div>`;
  }
  const pr=an.price>0, money=x=>pr?fmt(x):'set price', ph=x=>(+x).toFixed(t==='elec'?2:3);
  const [tone,vt]=an.verdict, vsAvg=an.avg>0?(an.recent/an.avg-1)*100:0, li=an.last;
  const liKnown=!(li.a.guess||li.b.guess)&&!((!li.a.time||!li.b.time)&&li.a.date===li.b.date);
  let tiles=`
    <div class="tile"><small>Per day (average)</small><b>${num(an.avg,t)} ${u}</b><span class="tag">${money(an.avg*an.price)} a day</span></div>
    <div class="tile"><small>Last change</small><b>${num(li.use,t)} ${u}</b><span class="tag">${liKnown?`in ${dur(li.days)} · ${ph(li.use/(li.days*24))}/hour`:'time between not known'}</span></div>
    ${an.span>=7?`<div class="tile"><small>Last 7 days</small><b>${num(an.recent,t)} ${u}</b><span class="tag ${vsAvg>5?'up':vsAvg<-5?'down':''}">${sgn(vsAvg)}% vs your average</span></div>`:''}
    <div class="tile"><small>Trend</small><b>${an.trendWk===null?'—':an.trendWk>5?'▲ rising':an.trendWk<-5?'▼ falling':'► steady'}</b><span class="tag">${an.trendWk===null?'needs 5 days of data':sgn(an.trendWk)+'% per week'}</span></div>
    <div class="tile"><small>Peak day</small><b>${num(an.peak.rate,t)} ${u}</b><span class="tag">${wd(an.peak.d)} · ${an.avg>0?(an.peak.rate/an.avg).toFixed(1):'0'}× average</span></div>
    <div class="tile"><small>Bill by ${nice(an.per.to)}</small><b>${money(an.projCost)}</b><span class="tag">${num(an.projUsed,t)} ${u} at this pace</span></div>
    <div class="tile"><small>Likely range</small><b style="font-size:.95rem">${pr?fmt(an.lowCost)+' – '+fmt(an.highCost):'—'}</b><span class="tag">based on how much your days vary</span></div>`;
  let bar='';
  if(an.bud>0&&pr){
    const used=an.costNow/an.bud, pj=an.projCost/an.bud, allow=an.rem>0?(an.bud/an.price-an.usedNow)/an.rem:null;
    bar=`<div><div class="row" style="justify-content:space-between"><small>Budget used</small><small>${fmt(an.costNow)} of ${fmt(an.bud)} · ${Math.round(used*100)}%</small></div>
      <div class="pbar ${used>1?'bad':used>.85?'warn':''}" style="margin-top:6px"><i style="width:${Math.min(100,used*100)}%"></i></div></div>`;
    tiles+=`<div class="tile"><small>Projected vs budget</small><b class="${pj>1.15?'up':pj<=1?'down':''}">${Math.round(pj*100)}%</b><span class="tag">${pj>1?'over':'under'} by ${fmt(Math.abs(an.projCost-an.bud))}</span></div>
    <div class="tile"><small>Allowed per day left</small><b>${allow===null?'period over':allow<=0?'0 (used up)':num(allow,t)+' '+u}</b><span class="tag">you are using ${num(an.ew,t)} ${u} a day now</span></div>`;
  }
  /* plain-English notes */
  const first=an.pts[0], lastP=an.pts[an.pts.length-1], notes=[];
  notes.push(`From <b>${stamp(first)}</b> to <b>${stamp(lastP)}</b> (${dur(an.span)}) you used <b>${num(an.used,t)} ${u}</b>${pr?', that is <b>'+fmt(an.costAct)+'</b>':''}.`);
  if(an.e>0.02)notes.push(`Your last reading was ${dur(an.e)} ago, so right now is estimated at <b>${num(an.usedNow,t)} ${u}</b> using your recent pace.`);
  if(liKnown&&an.ints.length>1)notes.push(`Between your last two readings (${dur(li.days)}) you used <b>${num(li.use,t)} ${u}</b>, about <b>${ph(li.use/(li.days*24))} ${u}</b> an hour. Your overall average is ${ph(an.avg/24)} an hour.`);
  if(an.prior!==null){const ch=(an.recent/an.prior-1)*100;notes.push(`The last 7 days averaged <b>${num(an.recent,t)}</b> a day, compared with <b>${num(an.prior,t)}</b> before that (<b>${sgn(ch)}%</b>).`)}
  const spikes=an.rows.filter(x=>x.spike);
  if(spikes.length)notes.push(`🔥 High days: ${spikes.map(x=>`${wd(x.d)} (${num(x.uK/x.kLen,t)} ${u})`).join(', ')}. These are well above your normal day.`);
  if(an.prevAvg>0)notes.push(`Last bill period you averaged <b>${num(an.prevAvg,t)} ${u}</b> a day, this one is <b>${sgn((an.avg/an.prevAvg-1)*100)}%</b>.`);
  if(an.rem>0&&pr)notes.push(`If you keep using about ${num(an.ew,t)} ${u} a day, the bill lands near <b>${fmt(an.projCost)}</b> on ${nice(an.per.to)}.`);
  if(an.bad)notes.push('⚠ Some readings look out of order (a later reading is lower). Check the dates and times in "Your readings".');
  if(an.pts.some(p=>p.guess))notes.push('Some old readings have no time and share a day, so I spread them 6 hours apart. Tap Edit on them to set the real time.');
  if(!pr)notes.push('Set your price per unit at the bottom of this page to see costs.');
  if(!(an.bud>0))notes.push('Add a budget at the bottom to get a clear okay / too-much verdict.');
  /* day-by-day table, newest first. Days with readings list every reading with its time. */
  const dayRows=[...an.rows].reverse().map(r=>{
    const rd=r.rd.length?r.rd.map(p=>`<span class="rdl"><b>${p.time||'—'}</b> ${num(p.val,t)}</span>`).join(''):'<span class="rdl">≈</span>';
    const part=r.len<.99?`<small>${dur(r.len)}${r.uE>0?' (est.)':''}</small>`:'';
    return `<tr class="${r.spike?'spike':r.est?'est':''}"><td>${wd(r.d)}${r.spike?' 🔥':''}</td><td class="rd">${rd}</td><td>${r.len<.02?'—':num(r.u,t)+part}</td><td>${r.len<.02||!pr?'—':fmt(r.u*an.price)}</td></tr>`;
  }).join('');
  const dayTab=`<table class="btab"><tr><th>Day</th><th>Readings</th><th>Used</th><th>Cost</th></tr>${dayRows}</table><p class="hint">Every reading you typed is listed on its day with the time. ≈ = no reading that day, so the use is spread evenly between the readings around it.</p>`;
  /* change between readings, newest first */
  const intRows=[...an.ints].reverse().map(x=>{
    const known=!(x.a.guess||x.b.guess)&&!((!x.a.time||!x.b.time)&&x.a.date===x.b.date), approx=!x.a.time||!x.b.time;
    return `<tr><td>${stamp(x.a)}<br>→ ${stamp(x.b)}</td><td>${known?(approx?'≈ ':'')+dur(x.days):'?'}</td><td>${num(x.use,t)}<small>${pr?fmt(x.use*an.price):''}</small></td><td>${known?ph(x.use/(x.days*24))+'/h':'—'}</td></tr>`;
  }).join('');
  const intTab=`<table class="btab"><tr><th>Between</th><th>Time</th><th>Used</th><th>Rate</th></tr>${intRows}</table><p class="hint">The change from one reading to the next, so you can compare last night with this morning.</p>`;
  return `<div class="card bcard" style="--c:${c.col}">
    <div class="bhead"><h3>${c.icon} ${c.name}</h3><span class="vchip ${tone}">${vt}</span></div>
    <div class="bbig"><b>${money(an.costNow)}</b><small>${num(an.usedNow,t)} ${u} so far${an.e>0.02?' (estimated to now)':''}</small></div>
    ${bar}
    <div class="tiles">${tiles}</div>
    <div class="insights">${notes.map(x=>`<div>• ${x}</div>`).join('')}</div>
    <canvas id="ch_${t}" height="240"></canvas>
    <details open><summary>Between readings (hours)</summary>${intTab}</details>
    <details open><summary>Day by day</summary>${dayTab}</details>
    <details><summary>Your readings (${an.pts.length})</summary>${readingsList(an)}</details>
  </div>`;
}
function readingsList(an){
  return an.pts.length?[...an.pts].reverse().map(p=>`<div class="item"><div class="l"><span>${num(p.val,an.t)} ${an.cfg.unit}</span><span class="tag">${nice(p.date)} · ${p.time||'time not set'}</span></div><div class="r acts"><button class="btn ghost small" data-redit="${p.id}">Edit</button><button class="btn danger small" data-rdel="${p.id}">Delete</button></div></div>`).join(''):'';
}
function bChart(an){
  if(typeof Chart==='undefined'||!an.ready)return;
  const cv=$('#ch_'+an.t); if(!cv.getContext)return;
  const usd=S.settings.disp==='USD', conv=k=>usd?k/rate():k, p=an.price||1;
  const d0=Math.floor(an.T0), L=Math.floor(an.endT-1e-9)-d0+1, idxNow=Math.floor(an.nowTm-1e-9)-d0;
  const labels=[], bars=[], act=[], proj=[], bud=[], estI={};
  let run=0;
  const byD={}; an.rows.forEach(r=>byD[r.dnum]=r);
  for(let i=0;i<L;i++){
    const d=d0+i, r=byD[d], dayEnd=d+1; labels.push(nice(fromDn(d)));
    let b=null,a=null,pj=null;
    if(r){run+=r.u*p;b=r.u*p;a=run;estI[i]=r.est}
    if(i===idxNow)pj=run; else if(i>idxNow)pj=run+an.ew*p*(dayEnd-an.nowTm);
    bars.push(b===null?null:conv(b));act.push(a===null?null:conv(a));proj.push(pj===null?null:conv(pj));
    bud.push(an.bud>0?conv(an.bud*Math.min(1,(dayEnd-an.T0)/(an.endT-an.T0))):null);
  }
  const col=an.cfg.col, tip=v=>usd?'$'+(+v).toFixed(2):'៛'+Math.round(v).toLocaleString();
  const ds=[
    {type:'bar',label:'Cost that day',data:bars,yAxisID:'y',order:3,borderRadius:3,backgroundColor:c=>estI[c.dataIndex]?col+'55':col+'bb'},
    {type:'line',label:'Total so far',data:act,yAxisID:'y1',order:1,borderColor:col,backgroundColor:col,tension:.25,borderWidth:2.5,pointRadius:2,spanGaps:false},
    {type:'line',label:'Forecast',data:proj,yAxisID:'y1',order:2,borderColor:col,borderDash:[6,5],tension:.1,borderWidth:2,pointRadius:0}
  ];
  if(an.bud>0)ds.push({type:'line',label:'Budget pace',data:bud,yAxisID:'y1',order:2,borderColor:'#ff6b81',borderDash:[2,4],borderWidth:1.5,pointRadius:0});
  Chart.defaults.color='#9a92b5';
  bCharts[an.t]=new Chart(cv,{type:'bar',data:{labels,datasets:ds},options:{
    interaction:{mode:'index',intersect:false},
    plugins:{legend:{position:'bottom',labels:{boxWidth:12,usePointStyle:true}},tooltip:{filter:i=>i.raw!==null,callbacks:{label:i=>`${i.dataset.label}: ${tip(i.raw)}`}}},
    scales:{y:{position:'left',grid:{color:'#2f2947'},beginAtZero:true,title:{display:true,text:'per day'}},
            y1:{position:'right',grid:{drawOnChartArea:false},beginAtZero:true,title:{display:true,text:'total'}},
            x:{grid:{display:false},ticks:{maxRotation:0,autoSkip:true}}}}});
}

function renderBills(){
  const per=bPeriod(bOff), prev=bPeriod(bOff-1);
  if(document.activeElement.id!=='bStart')$('#bStart').value=per.from;
  $('#bStart').min=per.cFrom;$('#bStart').max=per.to;
  $('#bRange').textContent=`Bill cycle ${nice(per.cFrom)} → ${nice(per.to)}`+(bOff?'':' · this cycle')+(per.from!==per.cFrom?`. Counting from ${nice(per.from)}, so the days before it are not charged to you.`:'');
  $('#bNext').disabled=bOff>=0;
  $$('#bType button').forEach(b=>b.classList.toggle('on',b.dataset.t===bType));
  if(bAuto&&document.activeElement.id!=='bTime')$('#bTime').value=nowHM();
  const lr=S.readings.filter(r=>r.type===bType).sort((a,b)=>rT(b)-rT(a))[0], c=BT[bType];
  $('#bHint').textContent=bEditId?'Editing a reading. Change anything, then tap Update reading.':lr?`Last ${c.name.toLowerCase()} reading: ${num(lr.val,bType)} ${c.unit} on ${nice(lr.date)}${lr.time?' at '+lr.time:''}. You can add as many readings per day as you like.`:`No ${c.name.toLowerCase()} reading yet. Make your first one the meter on ${nice(per.from)}, the day you start counting.`;
  $('#bSave').textContent=bEditId?'Update reading':'Save reading';
  $('#bCancel').hidden=!bEditId;
  if(document.activeElement.id!=='pElec')$('#pElec').value=S.bill.elecPrice||'';
  if(document.activeElement.id!=='pWater')$('#pWater').value=S.bill.waterPrice||'';
  if(document.activeElement.id!=='bElecBud')$('#bElecBud').value=S.bill.elecBudget||'';
  if(document.activeElement.id!=='bWaterBud')$('#bWaterBud').value=S.bill.waterBudget||'';

  Object.values(bCharts).forEach(x=>x.destroy()); bCharts={};
  const ans={elec:analyze('elec',per,prev),water:analyze('water',per,prev)};
  let now=0,proj=0,any=false;
  Object.values(ans).forEach(a=>{if(a.ready&&a.price>0){any=true;now+=a.costNow;proj+=a.projCost}});
  $('#bTotal').textContent=any?fmt(now):'—';
  $('#bSub').textContent=any?`so far · about ${fmt(proj)} by ${nice(per.to)}`:'add readings and prices';
  Object.keys(BT).forEach(t=>{$(BT[t].card).innerHTML=bCard(ans[t])});
  Object.values(ans).forEach(bChart);
}

/* ---------- inputs ---------- */
$('#bPrev').onclick=()=>{bOff--;renderBills()};
$('#bNext').onclick=()=>{if(bOff<0){bOff++;renderBills()}};
$('#bType').onclick=e=>{const t=e.target.dataset.t;if(t){bType=t;renderBills()}};
$('#bStart').onchange=()=>{
  const per=bPeriod(bOff), v=$('#bStart').value;
  if(!v||v<per.cFrom||v>per.to){toast('Pick a day inside this bill cycle');return renderBills()}
  S.bill.starts[per.key]=v;save();toast('Start day saved ✓');
};
$('#bStartReset').onclick=()=>{const per=bPeriod(bOff);S.bill.starts[per.key]=per.cFrom;save()};
$('#bDate').max=today();$('#bDate').value=today();$('#bTime').value=nowHM();
$('#bTime').oninput=$('#bDate').oninput=()=>{bAuto=false};
function bReset(){bEditId=null;bAuto=true;$('#bVal').value='';$('#bDate').value=today();$('#bTime').value=nowHM()}
$('#bCancel').onclick=()=>{bReset();renderBills()};
$('#bSave').onclick=()=>{
  const t=bType, d=$('#bDate').value, tm=$('#bTime').value, raw=$('#bVal').value, v=+raw;
  if(!d||d>today())return toast('Pick today or a past day');
  if(!tm)return toast('Pick the time you read the meter');
  if(d===today()&&tm>nowHM())return toast('That time has not happened yet');
  if(raw===''||!(v>=0))return toast('Enter the meter reading');
  const per=periodOf(d);
  if(per&&d<per.from)return toast(`That is before the start day (${nice(per.from)}). Change the start day above first.`);
  const T=dn(d)+tmin(tm), others=S.readings.filter(r=>r.type===t&&r.id!==bEditId);
  if(others.some(r=>r.date===d&&r.time===tm))return toast(`You already have a ${BT[t].name.toLowerCase()} reading at ${tm} on that day. Use Edit on it, or pick a different time.`);
  const before=others.filter(r=>rT(r)<T).sort((a,b)=>rT(b)-rT(a))[0], after=others.filter(r=>rT(r)>T).sort((a,b)=>rT(a)-rT(b))[0];
  if(before&&v<before.val)return toast(`Lower than your ${nice(before.date)}${before.time?' '+before.time:''} reading (${num(before.val,t)})`);
  if(after&&v>after.val)return toast(`Higher than your ${nice(after.date)}${after.time?' '+after.time:''} reading (${num(after.val,t)})`);
  if(bEditId){S.readings=S.readings.filter(r=>r.id!==bEditId);S.deleted[bEditId]=Date.now()}
  S.readings.push({id:uid(),type:t,date:d,time:tm,val:v});
  const edited=!!bEditId; bReset(); save(); toast(edited?'Reading updated ✓':'Reading saved ✓');
};
$('#tab-bills').onclick=e=>{
  const del=e.target.dataset.rdel, ed=e.target.dataset.redit;
  if(del&&confirm('Delete this reading?')){S.readings=S.readings.filter(r=>r.id!==del);S.deleted[del]=Date.now();save()}
  if(ed){
    const r=S.readings.find(x=>x.id===ed); if(!r)return;
    bEditId=ed;bType=r.type;bAuto=false;
    $('#bDate').value=r.date;$('#bTime').value=r.time||'12:00';$('#bVal').value=r.val;
    renderBills(); if($('#bType').scrollIntoView)$('#bType').scrollIntoView({behavior:'smooth',block:'center'});
  }
};
$('#bSaveP').onclick=()=>{
  S.bill.elecPrice=+$('#pElec').value||0;S.bill.waterPrice=+$('#pWater').value||0;
  S.bill.elecBudget=+$('#bElecBud').value||0;S.bill.waterBudget=+$('#bWaterBud').value||0;
  save();toast('Saved ✓');
};

/* ---------- bring back lost readings ----------
   Looks for readings that exist in older copies of your data (sync history or a backup file)
   but are missing now, shows them, and restores the ones you approve. */
function recoverFrom(snaps){
  const have=new Set(S.readings.map(r=>r.id)), found={};
  snaps.forEach(sn=>(sn&&sn.readings||[]).forEach(r=>{if(r&&r.id&&BT[r.type]&&r.date&&!have.has(r.id))found[r.id]=r}));
  /* skip ones that are already back under a new id (same type, date, time and value) */
  const same=r=>S.readings.some(x=>x.type===r.type&&x.date===r.date&&(x.time||'')===(r.time||'')&&+x.val===+r.val);
  const list=Object.values(found).filter(r=>!same(r)).sort((a,b)=>(a.date+(a.time||'')).localeCompare(b.date+(b.time||'')));
  bFound=list.sort((x,y)=>(y.date+(y.time||'')).localeCompare(x.date+(x.time||'')));
  drawFound();
  toast(list.length?`Found ${list.length} missing reading${list.length>1?'s':''}. Pick the ones to restore.`:'No missing readings found');
}
/* each found reading gets its own Restore / Skip button */
function drawFound(){
  $('#bRecList').innerHTML=bFound.length?`<p class="hint">Tap Restore only on the ones you want back. A reading you deleted on purpose can show up here too, just tap Skip.</p>`+bFound.map(r=>`<div class="item"><div class="l"><span>${BT[r.type].icon} ${num(r.val,r.type)} ${BT[r.type].unit}</span><span class="tag">${nice(r.date)} · ${r.time||'time not set'}</span></div><div class="r acts"><button class="btn small" data-rrec="${r.id}">Restore</button><button class="btn ghost small" data-rskip="${r.id}">Skip</button></div></div>`).join(''):'';
}
$('#bRecList').onclick=e=>{
  const rec=e.target.dataset.rrec, skip=e.target.dataset.rskip, id=rec||skip; if(!id)return;
  const r=bFound.find(x=>x.id===id); if(!r)return;
  bFound=bFound.filter(x=>x.id!==id);
  if(rec){S.readings.push({id:uid(),type:r.type,date:r.date,...(r.time?{time:r.time}:{}),val:+r.val});save();toast('Restored ✓')}
  drawFound();
};
$('#bRecGist').onclick=async()=>{
  if(!sync.token||!sync.id)return toast('Sync history needs your GitHub sync set up in Settings. Try "From a backup file", or add the reading again with its time.');
  toast('Searching your sync history…');
  try{
    const r=await gh('/gists/'+sync.id+'/commits?per_page=100'); if(!r.ok)throw r.status;
    const commits=await r.json(), snaps=[];
    for(let i=0;i<commits.length;i+=6)await Promise.all(commits.slice(i,i+6).map(async c=>{
      try{
        const g=await gh('/gists/'+sync.id+'/'+c.version); if(!g.ok)return;
        const f=(await g.json()).files['spending.json']; if(!f)return;
        snaps.push(JSON.parse(f.truncated?await(await fetch(f.raw_url,{cache:'no-store'})).text():f.content));
      }catch{}
    }));
    toast(`Checked ${snaps.length} older copies`);
    setTimeout(()=>recoverFrom(snaps),600);
  }catch(x){toast('Could not read the sync history ('+x+')')}
};
$('#bRecFile').onclick=()=>$('#bRecIn').click();
$('#bRecIn').onchange=async e=>{
  try{recoverFrom([JSON.parse(await e.target.files[0].text())])}catch{toast('That file could not be read')}
  e.target.value='';
};
