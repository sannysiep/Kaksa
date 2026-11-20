/* ===== Kaksa Spending Tracker ===== */
// $ never returns null, so one missing element can't stop the other buttons from loading
const $=s=>document.querySelector(s)||{style:{},dataset:{},classList:{toggle(){},add(){},remove(){}},addEventListener(){}};
const $$=s=>[...document.querySelectorAll(s)];
const CATS=['🍜 Food','🚕 Transport','🏠 Rent','🛍️ Shopping','💡 Bills','🎮 Fun','💊 Health','📦 Other'];
const KEY='kaksa_v1', SYNC='kaksa_sync';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ymd=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const today=()=>ymd(new Date());
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);

let S=JSON.parse(localStorage.getItem(KEY)||'null')||{entries:[],payments:[],people:[],settings:{rate:4100,cycleDay:15,disp:'KHR',lockedBefore:null},dayLocks:{},updated:0};
function fix(){S.dayLocks=S.dayLocks||{};S.settings=Object.assign({rate:4100,cycleDay:15,disp:'KHR',lockedBefore:null},S.settings||{})}
fix();
let sync=JSON.parse(localStorage.getItem(SYNC)||'{}');
let form={kind:'me',cur:'KHR',cat:CATS[0],people:[]}, cOff=0, charts={};

/* ---------- money helpers ---------- */
const rate=()=>+S.settings.rate||4100;
const toKHR=(a,c)=>c==='USD'?a*rate():a;
const fmt=k=>S.settings.disp==='USD'?'$'+(k/rate()).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}):'៛'+Math.round(k).toLocaleString();
const orig=(a,c)=>c==='USD'?'$'+(+a).toFixed(2):'៛'+Math.round(a).toLocaleString();
const mine=e=>e.kind==='me'?toKHR(e.amt,e.cur):e.kind==='split'?toKHR(e.amt,e.cur)/(e.people.length+1):0;
const lent=e=>e.kind==='other'?toKHR(e.amt,e.cur):e.kind==='split'?toKHR(e.amt,e.cur)*e.people.length/(e.people.length+1):0;
const owes=e=>e.kind==='other'?{[e.people[0]]:toKHR(e.amt,e.cur)}:e.kind==='split'?Object.fromEntries(e.people.map(p=>[p,toKHR(e.amt,e.cur)/(e.people.length+1)])):{};

/* ---------- cycle ---------- */
function cycle(off=0){
  const cd=+S.settings.cycleDay||1, n=new Date();
  let m=n.getMonth()-(n.getDate()<cd?1:0)+off;
  const a=new Date(n.getFullYear(),m,cd), b=new Date(n.getFullYear(),m+1,cd);
  b.setDate(b.getDate()-1);
  return {from:ymd(a),to:ymd(b)};
}
const inRange=(d,r)=>d>=r.from&&d<=r.to;
const nice=d=>new Date(d+'T00:00').toLocaleDateString(undefined,{day:'numeric',month:'short'});

/* ---------- save / render ---------- */
function save(push=true){
  S.updated=Date.now(); localStorage.setItem(KEY,JSON.stringify(S));
  render(); if(push) queuePush();
}
function toast(t){const e=$('#toast');e.textContent=t;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),1800)}
/* A day is locked if: you locked it by hand, or auto-lock is on and it is
   before the lock start date, or it is past 1:00 AM of the next day.
   Unlocking a day by hand keeps it open until you lock it again. */
const lockAt=d=>{const x=new Date(d+'T01:00');x.setDate(x.getDate()+1);return x};
function isLocked(d){
  if(d in S.dayLocks) return S.dayLocks[d];
  const lb=S.settings.lockedBefore; if(!lb) return false;
  return d<lb||new Date()>=lockAt(d);
}

function render(){
  const r=cycle(cOff);
  $('#cycleLabel').textContent=`${nice(r.from)} → ${nice(r.to)}`+(cOff?'':' · this cycle');
  const es=S.entries.filter(e=>inRange(e.date,r));
  $('#sMine').textContent=fmt(es.reduce((s,e)=>s+mine(e),0));
  $('#sLent').textContent=fmt(es.reduce((s,e)=>s+lent(e),0));
  $('#sOwed').textContent=fmt(Object.values(balances()).reduce((s,v)=>s+Math.max(v,0),0));
  renderForm(); renderHist(); renderOwed(); renderSettings(); renderLocks();
  if($('#tab-chart').classList.contains('on')) renderCharts();
}

