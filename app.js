/* ===== Kaksa Spending Tracker ===== */
// $ never returns null, so one missing element can't stop the other buttons from loading
const $=s=>document.querySelector(s)||{style:{},dataset:{},classList:{toggle(){},add(){},remove(){}},addEventListener(){}};
const $$=s=>[...document.querySelectorAll(s)];
const PARK='🅿️ Parking';
const CATS=['🍜 Food','🚕 Transport',PARK,'🏠 Rent','🛍️ Shopping','💡 Bills','🎮 Fun','💊 Health','📦 Other'];
const KEY='kaksa_v1', SYNC='kaksa_sync';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ymd=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const today=()=>ymd(new Date());
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);

let S=JSON.parse(localStorage.getItem(KEY)||'null')||{entries:[],payments:[],people:[],settings:{rate:4100,cycleDay:15,disp:'KHR',lockedBefore:null},dayLocks:{},qrs:[],updated:0};
function fix(){S.dayLocks=S.dayLocks||{};S.deleted=S.deleted||{};S.qrs=S.qrs||[];S.settings=Object.assign({rate:4100,cycleDay:15,disp:'KHR',lockedBefore:null,parkRate:500,qrActive:null,live:true,sep:false},S.settings||{});S.readings=S.readings||[];S.bill=Object.assign({elecPrice:0,waterPrice:0,elecBudget:0,waterBudget:0},S.bill||{});S.bill.starts=Object.assign({'2026-11-15':'2026-11-18'},S.bill.starts||{})}
fix();
let sync=JSON.parse(localStorage.getItem(SYNC)||'{}');
let form={kind:'me',cur:'KHR',cat:CATS[0],people:[]}, cOff=0, charts={};

/* ---------- money helpers ---------- */
const LIVE='kaksa_live';
let liveR=JSON.parse(localStorage.getItem(LIVE)||'null')||{rate:0,at:0}, liveFail=false;
const rate=()=>S.settings.live&&liveR.rate>0?liveR.rate:(+S.settings.rate||4100);
const parkRate=()=>+S.settings.parkRate||500;
const toKHR=(a,c)=>c==='USD'?a*rate():a;
const fmt=k=>S.settings.disp==='USD'?'$'+(k/rate()).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}):'៛'+Math.round(k).toLocaleString();
const orig=(a,c)=>c==='USD'?'$'+(+a).toFixed(2):'៛'+Math.round(a).toLocaleString();
/* kind 'theirs' = someone else paid and I share it. amt = what they paid, n = people sharing (me included),
   share = my own amount if the split is not equal. It counts in MY spending and is DEDUCTED from what they owe me. */
const shareN=e=>e.share>0?+e.share:e.amt/Math.max(1,e.n||2);
const mine=e=>e.kind==='me'?toKHR(e.amt,e.cur):e.kind==='split'?toKHR(e.amt,e.cur)/(e.people.length+1):e.kind==='theirs'?toKHR(shareN(e),e.cur):0;
const lent=e=>e.kind==='other'?toKHR(e.amt,e.cur):e.kind==='split'?toKHR(e.amt,e.cur)*e.people.length/(e.people.length+1):0;
const mineN=e=>e.kind==='me'?e.amt:e.kind==='split'?e.amt/(e.people.length+1):e.kind==='theirs'?shareN(e):0;
const alt=k=>S.settings.disp==='USD'?'៛'+Math.round(k).toLocaleString():'$'+(k/rate()).toFixed(2);
function totals(es){const t={khr:0,usd:0,lent:0};es.forEach(e=>{if(e.cur==='USD')t.usd+=mineN(e);else t.khr+=mineN(e);t.lent+=lent(e)});t.all=t.khr+t.usd*rate();return t}
const owes=e=>e.kind==='other'?{[e.people[0]]:toKHR(e.amt,e.cur)}:e.kind==='split'?Object.fromEntries(e.people.map(p=>[p,toKHR(e.amt,e.cur)/(e.people.length+1)])):e.kind==='theirs'?{[e.people[0]]:-toKHR(shareN(e),e.cur)}:e.kind==='covered'?Object.fromEntries(e.people.map(p=>[p,toKHR(eachCov(e),e.cur)])):{};
const eachCov=e=>e.each>0?+e.each:e.amt/(e.people.length+(e.inc?1:0));
const who=e=>e.kind==='other'?`Paid for ${esc(e.people[0])}`:e.kind==='split'?`Split with ${e.people.map(esc).join(', ')}`:e.kind==='theirs'?`${esc(e.people[0])} paid${(e.n||2)>1?' · shared by '+(e.n||2):''}`:e.kind==='covered'?`Covered${e.from?' by '+esc(e.from):''} · ${e.people.map(esc).join(', ')} pay${e.people.length>1?'':'s'} me`:'Just me';
const shareTags=e=>e.kind==='me'?'':e.kind==='covered'?`<span class="tag gold">${e.people.length>1?'each owes ':'owes me '}${fmt(toKHR(eachCov(e),e.cur))}</span><span class="tag">I do not pay</span>`:`<span class="tag">my share ${fmt(mine(e))}</span>`+(e.kind==='theirs'?`<span class="tag rose">− deducted from ${esc(e.people[0])}</span>`:'');

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
  const t=totals(es);
  $('#sTotal').textContent=fmt(t.all);
  $('#hero').classList.toggle('sep',!!S.settings.sep);
  $('#sTotal').hidden=!!S.settings.sep;
  $('#heroLab').textContent=S.settings.sep?'I spent · riel and USD kept separate':'I spent · total in '+(S.settings.disp==='USD'?'USD':'riel');
  $('#sKHR').textContent='៛ '+Math.round(t.khr).toLocaleString();
  $('#sUSD').textContent='$ '+t.usd.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  $('#sLent').textContent=fmt(t.lent);
  $('#sOwed').textContent=fmt(Object.values(balances()).reduce((s,v)=>s+Math.max(v,0),0));
  const iowe=Object.values(balances()).reduce((s,v)=>s+Math.max(-v,0),0);
  $('#iOweBox').hidden=iowe<=0.5; $('#sIOwe').textContent=fmt(iowe);
  renderForm(); renderHist(); renderOwed(); renderSettings(); renderLocks(); renderQrs();
  if($('#tab-chart').classList.contains('on')) renderCharts();
  if($('#tab-bills').classList.contains('on')&&typeof renderBills==='function') renderBills();
}

