/* ===== Bills: electricity + water =====
   You type meter readings. Days between two readings are filled in evenly
   (marked ≈). Everything else is worked out from those readings.
   Needs app.js loaded first (it shares $, S, save, fmt, toast ...). */
const BT={
  elec:{name:'Electricity',icon:'⚡',unit:'kWh',col:'#f5b942',price:'elecPrice',bud:'elecBudget',dec:1,card:'#bElec'},
  water:{name:'Water',icon:'💧',unit:'m³',col:'#7aa2ff',price:'waterPrice',bud:'waterBudget',dec:2,card:'#bWater'}
};
let bOff=0, bType='elec', bCharts={};
/* day numbers in UTC so daylight-saving can never shift a day */
const dn=d=>Date.UTC(+d.slice(0,4),+d.slice(5,7)-1,+d.slice(8,10))/864e5;
const fromDn=n=>new Date(n*864e5).toISOString().slice(0,10);
const wd=d=>new Date(d+'T00:00').toLocaleDateString(undefined,{weekday:'short',day:'numeric'});
const num=(v,t)=>(+v).toLocaleString(undefined,{minimumFractionDigits:BT[t].dec,maximumFractionDigits:BT[t].dec});
const sgn=(v,d=0)=>(v>=0?'+':'−')+Math.abs(v).toFixed(d);

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
  const cfg=BT[t], price=+S.bill[cfg.price]||0, bud=+S.bill[cfg.bud]||0, td=dn(today()), endN=dn(per.to);
  const pts=S.readings.filter(r=>r.type===t&&r.date>=per.from&&r.date<=per.to).sort((a,b)=>a.date.localeCompare(b.date));
  const an={t,cfg,price,bud,per,pts,ready:false};
  if(pts.length<2)return an;

  /* 1. a meter reading for every day: real ones, and straight-line fill between them */
  const A=new Map(pts.map(p=>[dn(p.date),+p.val]));
  const d0=dn(pts[0].date), dL=dn(pts[pts.length-1].date), R=[];
  for(let d=d0;d<=dL;d++){
    if(A.has(d)){R.push(A.get(d));continue}
    let a=d-1;while(!A.has(a))a--;
    let b=d+1;while(!A.has(b))b++;
    R.push(A.get(a)+(A.get(b)-A.get(a))*(d-a)/(b-a));
  }
  /* 2. usage per day = today's reading minus yesterday's */
  const daily=[];
  for(let i=1;i<R.length;i++)daily.push({d:fromDn(d0+i),r:R[i],u:Math.max(0,R[i]-R[i-1]),est:!(A.has(d0+i)&&A.has(d0+i-1)),act:A.has(d0+i)});
  const n=daily.length, us=daily.map(x=>x.u), used=R[R.length-1]-R[0];
  const avg=used/n;
  const sd=Math.sqrt(us.reduce((s,u)=>s+(u-avg)**2,0)/n);
  /* 3. forecast rate = exponentially weighted average (recent days count more) */
  let ew=us[0]; for(let i=1;i<n;i++)ew=.3*us[i]+.7*ew;
  const k=Math.min(7,n), recent=us.slice(-k).reduce((s,u)=>s+u,0)/k;
  const prior=n>=10?us.slice(0,n-7).reduce((s,u)=>s+u,0)/(n-7):null;
  /* 4. trend = least-squares slope of daily usage */
  let slope=null;
  if(n>=5){const mx=(n-1)/2;let sxy=0,sxx=0;us.forEach((u,i)=>{sxy+=(i-mx)*(u-avg);sxx+=(i-mx)**2});slope=sxx?sxy/sxx:0}
  const trendWk=slope!==null&&avg>0?slope*7/avg*100:null;
  /* 5. spikes = days more than 1.5 standard deviations above normal (real readings only) */
  const thr=n>=5&&sd>0?avg+1.5*sd:Infinity;
  daily.forEach(x=>x.spike=!x.est&&x.u>thr);
  const peak=daily.reduce((a,b)=>b.u>a.u?b:a);
  /* 6. now and end of period */
  const nowN=Math.max(dL,Math.min(td,endN)), e=nowN-dL, rem=Math.max(0,endN-nowN);
  const usedNow=used+ew*e, projUsed=usedNow+ew*rem;
  const band=sd*Math.sqrt(e+rem);
  const lowUsed=Math.max(usedNow,projUsed-band), highUsed=projUsed+band;
  const prevAvg=prev?(()=>{const p=analyze(t,prev);return p.ready&&p.n>=3?p.avg:0})():0;

  Object.assign(an,{ready:true,A,R,d0,dL,nowN,endN,e,rem,daily,n,used,avg,sd,ew,recent,prior,slope,trendWk,thr,peak,usedNow,projUsed,lowUsed,highUsed,prevAvg,
    costAct:used*price,costNow:usedNow*price,projCost:projUsed*price,lowCost:lowUsed*price,highCost:highUsed*price});

  /* 7. verdict */
  const v=(r,a,b,c,tx)=>r<=a?['good',tx[0]]:r<=b?['good',tx[1]]:r<=c?['warn',tx[2]]:['bad',tx[3]];
  if(bud>0&&price>0)an.verdict=v(an.projCost/bud,.9,1,1.15,['On track ✓','Okay, near budget ✓','Watch out ⚠','Too high 🔥']);
  else if(prevAvg>0)an.verdict=v(avg/prevAvg,.95,1.05,1.2,['Lower than last time ✓','Same as last time ✓','Higher than last time ⚠','Much higher 🔥']);
  else an.verdict=['neutral','Set a budget for a verdict'];
  return an;
}