/* ---------- add form ---------- */
function renderForm(){
  $$('#kind button').forEach(b=>b.classList.toggle('on',b.dataset.k===form.kind));
  $$('#cur button').forEach(b=>b.classList.toggle('on',b.dataset.c===form.cur));
  $('#cats').innerHTML=CATS.map(c=>`<button class="chip ${c===form.cat?'on':''}" data-c="${c}">${c}</button>`).join('');
  const pb=$('#peopleBox'); pb.hidden=form.kind==='me';
  $('#peopleLabel').textContent=form.kind==='other'?'Who did you pay for?':'Split with who? (you are included automatically)';
  $('#people').innerHTML=S.people.length?S.people.map(p=>`<button class="chip ${form.people.includes(p)?'on':''}" data-p="${esc(p)}">${esc(p)}</button>`).join(''):'<span class="hint">No names yet. Add one below.</span>';
  const a=+$('#amt').value;
  $('#splitHint').textContent=form.kind==='split'&&form.people.length&&a?`Each person pays ${orig(a/(form.people.length+1),form.cur)} (${form.people.length+1} people)`:'';
  const dl=isLocked($('#date').value||today());$('#dayNote').hidden=!dl;$('#saveEntry').disabled=dl;
}
$('#kind').onclick=e=>{const k=e.target.dataset.k;if(k){form.kind=k;form.people=[];renderForm()}};
$('#cur').onclick=e=>{const c=e.target.dataset.c;if(c){form.cur=c;renderForm()}};
$('#cats').onclick=e=>{const c=e.target.dataset.c;if(c){form.cat=c;renderForm()}};
$('#amt').oninput=renderForm;
$('#people').onclick=e=>{
  const p=e.target.dataset.p; if(!p)return;
  if(form.kind==='other') form.people=[p];
  else form.people=form.people.includes(p)?form.people.filter(x=>x!==p):[...form.people,p];
  renderForm();
};
$('#addPerson').onclick=()=>{
  const n=$('#newPerson').value.trim(); if(!n)return;
  if(!S.people.includes(n)) S.people.push(n);
  form.people=form.kind==='other'?[n]:[...new Set([...form.people,n])];
  $('#newPerson').value=''; save();
};
$('#date').max=today(); $('#date').value=today(); $('#date').onchange=renderForm;
$('#saveEntry').onclick=()=>{
  const amt=+$('#amt').value, date=$('#date').value;
  if(!(amt>0)) return toast('Enter an amount');
  if(!date||date>today()) return toast('Pick today or a past day');
  if(isLocked(date)) return toast('🔒 That day is locked');
  if(form.kind!=='me'&&!form.people.length) return toast('Pick at least one person');
  S.entries.push({id:uid(),date,amt,cur:form.cur,cat:form.cat,note:$('#note').value.trim(),kind:form.kind,people:[...form.people]});
  $('#amt').value='';$('#note').value='';form.people=[];
  save(); toast('Saved ✓');
};

/* ---------- history ---------- */
let hCustom=null;
const hRange=()=>hCustom||cycle(cOff);
function renderHist(){
  const r=hRange();
  if(document.activeElement.id!=='hFrom')$('#hFrom').value=r.from;
  if(document.activeElement.id!=='hTo')$('#hTo').value=r.to;
  const es=S.entries.filter(e=>inRange(e.date,r)).sort((a,b)=>b.date.localeCompare(a.date));
  $('#hTotal').textContent=`${es.length} entries · I spent ${fmt(es.reduce((s,e)=>s+mine(e),0))} · lent ${fmt(es.reduce((s,e)=>s+lent(e),0))}`;
  if(!es.length){$('#histList').innerHTML='<div class="card"><p class="hint">Nothing in this range. Pick other dates or add spending from the Add tab.</p></div>';return}
  let h='',last='';
  es.forEach(e=>{
    const lk=isLocked(e.date);
    if(e.date!==last){last=e.date;h+=`<div class="day">${lk?'🔒 ':''}${new Date(e.date+'T00:00').toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'short'})}</div>`}
    const who=e.kind==='other'?`Paid for ${esc(e.people[0])}`:e.kind==='split'?`Split with ${e.people.map(esc).join(', ')}`:'Just me';
    h+=`<div class="item"><div class="l"><span>${e.cat}</span><span class="tag">${who}${e.note?' · '+esc(e.note):''}</span></div>
      <div class="r"><b>${orig(e.amt,e.cur)}</b>${e.kind!=='me'?`<span class="tag">my share ${fmt(mine(e))}</span>`:''}
      ${lk?'':`<button class="btn danger small" data-del="${e.id}">Delete</button>`}</div></div>`;
  });
  $('#histList').innerHTML=`<div class="card" style="gap:0">${h}</div>`;
}
$('#histList').onclick=e=>{
  const id=e.target.dataset.del; if(!id)return;
  const x=S.entries.find(y=>y.id===id); if(!x||isLocked(x.date))return toast('🔒 That day is locked');
  if(confirm('Delete this entry?')){S.entries=S.entries.filter(y=>y.id!==id);save()}
};
const setH=(f,t)=>{hCustom={from:f,to:t};renderHist()};
$('#hFrom').onchange=$('#hTo').onchange=()=>setH($('#hFrom').value||'0000-01-01',$('#hTo').value||'9999-12-31');
$('#hCycle').onclick=()=>{hCustom=null;renderHist()};
$('#hWeek').onclick=()=>{const d=new Date();d.setDate(d.getDate()-6);setH(ymd(d),today())};
$('#hAll').onclick=()=>{const ds=S.entries.map(e=>e.date).sort();setH(ds[0]||today(),today())};