/* ---------- add form ---------- */
function renderForm(){
  $$('#kind button').forEach(b=>b.classList.toggle('on',b.dataset.k===form.kind));
  $$('#cur button').forEach(b=>b.classList.toggle('on',b.dataset.c===form.cur));
  $('#cats').innerHTML=CATS.map(c=>`<button class="chip ${c===form.cat?'on':''}" data-c="${c}">${c}</button>`).join('');
  const pb=$('#peopleBox'); pb.hidden=form.kind==='me';
  $('#peopleLabel').textContent=form.kind==='other'?'Who did you pay for?':form.kind==='theirs'?'Who paid?':'Split with who? (you are included automatically)';
  $('#theirBox').hidden=form.kind!=='theirs';
  $('#amt').placeholder=form.kind==='theirs'?'Total amount they paid':'Amount';
  $('#people').innerHTML=S.people.length?S.people.map(p=>`<button class="chip ${form.people.includes(p)?'on':''}" data-p="${esc(p)}">${esc(p)}</button>`).join(''):'<span class="hint">No names yet. Add one below.</span>';
  const park=form.cat===PARK, t=Math.max(1,parseInt($('#pTimes').value)||1);
  $('#parkRow').hidden=!park; $('#amtRow').hidden=park;
  $('#pTotal').textContent=`× ៛${parkRate()} = ៛${(t*parkRate()).toLocaleString()}`;
  const a=park?t*parkRate():+$('#amt').value, cu=park?'KHR':form.cur;
  $('#splitHint').textContent=form.kind==='split'&&form.people.length&&a?`Each person pays ${orig(a/(form.people.length+1),cu)} (${form.people.length+1} people)`:'';
  if(form.kind==='theirs'){
    const n=Math.max(1,parseInt($('#nPeople').value)||2), sh=+$('#myShare').value, share=sh>0?sh:(a?a/n:0), pn=form.people[0];
    let t='';
    if(a&&share>a+0.001)t='My share cannot be more than the total they paid.';
    else if(a){
      t=`My share is ${orig(share,cu)}`+(!(sh>0)&&n>1?` (${orig(a,cu)} ÷ ${n} people)`:'')+'.';
      if(pn){const bal=breakdown(pn).bal, after=bal-toKHR(share,cu), say=v=>v>0.5?`${pn} owes you ${fmt(v)}`:v<-0.5?`you owe ${pn} ${fmt(-v)}`:`${pn} owes you nothing`;t+=` Now: ${say(bal)}. After this: ${say(after)}.`}
    }
    $('#theirHint').textContent=t;
  }
  const dl=isLocked($('#date').value||today());$('#dayNote').hidden=!dl;$('#saveEntry').disabled=dl;
}
$('#kind').onclick=e=>{const k=e.target.dataset.k;if(k){form.kind=k;form.people=[];renderForm()}};
$('#cur').onclick=e=>{const c=e.target.dataset.c;if(c){form.cur=c;renderForm()}};
$('#cats').onclick=e=>{const c=e.target.dataset.c;if(c){form.cat=c;renderForm()}};
$('#amt').oninput=renderForm;
$('#nPeople').oninput=$('#myShare').oninput=renderForm;
$('#nMinus').onclick=()=>{$('#nPeople').value=Math.max(1,(parseInt($('#nPeople').value)||2)-1);renderForm()};
$('#nPlus').onclick=()=>{$('#nPeople').value=(parseInt($('#nPeople').value)||2)+1;renderForm()};
$('#pTimes').oninput=renderForm;
$('#pMinus').onclick=()=>{$('#pTimes').value=Math.max(1,(parseInt($('#pTimes').value)||1)-1);renderForm()};
$('#pPlus').onclick=()=>{$('#pTimes').value=(parseInt($('#pTimes').value)||1)+1;renderForm()};
$('#people').onclick=e=>{
  const p=e.target.dataset.p; if(!p)return;
  if(form.kind==='other'||form.kind==='theirs') form.people=[p];
  else form.people=form.people.includes(p)?form.people.filter(x=>x!==p):[...form.people,p];
  renderForm();
};
$('#addPerson').onclick=()=>{
  const n=$('#newPerson').value.trim(); if(!n)return;
  if(!S.people.includes(n)) S.people.push(n);
  form.people=form.kind==='other'||form.kind==='theirs'?[n]:[...new Set([...form.people,n])];
  $('#newPerson').value=''; save();
};
$('#date').max=today(); $('#date').value=today(); $('#date').onchange=renderForm;
$('#saveEntry').onclick=()=>{
  const park=form.cat===PARK, times=Math.max(1,parseInt($('#pTimes').value)||1), amt=park?times*parkRate():+$('#amt').value, date=$('#date').value;
  if(!(amt>0)) return toast('Enter an amount');
  if(!date||date>today()) return toast('Pick today or a past day');
  if(isLocked(date)) return toast('🔒 That day is locked');
  if(form.kind!=='me'&&!form.people.length) return toast(form.kind==='theirs'?'Pick who paid':'Pick at least one person');
  const e={id:uid(),date,amt,cur:park?'KHR':form.cur,cat:form.cat,note:(park?`${times}× parking`+($('#note').value.trim()?' · ':''):'')+$('#note').value.trim(),kind:form.kind,people:[...form.people]};
  if(form.kind==='theirs'){
    e.n=Math.max(1,parseInt($('#nPeople').value)||2);
    const sh=+$('#myShare').value; if(sh>0){ if(sh>amt+0.001) return toast('My share cannot be more than the total'); e.share=sh }
  }
  S.entries.push(e);
  $('#amt').value='';$('#note').value='';$('#pTimes').value=1;$('#myShare').value='';$('#nPeople').value=2;form.people=[];
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
  const t=totals(es);$('#hTotal').textContent=`${es.length} entries · I spent ${fmt(t.all)} (៛${Math.round(t.khr).toLocaleString()} + $${t.usd.toFixed(2)}) · lent ${fmt(t.lent)}`;
  if(!es.length){$('#histList').innerHTML='<div class="card"><p class="hint">Nothing in this range. Pick other dates or add spending from the Add tab.</p></div>';return}
  let h='',last='';
  es.forEach(e=>{
    const lk=isLocked(e.date);
    if(e.date!==last){last=e.date;h+=`<div class="day">${lk?'🔒 ':''}${new Date(e.date+'T00:00').toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'short'})}</div>`}
    h+=`<div class="item"><div class="l"><span>${e.cat}</span><span class="tag">${who(e)}${e.note?' · '+esc(e.note):''}</span></div>
      <div class="r"><b>${orig(e.amt,e.cur)}</b>${shareTags(e)}
      ${lk?'':`<button class="btn danger small" data-del="${e.id}">Delete</button>`}</div></div>`;
  });
  $('#histList').innerHTML=`<div class="card" style="gap:0">${h}</div>`;
}
$('#histList').onclick=e=>{
  const id=e.target.dataset.del; if(!id)return;
  const x=S.entries.find(y=>y.id===id); if(!x||isLocked(x.date))return toast('🔒 That day is locked');
  if(confirm('Delete this entry?')){S.entries=S.entries.filter(y=>y.id!==id);S.deleted[id]=Date.now();save()}
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
/* everything about one person: lent to them, deducted (what they paid that I share), paid to me, paid by me to them.
   bal > 0 = they owe me, bal < 0 = I owe them. */
function breakdown(n){
  let lent=0,ded=0,paid=0,back=0; const dedRows=[];
  S.entries.forEach(e=>{const v=owes(e)[n];if(v>0)lent+=v;else if(v<0){ded+=-v;dedRows.push(e)}});
  S.payments.filter(p=>p.person===n).forEach(p=>{const k=toKHR(p.amt,p.cur);if(k>=0)paid+=k;else back+=-k});
  return {lent,ded,paid,back,dedRows,bal:lent-ded-paid+back};
}
const payTxt=p=>p.amt<0?`You paid them ${orig(-p.amt,p.cur)}`:orig(p.amt,p.cur);
function renderOwed(){
  const b=balances(), names=Object.keys(b);
  if(!names.length){$('#owedList').innerHTML='<div class="card"><p class="hint">No one owes you anything yet. Use "Paid for someone" or "Split" when adding, or "They paid" when someone else paid and you share it. If someone else covered your part, tap the button above.</p></div>';return}
  $('#owedList').innerHTML=names.sort((a,c)=>b[c]-b[a]).map(n=>{
    const v=b[n], d=breakdown(n);
    const parts=[d.lent>0.5?`Lent ${fmt(d.lent)}`:'',d.ded>0.5?`<span class="rose">Deducted −${fmt(d.ded)}</span>`:'',d.paid>0.5?`Paid −${fmt(d.paid)}`:'',d.back>0.5?`You paid them ${fmt(d.back)}`:''].filter(Boolean);
    return `<div class="card tap" data-pay="${esc(n)}"><div class="person"><div><b>${esc(n)}</b><br>
    <span class="${v>0.5?'gold':v<-0.5?'rose':'jade'}">${v>0.5?'owes you '+fmt(v):v<-0.5?'you owe them '+fmt(-v):'all settled ✓'}</span>${Math.abs(v)>0.5?`<br><span class="tag">${alt(Math.abs(v))}</span>`:''}${parts.length&&(d.ded>0.5||d.back>0.5)?`<br><span class="tag">${parts.join(' · ')}</span>`:''}</div>
    <div class="row"><button class="btn ghost small" data-rec="${esc(n)}">Receipt</button>${v>0.5?`<button class="btn small" data-pay="${esc(n)}">Got paid</button>`:v<-0.5?`<button class="btn small" data-pay="${esc(n)}">I paid them</button>`:''}</div></div></div>`;
  }).join('');
}
$('#owedList').onclick=e=>{
  const r=e.target.closest('[data-rec]'); if(r) return receipt(r.dataset.rec);
  const p=e.target.closest('[data-pay]'); if(p) payPopup(p.dataset.pay);
};
function payPopup(n){
  const d=breakdown(n), iOwe=d.bal<-0.5, full=Math.abs(d.bal)>0.5?Math.abs(d.bal):0; let cur=S.settings.disp;
  const pays=S.payments.filter(p=>p.person===n).sort((a,b)=>b.date.localeCompare(a.date));
  const items=S.entries.filter(e=>n in owes(e)).sort((a,b)=>b.date.localeCompare(a.date));
  const line=(l,v,c='')=>v>0.5?`<div class="item"><div class="l"><span>${l}</span></div><div class="r"><b class="${c}">${fmt(v)}</b></div></div>`:'';
  $('#sheet').className='sheet dark';
  $('#sheet').innerHTML=`<h2>${esc(n)}</h2>
  <p class="hint">${iOwe?'You owe them':full>0?'Still owes you':'Nothing owed right now'}</p>
  <div class="big ${iOwe?'rose':''}">${fmt(full)}</div><p class="hint">${alt(full)}</p>
  ${d.ded>0.5?'<div class="day">How this adds up</div>'+line('Lent to them',d.lent)+line('Deducted: what they paid that I share',d.ded,'rose')+line('Paid to me',d.paid)+line('Paid by me to them',d.back):''}
  ${items.length?'<div class="day">Items added for '+esc(n)+'</div>'+items.map(e=>{const v=owes(e)[n];return `<div class="item"><div class="l"><span class="${v<0?'rose':'gold'}">${v<0?'− ':''}${fmt(Math.abs(v))}${v<0?' deducted':''}</span><span class="tag">${nice(e.date)} · ${e.cat}${e.note?' · '+esc(e.note):''} · ${who(e)} · total ${orig(e.amt,e.cur)}</span></div><div class="r">${isLocked(e.date)?'<span class="tag">🔒</span>':`<button class="btn danger small" data-delentry="${e.id}">Delete</button>`}</div></div>`}).join(''):''}
  <div class="day">${iOwe?'I paid them back':'Got paid'}</div>
  <div class="seg" id="pc"><button data-c="KHR">៛ Riel</button><button data-c="USD">$ USD</button></div>
  <input id="pamt" type="number" inputmode="decimal" step="any" placeholder="${iOwe?'How much did you pay them?':'How much did they pay?'}">
  <p class="hint" id="pleft"></p>
  <div class="btns">${full>0?`<button class="btn ghost" id="pfull">${iOwe?'Pay in full':'Paid in full'}</button>`:''}<button class="btn" id="psave">Save payment</button></div>
  ${pays.length?'<div class="day">Payments so far</div>'+pays.map(p=>`<div class="item"><div class="l"><span>${payTxt(p)}</span><span class="tag">${nice(p.date)}</span></div><div class="r"><button class="btn danger small" data-undo="${p.id}">Undo</button></div></div>`).join(''):''}
  <div class="btns" style="margin-top:14px"><button class="btn ghost" id="pclose">Close</button></div>`;
  $('#modal').hidden=false;
  const upd=()=>{
    $$('#pc button').forEach(b=>b.classList.toggle('on',b.dataset.c===cur));
    const a=+$('#pamt').value||0, left=full-toKHR(a,cur);
    $('#pleft').textContent=!a?'':left>0.5?`Remaining after this: ${fmt(left)} (${alt(left)})`:left<-0.5?`That is ${fmt(-left)} more than ${iOwe?'you owe':'they owe'}`:'This settles everything ✓';
  };
  upd();
  $('#pc').onclick=e=>{if(e.target.dataset.c){cur=e.target.dataset.c;upd()}};
  $('#pamt').oninput=upd;
  $('#pamt').addEventListener('wheel',e=>e.target.blur());
  if(full>0)$('#pfull').onclick=()=>{$('#pamt').value=cur==='USD'?(full/rate()).toFixed(2):Math.round(full);upd()};
  $('#psave').onclick=()=>{
    const a=+$('#pamt').value; if(!(a>0))return toast(iOwe?'Enter how much you paid':'Enter how much they paid');
    S.payments.push({id:uid(),date:today(),person:n,amt:iOwe?-a:a,cur});save();toast('Payment saved ✓');payPopup(n);
  };
  $('#pclose').onclick=()=>$('#modal').hidden=true;
  $('#sheet').onclick=e=>{
    const id=e.target.dataset.undo, de=e.target.dataset.delentry;
    if(id&&confirm('Undo this payment?')){S.payments=S.payments.filter(p=>p.id!==id);S.deleted[id]=Date.now();save();payPopup(n)}
    if(de){
      const x=S.entries.find(y=>y.id===de); if(!x)return;
      if(isLocked(x.date))return toast('🔒 That day is locked');
      if(confirm('Delete this item? It is also removed from your history and totals.')){
        S.entries=S.entries.filter(y=>y.id!==de);S.deleted[de]=Date.now();save();toast('Deleted');
        if(n in balances())payPopup(n);else $('#modal').hidden=true;
      }
    }
  };
}

/* ---------- receipts (print, save as PDF, or download) ---------- */
const RCSS="body{font:15px system-ui,sans-serif;background:#fbf8f1;color:#221c14;margin:0}.sheet{max-width:520px;margin:auto;padding:22px}h2{margin:0 0 2px}table{width:100%;border-collapse:collapse;margin:14px 0;font-size:.9rem}td,th{padding:7px 4px;border-bottom:1px dashed #c9bfa8;text-align:left}td:last-child,th:last-child{text-align:right}.line{display:flex;justify-content:space-between;padding:3px 0}.total{font-size:1.4rem;font-weight:800;display:flex;justify-content:space-between;margin:10px 0}.tag{color:#7a705c;font-size:.8rem}.qr{display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px;margin-top:16px}.qr img{width:min(100%,320px);border-radius:12px}";
function showReceipt(inner,title,extra=''){
  $('#sheet').className='sheet'; $('#sheet').onclick=null;
  $('#sheet').innerHTML=inner+extra+'<div class="btns"><button class="btn" id="rPrint">Save as PNG</button><button class="btn ghost" id="rDl">Download</button><button class="btn ghost" id="rClose">Close</button></div>';
  $('#modal').hidden=false;
  $('#rPrint').onclick=()=>savePng(inner,title);
  $('#rClose').onclick=()=>$('#modal').hidden=true;
  $('#rDl').onclick=()=>{
    const doc=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${RCSS}</style></head><body><div class="sheet">${inner}</div></body></html>`;
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([doc],{type:'text/html'}));a.download=title.replace(/[^\w-]+/g,'_')+'.html';a.click();
  };
}
function receipt(n,qid){
  const rows=[];
  S.entries.forEach(e=>{const v=owes(e)[n];if(!v)return;
    if(v>0)rows.push({d:e.date,k:'owe',t:`${e.cat}${e.note?' · '+esc(e.note):''}${e.kind==='split'?' (split)':e.kind==='covered'?' (your share of '+orig(e.amt,e.cur)+(e.each>0?'':', split '+(e.people.length+(e.inc?1:0))+' ways')+')':''}`,v});
    else rows.push({d:e.date,k:'ded',t:`Deducted · you paid ${orig(e.amt,e.cur)} for ${e.cat}${e.note?' · '+esc(e.note):''}${(e.n||2)>1&&!(e.share>0)?' (my share, split '+(e.n||2)+' ways)':' (my share)'}`,v})});
  S.payments.filter(p=>p.person===n).forEach(p=>{const k=toKHR(p.amt,p.cur);
    rows.push(k>=0?{d:p.date,k:'pay',t:`Payment received · ${orig(p.amt,p.cur)}`,v:-k}:{d:p.date,k:'back',t:`I paid you · ${orig(-p.amt,p.cur)}`,v:-k})});
  rows.sort((a,b)=>a.d.localeCompare(b.d));
  const sum=k=>rows.filter(r=>r.k===k).reduce((s,r)=>s+Math.abs(r.v),0);
  const owed=sum('owe'), ded=sum('ded'), paid=sum('pay'), back=sum('back'), left=owed-ded-paid+back;
  const q=qid==='none'?null:S.qrs.find(x=>x.id===(qid||S.settings.qrActive));
  const qr=q&&left>0.5?`<div class="qr"><img src="${q.img}" alt="Payment QR"><div><b>Scan to pay</b><br>${esc(q.name)}<br>${esc(q.note||'')}<br><span class="tag">Type the amount when you pay</span></div></div>`:'';
  const qcur=q?q.id:'none';
  const chips=S.qrs.length&&left>0.5?`<div class="chips noprint" style="margin-top:12px">${S.qrs.map(x=>`<button class="chip ${x.id===qcur?'on':''}" data-qr="${x.id}">${esc(x.name)}</button>`).join('')}<button class="chip ${qcur==='none'?'on':''}" data-qr="none">No QR</button></div>`:'';
  showReceipt(`<h2>Receipt for ${esc(n)}</h2><div class="tag">${nice(today())}</div>
  <table><tr><th>Date</th><th>Item</th><th>Amount</th></tr>${rows.map(r=>`<tr><td>${nice(r.d)}</td><td>${r.t}</td><td>${r.v<0?'−':''}${fmt(Math.abs(r.v))}</td></tr>`).join('')}</table>
  <div class="line"><span>Total owed</span><span>${fmt(owed)}</span></div>
  ${ded>0.5?`<div class="line"><span>Deducted (what you paid for me)</span><span>− ${fmt(ded)}</span></div>`:''}
  <div class="line"><span>Paid so far</span><span>− ${fmt(paid)}</span></div>
  ${back>0.5?`<div class="line"><span>I paid you</span><span>+ ${fmt(back)}</span></div>`:''}
  <div class="total"><span>${left>0.5?'Still owed':left<-0.5?'I owe you':'All settled ✓'}</span><span>${fmt(Math.abs(left)>0.5?Math.abs(left):0)}</span></div>
  ${left>0.5?`<div class="tag">${alt(left)}</div>`:''}${qr}`,'Receipt-'+n,chips);
  $('#sheet').onclick=e=>{const id=e.target.dataset.qr;if(id)receipt(n,id)};
}
function spendReceipt(){
  const r=hRange(), lab=x=>/^(0000|9999)/.test(x)?'…':nice(x);
  const es=S.entries.filter(e=>inRange(e.date,r)).sort((a,b)=>a.date.localeCompare(b.date)), t=totals(es);
  showReceipt(`<h2>My spending</h2><div class="tag">${lab(r.from)} → ${lab(r.to)}</div>
  <table><tr><th>Date</th><th>Item</th><th>My share</th></tr>${es.map(e=>`<tr><td>${nice(e.date)}</td><td>${e.cat}${e.note?' · '+esc(e.note):''}${e.kind==='other'?' (paid for '+esc(e.people[0])+')':e.kind==='split'?' (split, total '+orig(e.amt,e.cur)+')':e.kind==='theirs'?' ('+esc(e.people[0])+' paid '+orig(e.amt,e.cur)+', my share)':e.kind==='covered'?' (covered'+(e.from?' by '+esc(e.from):'')+', owed to me)':''}</td><td>${e.kind==='other'||e.kind==='covered'?'−':orig(mineN(e),e.cur)}</td></tr>`).join('')}</table>
  <div class="line"><span>Spent in riel</span><span>៛${Math.round(t.khr).toLocaleString()}</span></div>
  <div class="line"><span>Spent in USD</span><span>$${t.usd.toFixed(2)}</span></div>
  <div class="line"><span>Lent to others</span><span>${fmt(t.lent)}</span></div>
  <div class="total"><span>Total spent</span><span>${fmt(t.all)}</span></div>`,`Spending-${r.from}-to-${r.to}`);
}
$('#hRec').onclick=spendReceipt;
/* ---------- save receipt as a PNG picture (shares on phones, downloads on PC) ---------- */
const loadH2C=()=>window.html2canvas?Promise.resolve():new Promise((ok,no)=>{
  const add=(u,fail)=>{const t=document.createElement('script');t.src=u;t.onload=ok;t.onerror=fail;document.head.appendChild(t)};
  add('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',()=>add('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',no));
});
async function savePng(inner,title){
  toast('Making picture…');
  let box;
  try{
    await loadH2C();
    if(document.fonts&&document.fonts.ready)await document.fonts.ready;
    box=document.createElement('div');box.className='sheet';
    box.style.cssText='position:absolute;left:-9999px;top:0;width:520px;max-width:none;max-height:none;border-radius:0;overflow:visible';
    box.innerHTML=inner;document.body.appendChild(box);
    const cv=await html2canvas(box,{scale:2,backgroundColor:'#fbf8f1',useCORS:true});
    const blob=await new Promise(r=>cv.toBlob(r,'image/png'));
    const name=title.replace(/[^\w-]+/g,'_')+'.png', file=new File([blob],name,{type:'image/png'});
    if(navigator.canShare&&navigator.canShare({files:[file]})){
      try{await navigator.share({files:[file],title});return}catch(e){if(e&&e.name==='AbortError')return}
    }
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();toast('Saved as PNG ✓');
  }catch{toast('Could not make the picture. Check your internet once.')}
  finally{if(box)box.remove()}
}

$('#modal').onclick=e=>{if(e.target.id==='modal')e.target.hidden=true};

/* ---------- charts: tap a day, tap a category, see the full list ---------- */
const PAL=['#f5b942','#3ddc97','#ff6b81','#7aa2ff','#c58bff','#ff9f5a','#5ee0e0','#b0a8c9','#e6e76a'];
const catCol=c=>PAL[Math.max(0,CATS.indexOf(c))%PAL.length];
let chDay=null, chCat=null;
const chReset=()=>{chDay=chCat=null};
const itemName=e=>{
  let n=(e.note||'').trim();
  if(e.cat===PARK) n=n.replace(/^\d+×\s*parking\s*·?\s*/i,'').trim()||'Parking';
  return n||'No note';
};
$('#cCycle').onclick=()=>{const r=cycle(0);$('#cFrom').value=r.from;$('#cTo').value=r.to;chReset();renderCharts()};
$('#cMonth').onclick=()=>{const n=new Date();$('#cFrom').value=ymd(new Date(n.getFullYear(),n.getMonth(),1));$('#cTo').value=ymd(new Date(n.getFullYear(),n.getMonth()+1,0));chReset();renderCharts()};
$('#cFrom').onchange=$('#cTo').onchange=()=>{chReset();renderCharts()};
$('#bdRows').onclick=e=>{const b=e.target.closest('[data-cat]');if(b){chCat=b.dataset.cat;renderCharts(true)}};
$('#bdCrumbs').onclick=e=>{const b=e.target.closest('[data-x]');if(!b)return;if(b.dataset.x==='day')chDay=null;else chCat=null;renderCharts(true)};
function renderCharts(still){
  if(!$('#cFrom').value){const r=cycle(0);$('#cFrom').value=r.from;$('#cTo').value=r.to}
  const r={from:$('#cFrom').value,to:$('#cTo').value};
  const all=S.entries.filter(e=>inRange(e.date,r));
  const spent=all.filter(e=>mine(e)>0);
  const usd=S.settings.disp==='USD', conv=k=>usd?k/rate():k;
  const tip=v=>usd?'$'+v.toFixed(2):'៛'+Math.round(v).toLocaleString();
  const days={}, dc={};
  for(let d=new Date(r.from+'T00:00');ymd(d)<=r.to;d.setDate(d.getDate()+1)) days[ymd(d)]=0;
  spent.forEach(e=>{days[e.date]=(days[e.date]||0)+mine(e);const k=e.date+'|'+e.cat;dc[k]=(dc[k]||0)+mine(e)});
  if(chDay&&!(chDay in days))chDay=null;
  const dayKeys=Object.keys(days);
  $('#cTotal').textContent=`My spending in this range: ${fmt(Object.values(days).reduce((a,b)=>a+b,0))}`;

  /* overview numbers + trend maths */
  const addD=(d,n)=>{const x=new Date(d+'T00:00');x.setDate(x.getDate()+n);return ymd(x)};
  const N=dayKeys.length, td=today(), idxT=dayKeys.filter(d=>d<=td).length-1, elapsed=idxT+1;
  const dayVals=dayKeys.map(d=>days[d]);
  const total=dayVals.slice(0,elapsed).reduce((a,b)=>a+b,0), avgD=elapsed?total/elapsed:0;
  const pFrom=addD(r.from,-N), pd={};
  S.entries.filter(e=>inRange(e.date,{from:pFrom,to:addD(r.from,-1)})&&mine(e)>0).forEach(e=>{pd[e.date]=(pd[e.date]||0)+mine(e)});
  const prevVals=dayKeys.map((_,i)=>pd[addD(pFrom,i)]||0);
  const prevTo=prevVals.slice(0,elapsed).reduce((a,b)=>a+b,0);
  const delta=prevTo>0?(total/prevTo-1)*100:null;
  const projected=elapsed&&N>elapsed?avgD*N:total;
  const cs={};spent.forEach(e=>{cs[e.cat]=(cs[e.cat]||0)+mine(e)});
  const csT=Object.values(cs).reduce((a,b)=>a+b,0), topC=Object.entries(cs).sort((a,b)=>b[1]-a[1])[0];
  const topD=dayKeys.reduce((a,d)=>days[d]>(days[a]||0)?d:a,dayKeys[0]);
  $('#kpis').innerHTML=`
    <div class="tile kpi"><small>Total spent</small><b>${fmt(total)}</b><span class="tag">${elapsed} of ${N} days</span></div>
    <div class="tile kpi"><small>Daily average</small><b>${fmt(avgD)}</b><span class="tag">${fmt(avgD*30)} per 30 days</span></div>
    <div class="tile kpi"><small>Projected total</small><b>${fmt(projected)}</b><span class="tag">${N>elapsed?'by '+nice(r.to):'range complete'}</span></div>
    <div class="tile kpi"><small>vs previous ${N} days</small><b class="${delta===null?'':delta>0?'up':'down'}">${delta===null?'—':(delta>0?'▲ +':'▼ −')+Math.abs(delta).toFixed(0)+'%'}</b><span class="tag">${prevTo?fmt(prevTo)+' before':'no earlier data'}</span></div>
    <div class="tile kpi"><small>Top category</small><b>${topC?esc(topC[0]):'—'}</b><span class="tag">${topC&&csT?Math.round(topC[1]/csT*100)+'% · '+fmt(topC[1]):' '}</span></div>
    <div class="tile kpi"><small>Biggest day</small><b>${topD&&days[topD]>0?nice(topD):'—'}</b><span class="tag">${topD&&days[topD]>0?fmt(days[topD]):' '}</span></div>`;
  const wsum=Array(7).fill(0), wcnt=Array(7).fill(0), WD=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  dayKeys.forEach((d,i)=>{if(i>idxT)return;const w=(new Date(d+'T00:00').getDay()+6)%7;wsum[w]+=days[d];wcnt[w]++});
  const wavgK=wsum.map((s,i)=>wcnt[i]?s/wcnt[i]:0), wTop=wavgK.indexOf(Math.max(...wavgK));
  $('#wkNote').textContent=Math.max(...wavgK)>0?`You spend the most on ${['Mondays','Tuesdays','Wednesdays','Thursdays','Fridays','Saturdays','Sundays'][wTop]} (about ${fmt(wavgK[wTop])} a day)`:'Average spend for each day of the week';

  /* breakdown: categories, or (after tapping a category) the things you used in it */
  const groups={};
  spent.filter(e=>(!chDay||e.date===chDay)&&(!chCat||e.cat===chCat)).forEach(e=>{
    const k=chCat?itemName(e).toLowerCase():e.cat;
    const g=groups[k]||(groups[k]={name:chCat?itemName(e):e.cat,v:0,n:0,cat:e.cat});
    g.v+=mine(e);g.n++;
  });
  const rows=Object.values(groups).sort((a,b)=>b.v-a.v), tot=rows.reduce((s,g)=>s+g.v,0);
  rows.forEach((g,i)=>g.col=chCat?PAL[i%PAL.length]:catCol(g.cat));
  const longDay=d=>new Date(d+'T00:00').toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'short'});
  $('#bdScope').textContent=chDay?longDay(chDay):'Whole range';
  $('#bdTitle').textContent=chCat?`${chCat} · what you used`:'Where it went';
  $('#bdCrumbs').innerHTML=(chDay?`<button class="crumb" data-x="day">📅 ${nice(chDay)}</button>`:'')+(chCat?`<button class="crumb" data-x="cat">${esc(chCat)}</button>`:'');
  $('#donut').hidden=!rows.length;
  $('#dcTotal').textContent=fmt(tot);
  $('#dcLab').textContent=chCat?chCat:chDay?'that day':'total';
  $('#bdRows').innerHTML=rows.length?rows.map(g=>{
    const pct=tot?Math.round(g.v/tot*100):0;
    const inner=`<i class="fill" style="width:${pct}%;background:${g.col}"></i><span class="dot" style="background:${g.col}"></span><span class="nm">${esc(g.name)}<small>${g.n}×</small></span><span class="am">${fmt(g.v)}</span><span class="pc">${pct}%</span>`;
    return chCat?`<div class="bd">${inner}</div>`:`<button class="bd" data-cat="${esc(g.name)}">${inner}</button>`;
  }).join('')+(chCat?'':'<p class="hint" style="text-align:center">Tap a category to see exactly what you used</p>'):'<p class="hint" style="text-align:center">Nothing spent here.</p>';

  /* full list for the current selection */
  const lst=all.filter(e=>(!chDay||e.date===chDay)&&(!chCat||e.cat===chCat)).sort((a,b)=>b.date.localeCompare(a.date));
  $('#listTitle').textContent=`${chCat||(chDay?nice(chDay):'All spending')} · ${lst.length} ${lst.length===1?'entry':'entries'}`;
  let h='',last='';
  lst.forEach(e=>{
    if(e.date!==last){last=e.date;h+=`<div class="day">${longDay(e.date)}</div>`}
    h+=`<div class="item"><div class="l"><span><span class="dot" style="background:${catCol(e.cat)}"></span> ${e.cat}</span><span class="tag">${who(e)}${e.note?' · '+esc(e.note):''}</span></div>
      <div class="r"><b>${orig(e.amt,e.cur)}</b>${shareTags(e)}</div></div>`;
  });
  $('#chList').innerHTML=h||'<p class="hint">Nothing in this range.</p>';

  Object.values(charts).forEach(c=>c.destroy()); charts={};
  if(typeof Chart==='undefined')return;
  Chart.defaults.color='#9a92b5';
  const animation={duration:still?0:600};
  const cats=CATS.filter(c=>spent.some(e=>e.cat===c));
  charts.b=new Chart($('#barChart'),{type:'bar',
    data:{labels:dayKeys.map(nice),datasets:cats.map(c=>({label:c,data:dayKeys.map(d=>conv(dc[d+'|'+c]||0)),
      backgroundColor:ctx=>(!chDay||dayKeys[ctx.dataIndex]===chDay)?catCol(c):catCol(c)+'40',borderRadius:3,borderSkipped:false}))},
    options:{animation,interaction:{mode:'index',intersect:false},
      plugins:{legend:{display:false},tooltip:{filter:i=>i.raw>0,callbacks:{label:i=>`${i.dataset.label}: ${tip(i.raw)}`}}},
      scales:{y:{stacked:true,grid:{color:'#2f2947'}},x:{stacked:true,grid:{display:false},ticks:{maxRotation:0,autoSkip:true}}},
      onHover:(ev,els)=>{if(ev.native&&ev.native.target)ev.native.target.style.cursor=els.length?'pointer':'default'},
      onClick:(ev,_,ch)=>{
        const p=ch.getElementsAtEventForMode(ev,'index',{intersect:false},true); if(!p.length)return;
        const d=dayKeys[p[0].index]; chDay=chDay===d?null:d; chCat=null; renderCharts(true);
        const c=$('#bdCard'); if(c.getBoundingClientRect&&c.getBoundingClientRect().top>innerHeight*.6)c.scrollIntoView({behavior:'smooth',block:'start'});
      }}});
  if(rows.length)charts.p=new Chart($('#pieChart'),{type:'doughnut',
    data:{labels:rows.map(g=>g.name),datasets:[{data:rows.map(g=>conv(g.v)),backgroundColor:rows.map(g=>g.col),borderColor:'#1e1a2e',borderWidth:3,hoverOffset:6}]},
    options:{cutout:'68%',animation,plugins:{legend:{display:false},tooltip:{callbacks:{label:i=>`${i.label}: ${tip(i.raw)}`}}},
      onClick:(ev,_,ch)=>{if(chCat)return;const p=ch.getElementsAtEventForMode(ev,'nearest',{intersect:true},true);if(p.length){chCat=rows[p[0].index].name;renderCharts(true)}}}});

  /* spending trend: daily dots, 7-day average, running total, forecast, previous period */
  const MA=dayVals.map((_,i)=>{if(i>idxT)return null;const sl=dayVals.slice(Math.max(0,i-6),i+1);return conv(sl.reduce((a,b)=>a+b,0)/sl.length)});
  let run=0,prun=0;
  const cum=dayVals.map((v,i)=>{if(i>idxT)return null;run+=v;return conv(run)});
  const pcum=prevVals.map(v=>{prun+=v;return conv(prun)});
  const fc=dayVals.map((_,i)=>idxT>=0&&N>elapsed&&i>=idxT?conv(total+avgD*(i-idxT)):null);
  charts.t=new Chart($('#trendChart'),{type:'line',
    data:{labels:dayKeys.map(nice),datasets:[
      {label:'Daily spend',data:dayVals.map((v,i)=>i<=idxT?conv(v):null),yAxisID:'y',borderColor:'rgba(245,185,66,.4)',backgroundColor:'#f5b942',borderWidth:1.5,pointRadius:2.5,order:4},
      {label:'7-day average',data:MA,yAxisID:'y',borderColor:'#f5b942',borderWidth:3,pointRadius:0,tension:.35,order:3},
      {label:'Running total',data:cum,yAxisID:'y1',borderColor:'#3ddc97',backgroundColor:'rgba(61,220,151,.12)',fill:true,borderWidth:2.5,pointRadius:0,tension:.2,order:2},
      {label:'Forecast',data:fc,yAxisID:'y1',borderColor:'#3ddc97',borderDash:[6,5],borderWidth:2,pointRadius:0,order:1},
      {label:'Previous period',data:pcum,yAxisID:'y1',borderColor:'#9a92b5',borderDash:[2,4],borderWidth:1.5,pointRadius:0,order:5}]},
    options:{animation,interaction:{mode:'index',intersect:false},
      plugins:{legend:{position:'bottom',labels:{boxWidth:12,usePointStyle:true}},tooltip:{filter:i=>i.raw!==null,callbacks:{label:i=>`${i.dataset.label}: ${tip(i.raw)}`}}},
      scales:{y:{position:'left',beginAtZero:true,grid:{color:'#2f2947'},title:{display:true,text:'per day'}},
              y1:{position:'right',beginAtZero:true,grid:{drawOnChartArea:false},title:{display:true,text:'running total'}},
              x:{grid:{display:false},ticks:{maxRotation:0,autoSkip:true}}}}});
  const wv=wavgK.map(conv), wm=Math.max(...wv);
  charts.w=new Chart($('#wkChart'),{type:'bar',
    data:{labels:WD,datasets:[{data:wv,backgroundColor:wv.map(v=>v===wm&&v>0?'#f5b942':'#f5b94255'),borderRadius:8}]},
    options:{animation,plugins:{legend:{display:false},tooltip:{callbacks:{label:i=>'Average: '+tip(i.raw)}}},scales:{y:{beginAtZero:true,grid:{color:'#2f2947'}},x:{grid:{display:false}}}}});
}

/* ---------- settings / lock / tabs ---------- */
function renderSettings(){
  $$('#heroSeg button').forEach(b=>b.classList.toggle('on',(b.dataset.h==='sep')===!!S.settings.sep));
  $('#rateBig').textContent='$1 = ៛'+rate().toLocaleString(undefined,{maximumFractionDigits:2});
  $('#rateSub').textContent=S.settings.live&&liveR.rate>0?'Live rate · updated '+new Date(liveR.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'Manual rate (what the app is using now)';
  $('#manualBox').hidden=!!S.settings.live;
  $$('#rateMode button').forEach(b=>b.classList.toggle('on',(b.dataset.m==='live')===!!S.settings.live));
  $('#liveNow').hidden=!S.settings.live;
  $('#liveMsg').textContent=S.settings.live?(liveR.rate?`⚡ Live: ៛${liveR.rate.toLocaleString(undefined,{maximumFractionDigits:2})} = $1 · updated ${new Date(liveR.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}${liveFail?' (could not refresh, showing the last rate)':''}`:liveFail?'Could not reach the rate service. Using your manual rate for now.':'Getting the live rate…'):`Using your manual rate: ៛${(+S.settings.rate||4100).toLocaleString()} = $1`;
  $$('#dispSeg button').forEach(b=>b.classList.toggle('on',b.dataset.c===S.settings.disp));
  if(document.activeElement.id!=='rate')$('#rate').value=S.settings.rate;
  if(document.activeElement.id!=='parkRate')$('#parkRate').value=S.settings.parkRate;
  if(document.activeElement.id!=='cycleDay')$('#cycleDay').value=S.settings.cycleDay;
  if(document.activeElement.id!=='gToken')$('#gToken').value=sync.token||'';if(document.activeElement.id!=='gId')$('#gId').value=sync.id||'';
}
$('#dispSeg').onclick=e=>{const c=e.target.dataset.c;if(c){S.settings.disp=c;save()}};
$('#saveSet').onclick=()=>{S.settings.parkRate=+$('#parkRate').value||500;S.settings.rate=+$('#rate').value||4100;S.settings.cycleDay=Math.min(28,Math.max(1,+$('#cycleDay').value||1));cOff=0;save();toast('Settings saved ✓')};
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
  if(b.dataset.t==='chart'){renderCharts();renderRateChart()}
  if(b.dataset.t==='bills'&&typeof renderBills==='function')renderBills();
};
$('#exp').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(S,null,2)],{type:'application/json'}));a.download=`spending-backup-${today()}.json`;a.click()};
$('#impBtn').onclick=()=>{if(confirm('Importing replaces your current data. Continue?'))$('#imp').click()};
$('#imp').onchange=async e=>{try{S=JSON.parse(await e.target.files[0].text());fix();save();toast('Imported ✓')}catch{toast('Invalid file')}};

/* ---------- payment QRs (uploaded, saved, switchable) ---------- */
function renderQrs(){
  const act=S.settings.qrActive;
  $('#qrList').innerHTML=S.qrs.length?S.qrs.map(q=>`<div class="qrcard ${q.id===act?'on':''}"><img src="${q.img}" alt=""><div class="l"><b>${esc(q.name)}</b><span class="tag">${esc(q.note||'')}</span></div><div class="r"><button class="btn small ${q.id===act?'':'ghost'}" data-use="${q.id}">${q.id===act?'In use ✓':'Use'}</button><button class="btn danger small" data-qdel="${q.id}">Delete</button></div></div>`).join(''):'<p class="hint">No QR yet. Upload one below and it shows on receipts.</p>';
}
$('#qrList').onclick=e=>{
  const u=e.target.dataset.use, d=e.target.dataset.qdel;
  if(u){S.settings.qrActive=u;save()}
  if(d&&confirm('Delete this QR?')){S.qrs=S.qrs.filter(q=>q.id!==d);S.deleted[d]=Date.now();if(S.settings.qrActive===d)S.settings.qrActive=S.qrs[0]?S.qrs[0].id:null;save()}
};
$('#qrUp').onclick=()=>$('#qrFile').click();
$('#qrFile').onchange=e=>{
  const f=e.target.files[0]; if(!f)return;
  const im=new Image();
  im.onload=()=>{
    const k=Math.min(1,800/Math.max(im.width,im.height)), c=document.createElement('canvas');
    c.width=Math.round(im.width*k);c.height=Math.round(im.height*k);
    const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.drawImage(im,0,0,c.width,c.height);
    const q={id:uid(),name:$('#qName').value.trim()||'QR '+(S.qrs.length+1),note:$('#qNote').value.trim(),img:c.toDataURL('image/jpeg',.88)};
    S.qrs.push(q); if(!S.settings.qrActive)S.settings.qrActive=q.id;
    $('#qName').value='';$('#qNote').value='';e.target.value='';save();toast('QR saved ✓');
  };
  im.onerror=()=>toast('Could not read that image');
  im.src=URL.createObjectURL(f);
};

/* ---------- GitHub Gist sync: merges both devices, never overwrites ---------- */
const dot=c=>$('#syncDot').className=c;
const msg=t=>$('#syncMsg').textContent=t;
const gh=(path,opt={})=>fetch('https://api.github.com'+path,{cache:'no-store',...opt,headers:{Authorization:'token '+sync.token,Accept:'application/vnd.github+json','Content-Type':'application/json'}});
function merge(a,b){
  const del={...(a.deleted||{}),...(b.deleted||{})};
  const union=(x,y)=>{const m={};[...(x||[]),...(y||[])].forEach(i=>{if(!del[i.id])m[i.id]=i});return Object.values(m)};
  const newer=(a.updated||0)>=(b.updated||0)?a:b;
  return {entries:union(a.entries,b.entries),payments:union(a.payments,b.payments),qrs:union(a.qrs,b.qrs),readings:union(a.readings,b.readings),bill:newer.bill||a.bill||b.bill||{},people:[...new Set([...(a.people||[]),...(b.people||[])])],deleted:del,settings:newer.settings,dayLocks:newer.dayLocks||{},updated:Math.max(a.updated||0,b.updated||0)};
}
const sig=x=>[(x.entries||[]).length,(x.payments||[]).length,(x.qrs||[]).length,(x.readings||[]).length,(x.people||[]).length,x.updated||0].join();
const errText=c=>c===401?'Token rejected. Make a new classic token with the gist scope.':c===404?'Gist not found. Check the Gist ID, and that the token is a classic one with the gist scope.':c===403?'GitHub refused the request (rate limit or missing gist scope).':'Could not reach GitHub.';
let syncing=false, again=false, pushT;
function queuePush(){if(sync.token){dot('busy');clearTimeout(pushT);pushT=setTimeout(syncNow,1200)}}
async function syncNow(){
  if(!sync.token)return;
  if(syncing){again=true;return}
  syncing=true;dot('busy');
  try{
    let remote=null;
    if(sync.id){
      const r=await gh('/gists/'+sync.id+'?t='+Date.now());
      if(!r.ok)throw r.status;
      const f=(await r.json()).files['spending.json'];
      if(f)remote=JSON.parse(f.truncated?await(await fetch(f.raw_url,{cache:'no-store'})).text():f.content);
    }
    const m=remote?merge(S,remote):S;
    if(remote&&sig(m)!==sig(S)){S=m;fix();localStorage.setItem(KEY,JSON.stringify(S));render()}
    if(!remote||sig(m)!==sig(remote)){
      const body={files:{'spending.json':{content:JSON.stringify(S)}}};
      const r=sync.id?await gh('/gists/'+sync.id,{method:'PATCH',body:JSON.stringify(body)}):await gh('/gists',{method:'POST',body:JSON.stringify({description:'Spending tracker data',public:false,...body})});
      if(!r.ok)throw r.status;
      if(!sync.id){sync.id=(await r.json()).id;localStorage.setItem(SYNC,JSON.stringify(sync));renderSettings()}
    }
    dot('ok');msg(`Synced ${new Date().toLocaleTimeString()} · ${S.entries.length} entries · Gist ${sync.id.slice(0,7)}…`);
  }catch(c){dot('err');msg(errText(c))}
  syncing=false; if(again){again=false;syncNow()}
}
$('#saveSync').onclick=()=>{sync={token:$('#gToken').value.trim(),id:$('#gId').value.trim()};localStorage.setItem(SYNC,JSON.stringify(sync));syncNow()};
$('#syncNowBtn').onclick=()=>syncNow();
$('#copyGist').onclick=()=>{if(sync.id){navigator.clipboard&&navigator.clipboard.writeText(sync.id);toast('Gist ID copied')}};
document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncNow()});
addEventListener('focus',()=>syncNow()); addEventListener('online',()=>syncNow());
setInterval(()=>{if(!document.hidden)syncNow()},30000);

$$('input[type=number]').forEach(i=>i.addEventListener('wheel',()=>i.blur()));
render(); syncNow();
/* re-check locks every minute so days lock themselves at 1 AM */
setInterval(()=>{$('#date').max=today();renderForm();renderHist();renderLocks()},60000);

/* ---------- hard refresh + "new update" popup ---------- */
const assetUrls=()=>[...document.querySelectorAll('script[src],link[rel=stylesheet]')].map(n=>n.getAttribute('src')||n.getAttribute('href')).filter(u=>!/^https?:/.test(u));
async function hardRefresh(){
  try{if('serviceWorker' in navigator)(await navigator.serviceWorker.getRegistrations()).forEach(r=>r.unregister())}catch{}
  try{if(window.caches)(await caches.keys()).forEach(k=>caches.delete(k))}catch{}
  try{await Promise.all([location.pathname,...assetUrls()].map(u=>fetch(u,{cache:'reload'})))}catch{}
  const u=new URL(location.href);u.searchParams.set('r',Date.now());location.replace(u.toString());
}
$('#hardRefresh').onclick=hardRefresh;
let updShown=false, lastChk=0;
function showUpdate(){
  updShown=true;
  const d=document.createElement('div');d.id='upd';
  d.innerHTML='<span>🔄 A new update is ready</span><button class="btn" id="updNow">Update</button><button class="btn ghost" id="updLater">Later</button>';
  document.body.appendChild(d);
  $('#updNow').onclick=hardRefresh;
  $('#updLater').onclick=()=>d.remove();
}
/* compares the copy this phone has saved with the copy on the server */
async function checkUpdate(){
  if(updShown||!navigator.onLine||Date.now()-lastChk<60000)return;
  lastChk=Date.now();
  try{
    for(const u of [location.pathname,...assetUrls()]){
      const [a,b]=await Promise.all([fetch(u,{cache:'force-cache'}).then(r=>r.text()),fetch(u,{cache:'no-store'}).then(r=>r.text())]);
      if(a!==b){showUpdate();return}
    }
  }catch{}
}
setTimeout(checkUpdate,2000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkUpdate()});

/* ---------- live exchange rate (USD → KHR), refreshed at most once an hour ---------- */
async function liveRate(force){
  if(!S.settings.live)return false;
  if(!force&&liveR.rate&&Date.now()-liveR.at<3600e3)return true;
  const srcs=[
    ['https://open.er-api.com/v6/latest/USD',j=>j.rates&&j.rates.KHR],
    ['https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',j=>j.usd&&j.usd.khr],
    ['https://latest.currency-api.pages.dev/v1/currencies/usd.json',j=>j.usd&&j.usd.khr]
  ];
  for(const [u,pick] of srcs){
    try{
      const r=await fetch(u,{cache:'no-store'}); if(!r.ok)continue;
      const v=+pick(await r.json());
      if(v>1000&&v<10000){
        const changed=Math.abs(v-liveR.rate)>=0.005;
        liveR={rate:v,at:Date.now()}; liveFail=false; localStorage.setItem(LIVE,JSON.stringify(liveR));
        changed?render():renderSettings(); renderRateChart(); return true;
      }
    }catch{}
  }
  liveFail=true; renderSettings(); return false;
}
$('#rateMode').onclick=e=>{const m=e.target.dataset.m;if(!m)return;S.settings.live=m==='live';save();if(S.settings.live)liveRate(true)};
$('#liveNow').onclick=async()=>{toast('Checking rate…');toast(await liveRate(true)?'Rate updated ✓':'Could not reach the rate service')};
document.addEventListener('visibilitychange',()=>{if(!document.hidden)liveRate()});
setInterval(()=>liveRate(),600000);
liveRate();

/* ---------- exchange-rate line graph (past week / cycle / 30 days) ---------- */
const RH='kaksa_rhist';
let rhist=JSON.parse(localStorage.getItem(RH)||'{}'), rhRange='7', rhChart=null, rhBusy=false, rhAgain=false;
const rhFailed=new Set();
async function histRate(d){
  if(rhist[d])return rhist[d];
  for(const u of [`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${d}/v1/currencies/usd.json`,`https://${d}.currency-api.pages.dev/v1/currencies/usd.json`]){
    try{const r=await fetch(u);if(!r.ok)continue;const v=+(await r.json()).usd.khr;if(v>1000&&v<10000){rhist[d]=v;return v}}catch{}
  }
  return null;
}
function rhDays(){
  const t=today(); let from;
  if(rhRange==='cycle')from=cycle(0).from;
  else{const x=new Date();x.setDate(x.getDate()-(+rhRange-1));from=ymd(x)}
  const x=new Date(from+'T00:00'); if(from>=t)x.setDate(x.getDate()-1);
  const out=[];for(;ymd(x)<=t;x.setDate(x.getDate()+1))out.push(ymd(x));
  return out;
}
async function renderRateChart(){
  if(!$('#tab-chart').classList.contains('on'))return;
  if(rhBusy){rhAgain=true;return}
  rhBusy=true;
  try{
    $$('#rhSeg button').forEach(b=>b.classList.toggle('on',b.dataset.r===rhRange));
    const days=rhDays(), t=today();
    if(liveR.rate>0)rhist[t]=liveR.rate;
    const need=days.filter(d=>d!==t&&!rhist[d]&&!rhFailed.has(d));
    if(need.length)$('#rhMsg').textContent='Loading past rates…';
    for(let i=0;i<need.length;i+=8)await Promise.all(need.slice(i,i+8).map(async d=>{if(!await histRate(d))rhFailed.add(d)}));
    const keep=Object.keys(rhist).sort().slice(-150),o={};keep.forEach(k=>o[k]=rhist[k]);rhist=o;
    try{localStorage.setItem(RH,JSON.stringify(rhist))}catch{}
    const pts=days.filter(d=>rhist[d]).map(d=>({d,v:rhist[d]}));
    if(rhChart){rhChart.destroy();rhChart=null}
    if(pts.length<2){$('#rhMsg').textContent='Not enough history yet. Open this page with internet and it fills in.';return}
    const vs=pts.map(p=>p.v), first=pts[0], last=pts[pts.length-1], diff=last.v-first.v, pct=diff/first.v*100;
    const hi=Math.max(...vs), lo=Math.min(...vs);
    $('#rhMsg').textContent=`${Math.abs(diff)<0.005?'► No change':diff>0?'▲ Up ៛'+diff.toFixed(2):'▼ Down ៛'+Math.abs(diff).toFixed(2)} (${pct>=0?'+':''}${pct.toFixed(2)}%) since ${nice(first.d)} · High ៛${hi.toFixed(2)} · Low ៛${lo.toFixed(2)}`;
    if(typeof Chart==='undefined')return;
    Chart.defaults.color='#9a92b5';
    const pad=Math.max(2,(hi-lo)*.25);
    rhChart=new Chart($('#rateChart'),{type:'line',
      data:{labels:pts.map(p=>nice(p.d)),datasets:[{data:vs,borderColor:'#f5b942',backgroundColor:'rgba(245,185,66,.14)',fill:true,tension:.3,borderWidth:2.5,pointRadius:pts.length>16?0:3,pointHoverRadius:5,pointBackgroundColor:'#f5b942'}]},
      options:{plugins:{legend:{display:false},tooltip:{callbacks:{label:i=>'៛'+(+i.raw).toFixed(2)+' per $1'}}},
        scales:{y:{min:lo-pad,max:hi+pad,grid:{color:'#2f2947'},ticks:{callback:v=>'៛'+(+v).toLocaleString(undefined,{maximumFractionDigits:1})}},x:{grid:{display:false},ticks:{maxRotation:0,autoSkip:true}}}}});
  }finally{rhBusy=false;if(rhAgain){rhAgain=false;renderRateChart()}}
}
$('#rhSeg').onclick=e=>{const r=e.target.dataset.r;if(r){rhRange=r;renderRateChart()}};
$('#rate').onchange=()=>{S.settings.rate=+$('#rate').value||4100;save();toast('Manual rate saved ✓')};
$('#heroSeg').onclick=e=>{const h=e.target.dataset.h;if(h){S.settings.sep=h==='sep';save()}};

/* ---------- add what someone owes me when I do not pay my own part (e.g. parents paid) ---------- */
function coverPopup(){
  const cv={people:[],cur:S.settings.disp==='USD'?'USD':'KHR',cat:'🏠 Rent',mode:'inc'};
  const sh=$('#sheet'); sh.className='sheet dark'; sh.onclick=null;
  sh.innerHTML=`<h2>Add what they owe me</h2>
  <p class="hint">Use this when someone else (like your parents) paid, so you do not pay anything, but your roommate still needs to pay you their part. It shows on their receipt.</p>
  <label>Who owes me?</label>
  <div class="chips" id="cvPeople"></div>
  <div class="row"><input id="cvNew" placeholder="Add a new name"><button class="btn ghost" id="cvAdd">Add</button></div>
  <label>Total amount of the bill</label>
  <div class="row"><input id="cvAmt" type="number" inputmode="decimal" step="any" placeholder="e.g. 10000"><div class="seg small" id="cvCur"><button data-c="KHR">៛ Riel</button><button data-c="USD">$ USD</button></div></div>
  <label>How much do they pay?</label>
  <div id="cvModes">
    <button class="opt" data-m="inc"><b>Split equally with me</b><small>I do not pay my part. Example: total 10,000 with one roommate, they pay 5,000.</small></button>
    <button class="opt" data-m="only"><b>They pay all of it</b><small>Everyone I picked splits the whole total. Example: total 10,000 with one roommate, they pay 10,000.</small></button>
    <button class="opt" data-m="custom"><b>I will type what each pays</b><small>Use this for any other amount.</small></button>
  </div>
  <input id="cvEach" type="number" inputmode="decimal" step="any" placeholder="How much does each person pay?" hidden>
  <div class="chips" id="cvCats"></div>
  <input id="cvNote" placeholder="What is it for? (optional) e.g. rent">
  <input id="cvFrom" placeholder="Who covered it? (optional) e.g. Parents">
  <label>Date</label><input id="cvDate" type="date">
  <p class="hint" id="cvHint"></p>
  <div class="btns"><button class="btn ghost" id="cvClose">Cancel</button><button class="btn" id="cvSave">Save</button></div>`;
  $('#modal').hidden=false;
  $('#cvDate').max=today(); $('#cvDate').value=today();
  const each=()=>{
    const a=+$('#cvAmt').value, n=cv.people.length;
    return cv.mode==='custom'?+$('#cvEach').value:cv.mode==='inc'?(n?a/(n+1):0):(n?a/n:0);
  };
  const draw=()=>{
    $('#cvPeople').innerHTML=S.people.length?S.people.map(p=>`<button class="chip ${cv.people.includes(p)?'on':''}" data-p="${esc(p)}">${esc(p)}</button>`).join(''):'<span class="hint">No names yet. Add one below.</span>';
    $$('#cvCur button').forEach(b=>b.classList.toggle('on',b.dataset.c===cv.cur));
    $$('#cvModes .opt').forEach(b=>b.classList.toggle('on',b.dataset.m===cv.mode));
    $('#cvEach').hidden=cv.mode!=='custom';
    $('#cvCats').innerHTML=CATS.map(c=>`<button class="chip ${c===cv.cat?'on':''}" data-c="${c}">${c}</button>`).join('');
    const a=+$('#cvAmt').value, n=cv.people.length, ea=each();
    $('#cvHint').textContent=n&&ea>0?`${n>1?'Each of the '+n+' people pays':cv.people[0]+' pays'} ${orig(ea,cv.cur)}. Total they owe you: ${orig(ea*n,cv.cur)}. You pay nothing.`:'';
  };
  draw();
  $('#cvPeople').onclick=e=>{const p=e.target.dataset.p;if(!p)return;cv.people=cv.people.includes(p)?cv.people.filter(x=>x!==p):[...cv.people,p];draw()};
  $('#cvAdd').onclick=()=>{const n=$('#cvNew').value.trim();if(!n)return;if(!S.people.includes(n))S.people.push(n);if(!cv.people.includes(n))cv.people.push(n);$('#cvNew').value='';save(false);draw()};
  $('#cvCur').onclick=e=>{if(e.target.dataset.c){cv.cur=e.target.dataset.c;draw()}};
  $('#cvModes').onclick=e=>{const b=e.target.closest('[data-m]');if(b){cv.mode=b.dataset.m;draw()}};
  $('#cvCats').onclick=e=>{if(e.target.dataset.c){cv.cat=e.target.dataset.c;draw()}};
  $('#cvAmt').oninput=$('#cvEach').oninput=draw;
  $('#cvClose').onclick=()=>$('#modal').hidden=true;
  $('#cvSave').onclick=()=>{
    const ea=each(), n=cv.people.length; let amt=+$('#cvAmt').value, date=$('#cvDate').value;
    if(!n)return toast('Pick who owes you');
    if(cv.mode==='custom'){ if(!(ea>0))return toast('Enter how much each person pays'); if(!(amt>0))amt=ea*n }
    else if(!(amt>0))return toast('Enter the total amount');
    if(!date||date>today())return toast('Pick today or a past day');
    if(isLocked(date))return toast('🔒 That day is locked');
    const e={id:uid(),date,amt,cur:cv.cur,cat:cv.cat,note:$('#cvNote').value.trim(),kind:'covered',people:[...cv.people],inc:cv.mode==='inc',from:$('#cvFrom').value.trim()};
    if(cv.mode==='custom')e.each=ea;
    S.entries.push(e); $('#modal').hidden=true; save(); toast('Saved ✓');
  };
}
$('#addOwed').onclick=coverPopup;