/* ---------- drawing ---------- */
function bCard(an){
  const c=an.cfg, u=c.unit, t=an.t;
  if(!an.ready){
    return `<div class="card bcard" style="--c:${c.col}"><div class="bhead"><h3>${c.icon} ${c.name}</h3></div>
    <p class="hint">${an.pts.length?'One reading saved. Add a second one on a later day and I will work everything out.':`Add your starting meter reading for ${nice(an.per.from)}, then another one on a later day. I will work out the cost, per-day use, a forecast and a verdict.`}</p>${readingsList(an)}</div>`;
  }
  const pr=an.price>0, money=x=>pr?fmt(x):'set price';
  const last=an.pts[an.pts.length-1].date;
  const [tone,vt]=an.verdict;
  const vsAvg=an.avg>0?(an.recent/an.avg-1)*100:0;
  let tiles=`
    <div class="tile"><small>Per day (average)</small><b>${num(an.avg,t)} ${u}</b><span class="tag">${money(an.avg*an.price)} a day</span></div>
    <div class="tile"><small>Last ${Math.min(7,an.n)} days</small><b>${num(an.recent,t)} ${u}</b><span class="tag ${vsAvg>5?'up':vsAvg<-5?'down':''}">${sgn(vsAvg)}% vs your average</span></div>
    <div class="tile"><small>Trend</small><b>${an.trendWk===null?'—':an.trendWk>5?'▲ rising':an.trendWk<-5?'▼ falling':'► steady'}</b><span class="tag">${an.trendWk===null?'needs 5 days of data':sgn(an.trendWk)+'% per week'}</span></div>
    <div class="tile"><small>Peak day</small><b>${num(an.peak.u,t)} ${u}</b><span class="tag">${wd(an.peak.d)} · ${an.avg>0?(an.peak.u/an.avg).toFixed(1):'0'}× average</span></div>
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
  const notes=[];
  notes.push(`You have used <b>${num(an.used,t)} ${u}</b> over <b>${an.n} day${an.n>1?'s':''}</b> (${nice(an.pts[0].date)} → ${nice(last)})${pr?', that is <b>'+fmt(an.costAct)+'</b>':''}.`);
  if(an.e>0)notes.push(`Your last reading was ${nice(last)}, so today is estimated at <b>${num(an.usedNow,t)} ${u}</b> using your recent daily use.`);
  if(an.prior!==null){const ch=(an.recent/an.prior-1)*100;notes.push(`The last 7 days averaged <b>${num(an.recent,t)}</b> a day, compared with <b>${num(an.prior,t)}</b> before that (<b>${sgn(ch)}%</b>).`)}
  const spikes=an.daily.filter(x=>x.spike);
  if(spikes.length)notes.push(`🔥 High days: ${spikes.map(x=>`${wd(x.d)} (${num(x.u,t)} ${u})`).join(', ')}. These are well above your normal day.`);
  if(an.prevAvg>0)notes.push(`Last bill period you averaged <b>${num(an.prevAvg,t)} ${u}</b> a day, this one is <b>${sgn((an.avg/an.prevAvg-1)*100)}%</b>.`);
  if(an.rem>0&&pr)notes.push(`If you keep using about ${num(an.ew,t)} ${u} a day, the bill lands near <b>${fmt(an.projCost)}</b> on ${nice(an.per.to)}.`);
  if(!pr)notes.push('Set your price per unit at the bottom of this page to see costs.');
  if(!(an.bud>0))notes.push('Add a budget at the bottom to get a clear okay / too-much verdict.');
  /* day-by-day table, newest first */
  const rows=[{d:fromDn(an.d0),read:an.R[0],act:true,start:true}];
  an.daily.forEach(x=>rows.push({d:x.d,read:x.r,u:x.u,est:x.est,act:x.act,spike:x.spike}));
  for(let j=1;j<=an.e;j++)rows.push({d:fromDn(an.dL+j),read:an.R[an.R.length-1]+an.ew*j,u:an.ew,est:true,act:false});
  const tab=`<table class="btab"><tr><th>Day</th><th>Meter</th><th>Used</th><th>Cost</th></tr>${rows.reverse().map(r=>`<tr class="${r.spike?'spike':r.est?'est':''}"><td>${wd(r.d)}${r.start?' · start':r.spike?' 🔥':''}</td><td>${r.act?'<b>'+num(r.read,t)+'</b>':'≈ '+num(r.read,t)}</td><td>${r.start?'—':num(r.u,t)}</td><td>${r.start?'—':pr?fmt(r.u*an.price):'—'}</td></tr>`).join('')}</table><p class="hint">Bold meter = a reading you typed. ≈ means filled in between two readings (or estimated for today).</p>`;
  return `<div class="card bcard" style="--c:${c.col}">
    <div class="bhead"><h3>${c.icon} ${c.name}</h3><span class="vchip ${tone}">${vt}</span></div>
    <div class="bbig"><b>${money(an.costNow)}</b><small>${num(an.usedNow,t)} ${u} so far${an.e>0?' (estimated to today)':''}</small></div>
    ${bar}
    <div class="tiles">${tiles}</div>
    <div class="insights">${notes.map(x=>`<div>• ${x}</div>`).join('')}</div>
    <canvas id="ch_${t}" height="240"></canvas>
    <details open><summary>Day by day</summary>${tab}</details>
    <details><summary>Your readings (${an.pts.length})</summary>${readingsList(an)}</details>
  </div>`;
}
function readingsList(an){
  return an.pts.length?an.pts.map(p=>`<div class="item"><div class="l"><span>${num(p.val,an.t)} ${an.cfg.unit}</span><span class="tag">${nice(p.date)}</span></div><div class="r"><button class="btn danger small" data-rdel="${p.id}">Delete</button></div></div>`).join(''):'';
}
function bChart(an){
  if(typeof Chart==='undefined'||!an.ready)return;
  const cv=$('#ch_'+an.t); if(!cv.getContext)return;
  const usd=S.settings.disp==='USD', conv=k=>usd?k/rate():k, p=an.price||1;
  const L=an.endN-an.d0+1, labels=[], bars=[], act=[], proj=[], bud=[];
  for(let i=0;i<L;i++){
    const d=an.d0+i; labels.push(nice(fromDn(d)));
    let b=null,a=null,pj=null;
    if(i===0)a=0;
    else if(d<=an.dL){b=an.daily[i-1].u*p;a=(an.R[i]-an.R[0])*p}
    else if(d<=an.nowN){b=an.ew*p;a=an.costAct+an.ew*(d-an.dL)*p}
    if(d>=an.nowN)pj=an.costNow+an.ew*(d-an.nowN)*p;
    bars.push(b===null?null:conv(b));act.push(a===null?null:conv(a));proj.push(pj===null?null:conv(pj));
    bud.push(an.bud>0?conv(an.bud*i/Math.max(1,L-1)):null);
  }
  const col=an.cfg.col, estDay=i=>i>0&&((an.d0+i)>an.dL||an.daily[i-1].est);
  const tip=v=>usd?'$'+(+v).toFixed(2):'៛'+Math.round(v).toLocaleString();
  const ds=[
    {type:'bar',label:'Cost that day',data:bars,yAxisID:'y',order:3,borderRadius:3,backgroundColor:c=>estDay(c.dataIndex)?col+'55':col+'bb'},
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
  const lr=S.readings.filter(r=>r.type===bType).sort((a,b)=>b.date.localeCompare(a.date))[0], c=BT[bType];
  $('#bHint').textContent=lr?`Last ${c.name.toLowerCase()} reading: ${num(lr.val,bType)} ${c.unit} on ${nice(lr.date)}`:`No ${c.name.toLowerCase()} reading yet. Make your first one the meter on ${nice(per.from)}, the day you start counting.`;
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
$('#bDate').max=today();$('#bDate').value=today();
$('#bSave').onclick=()=>{
  const t=bType, d=$('#bDate').value, raw=$('#bVal').value, v=+raw;
  if(!d||d>today())return toast('Pick today or a past day');
  if(raw===''||!(v>=0))return toast('Enter the meter reading');
  const per=periodOf(d);
  if(per&&d<per.from)return toast(`That is before the start day (${nice(per.from)}). Change the start day above first.`);
  const same=S.readings.filter(r=>r.type===t&&r.date!==d);
  const before=same.filter(r=>r.date<d).sort((a,b)=>b.date.localeCompare(a.date))[0], after=same.filter(r=>r.date>d).sort((a,b)=>a.date.localeCompare(b.date))[0];
  if(before&&v<before.val)return toast(`Lower than your ${nice(before.date)} reading (${num(before.val,t)})`);
  if(after&&v>after.val)return toast(`Higher than your ${nice(after.date)} reading (${num(after.val,t)})`);
  S.readings=S.readings.filter(r=>{const dup=r.type===t&&r.date===d;if(dup)S.deleted[r.id]=Date.now();return !dup});
  S.readings.push({id:uid(),type:t,date:d,val:v});
  $('#bVal').value='';save();toast('Reading saved ✓');
};
$('#tab-bills').onclick=e=>{
  const id=e.target.dataset.rdel; if(!id)return;
  if(confirm('Delete this reading?')){S.readings=S.readings.filter(r=>r.id!==id);S.deleted[id]=Date.now();save()}
};
$('#bSaveP').onclick=()=>{
  S.bill.elecPrice=+$('#pElec').value||0;S.bill.waterPrice=+$('#pWater').value||0;
  S.bill.elecBudget=+$('#bElecBud').value||0;S.bill.waterBudget=+$('#bWaterBud').value||0;
  save();toast('Saved ✓');
};