/* ---------- owed ---------- */
function balances(){
  const b={};
  S.entries.forEach(e=>Object.entries(owes(e)).forEach(([p,v])=>b[p]=(b[p]||0)+v));
  S.payments.forEach(p=>b[p.person]=(b[p.person]||0)-toKHR(p.amt,p.cur));
  return b;
}
function renderOwed(){
  const b=balances(), names=Object.keys(b);
  if(!names.length){$('#owedList').innerHTML='<div class="card"><p class="hint">No one owes you anything yet. Use "Paid for someone" or "Split" when adding.</p></div>';return}
  $('#owedList').innerHTML=names.sort((a,c)=>b[c]-b[a]).map(n=>{
    const v=b[n];
    return `<div class="card"><div class="person"><div><b>${esc(n)}</b><br><span class="${v>0.5?'gold':'jade'}">${v>0.5?'owes you '+fmt(v):'all settled'}</span></div>
    <div class="row"><button class="btn ghost small" data-rec="${esc(n)}">Receipt</button>
    ${v>0.5?`<button class="btn small" data-pay="${esc(n)}">Got paid</button>`:''}</div></div></div>`;
  }).join('');
}
$('#owedList').onclick=e=>{
  if(e.target.dataset.rec) return receipt(e.target.dataset.rec);
  const n=e.target.dataset.pay; if(!n)return;
  const full=balances()[n], d=S.settings.disp;
  const def=d==='USD'?(full/rate()).toFixed(2):Math.round(full);
  const v=parseFloat(prompt(`${n} paid you how much (${d==='USD'?'USD':'riel'})?`,def));
  if(v>0){S.payments.push({id:uid(),date:today(),person:n,amt:v,cur:d});save();toast('Payment recorded ✓')}
};
function receipt(n){
  const rows=[];
  S.entries.forEach(e=>{const v=owes(e)[n];if(v)rows.push({d:e.date,t:`${e.cat}${e.note?' · '+esc(e.note):''}${e.kind==='split'?' (split)':''}`,v})});
  S.payments.filter(p=>p.person===n).forEach(p=>rows.push({d:p.date,t:'Payment received',v:-toKHR(p.amt,p.cur)}));
  rows.sort((a,b)=>a.d.localeCompare(b.d));
  const total=rows.reduce((s,r)=>s+r.v,0);
  $('#sheet').innerHTML=`<h2>Receipt for ${esc(n)}</h2><div class="tag">Printed ${nice(today())} · rate ៛${rate()} = $1</div>
  <table><tr><th>Date</th><th>Item</th><th>Amount</th></tr>${rows.map(r=>`<tr><td>${nice(r.d)}</td><td>${r.t}</td><td>${r.v<0?'−':''}${fmt(Math.abs(r.v))}</td></tr>`).join('')}</table>
  <div class="total"><span>${total>0.5?'Still owed':'Balance'}</span><span>${fmt(Math.max(total,0))}</span></div>
  <div class="btns"><button class="btn" onclick="window.print()">Print / Save PDF</button><button class="btn ghost" onclick="$('#modal').hidden=true">Close</button></div>`;
  $('#modal').hidden=false;
}
$('#modal').onclick=e=>{if(e.target.id==='modal')e.target.hidden=true};

/* ---------- charts ---------- */
$('#cCycle').onclick=()=>{const r=cycle(0);$('#cFrom').value=r.from;$('#cTo').value=r.to;renderCharts()};
$('#cMonth').onclick=()=>{const n=new Date();$('#cFrom').value=ymd(new Date(n.getFullYear(),n.getMonth(),1));$('#cTo').value=ymd(new Date(n.getFullYear(),n.getMonth()+1,0));renderCharts()};
$('#cFrom').onchange=$('#cTo').onchange=renderCharts;
function renderCharts(){
  if(!$('#cFrom').value){const r=cycle(0);$('#cFrom').value=r.from;$('#cTo').value=r.to}
  const r={from:$('#cFrom').value,to:$('#cTo').value};
  const es=S.entries.filter(e=>inRange(e.date,r));
  const usd=S.settings.disp==='USD', conv=k=>usd?k/rate():k;
  const days={}, cats={};
  for(let d=new Date(r.from+'T00:00');ymd(d)<=r.to;d.setDate(d.getDate()+1)) days[ymd(d)]=0;
  es.forEach(e=>{days[e.date]=(days[e.date]||0)+mine(e);cats[e.cat]=(cats[e.cat]||0)+mine(e)});
  $('#cTotal').textContent=`My spending in this range: ${fmt(Object.values(days).reduce((a,b)=>a+b,0))}`;
  Object.values(charts).forEach(c=>c.destroy());
  if(typeof Chart==='undefined')return;
  Chart.defaults.color='#9a92b5';
  charts.b=new Chart($('#barChart'),{type:'bar',data:{labels:Object.keys(days).map(nice),datasets:[{label:'Per day',data:Object.values(days).map(conv),backgroundColor:'#f5b942',borderRadius:6}]},options:{plugins:{legend:{display:false}},scales:{y:{grid:{color:'#2f2947'}},x:{grid:{display:false}}}}});
  const pal=['#f5b942','#3ddc97','#ff6b81','#7aa2ff','#c58bff','#ff9f5a','#5ee0e0','#b0a8c9'];
  charts.p=new Chart($('#pieChart'),{type:'doughnut',data:{labels:Object.keys(cats),datasets:[{data:Object.values(cats).map(conv),backgroundColor:pal,borderColor:'#1e1a2e'}]},options:{plugins:{legend:{position:'bottom'}}}});
}

/* ---------- settings / lock / tabs ---------- */
function renderSettings(){
  $$('#dispSeg button').forEach(b=>b.classList.toggle('on',b.dataset.c===S.settings.disp));
  if(document.activeElement.id!=='rate')$('#rate').value=S.settings.rate;
  if(document.activeElement.id!=='cycleDay')$('#cycleDay').value=S.settings.cycleDay;
  if(document.activeElement.id!=='gToken')$('#gToken').value=sync.token||'';if(document.activeElement.id!=='gId')$('#gId').value=sync.id||'';
}
$('#dispSeg').onclick=e=>{const c=e.target.dataset.c;if(c){S.settings.disp=c;save()}};
$('#saveSet').onclick=()=>{S.settings.rate=+$('#rate').value||4100;S.settings.cycleDay=Math.min(28,Math.max(1,+$('#cycleDay').value||1));cOff=0;save();toast('Settings saved ✓')};
/* ---------- day locks ---------- */
let lOff=0;
function renderLocks(){
  const r=cycle(lOff), lb=S.settings.lockedBefore;
  $('#lockMode').textContent=lb?'Auto-lock is on. Each day locks at 1:00 AM the next morning.':'Backfill mode. Every day is open, so you can add past days.';
  $('#lockLabel').textContent=`${nice(r.from)} → ${nice(r.to)}`;
  let h='';
  for(let d=new Date(r.from+'T00:00');ymd(d)<=r.to;d.setDate(d.getDate()+1)){
    const k=ymd(d), l=isLocked(k);
    h+=`<button class="day-cell ${l?'lk':''}" data-d="${k}" ${k>today()?'disabled':''}><b>${d.getDate()}</b><span>${l?'🔒':'🔓'}</span></button>`;
  }
  $('#dayGrid').innerHTML=h;
  $('#finishBack').hidden=!!lb; $('#backMode').hidden=!lb;
}
$('#dayGrid').onclick=e=>{
  const k=e.target.closest('button')?.dataset.d; if(!k)return;
  if(isLocked(k)){if(!confirm(`Unlock ${nice(k)} so it can be changed?`))return;S.dayLocks[k]=false}
  else S.dayLocks[k]=true;
  save();
};
$('#lPrev').onclick=()=>{lOff--;renderLocks()};
$('#lNext').onclick=()=>{if(lOff<0){lOff++;renderLocks()}};
$('#finishBack').onclick=()=>{
  if(!confirm('Lock every day before today? Today locks at 1:00 AM tomorrow. You can still unlock single days.'))return;
  S.settings.lockedBefore=today();
  Object.keys(S.dayLocks).forEach(k=>{if(k<today())delete S.dayLocks[k]});
  save();toast('Past days locked 🔒');
};
$('#backMode').onclick=()=>{
  if(!confirm('Turn auto-lock off and open every day?'))return;
  S.settings.lockedBefore=null;S.dayLocks={};save();
};

$('#prevC').onclick=()=>{cOff--;hCustom=null;render()};
$('#nextC').onclick=()=>{if(cOff<0){cOff++;hCustom=null;render()}};
$('nav').onclick=e=>{
  const b=e.target.closest('button');if(!b)return;
  $$('nav button').forEach(x=>x.classList.toggle('on',x===b));
  $$('.tab').forEach(t=>t.classList.toggle('on',t.id==='tab-'+b.dataset.t));
  if(b.dataset.t==='chart')renderCharts();
};
$('#exp').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(S,null,2)],{type:'application/json'}));a.download=`spending-backup-${today()}.json`;a.click()};
$('#impBtn').onclick=()=>{if(confirm('Importing replaces your current data. Continue?'))$('#imp').click()};
$('#imp').onchange=async e=>{try{S=JSON.parse(await e.target.files[0].text());fix();save();toast('Imported ✓')}catch{toast('Invalid file')}};

/* ---------- GitHub Gist sync ---------- */
const dot=c=>$('#syncDot').className=c;
let pushT;
function queuePush(){if(sync.token&&sync.id){dot('busy');clearTimeout(pushT);pushT=setTimeout(push,1200)}}
const gh=(path,opt={})=>fetch('https://api.github.com'+path,{...opt,headers:{Authorization:'token '+sync.token,Accept:'application/vnd.github+json'}});
async function push(){
  try{
    const body={files:{'spending.json':{content:JSON.stringify(S)}}};
    let r;
    if(!sync.id){r=await gh('/gists',{method:'POST',body:JSON.stringify({description:'Spending tracker data',public:false,...body})});const j=await r.json();sync.id=j.id;localStorage.setItem(SYNC,JSON.stringify(sync))}
    else r=await gh('/gists/'+sync.id,{method:'PATCH',body:JSON.stringify(body)});
    if(!r.ok)throw 0; dot('ok'); $('#syncMsg').textContent='Synced '+new Date().toLocaleTimeString(); renderSettings();
  }catch{dot('err');$('#syncMsg').textContent='Sync failed. Check your token and Gist ID.'}
}
async function pull(){
  if(!sync.token)return;
  if(!sync.id)return push();
  dot('busy');
  try{
    const r=await gh('/gists/'+sync.id);if(!r.ok)throw 0;
    const j=await r.json(), f=j.files['spending.json'];
    const txt=f.truncated?await (await fetch(f.raw_url)).text():f.content;
    const remote=JSON.parse(txt);
    if(remote.updated>S.updated){S=remote;fix();localStorage.setItem(KEY,JSON.stringify(S));render()}
    else if(remote.updated<S.updated) await push();
    dot('ok');
  }catch{dot('err')}
}
$('#saveSync').onclick=()=>{sync={token:$('#gToken').value.trim(),id:$('#gId').value.trim()};localStorage.setItem(SYNC,JSON.stringify(sync));pull().then(()=>toast('Sync saved'))};
document.addEventListener('visibilitychange',()=>{if(!document.hidden)pull()});

$$('input[type=number]').forEach(i=>i.addEventListener('wheel',()=>i.blur()));
render(); pull();
/* re-check locks every minute so days lock themselves at 1 AM */
setInterval(()=>{$('#date').max=today();renderForm();renderHist();renderLocks()},60000);
