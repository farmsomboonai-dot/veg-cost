/* ===== ระบบต้นทุนผัก — ฟาร์มสมบูรณ์ =====
   ขั้นตอนงานจริง: สั่ง → ซื้อ → รับเข้า/ชั่ง → ตัดแต่ง → ติดราคาขาย → สรุป */
const CFG = window.VEG_CONFIG || {url:'',key:''};
const ONLINE = !!(CFG.url && CFG.key);
const $ = id => document.getElementById(id);
const today = () => new Date().toISOString().slice(0,10);
const THAI_DAY=['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
const THAI_MON=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
function paintDayLabel(){
  const e=document.getElementById('dayLabel'); if(!e||!S) return;
  const d=new Date(S.date+'T00:00:00');
  if(isNaN(d)){ e.textContent=''; return; }
  const w=d.getDay();
  e.className='daylab'+(w===0?' sun':w===6?' sat':'');
  e.innerHTML='วัน'+THAI_DAY[w]+'<small>'+d.getDate()+' '+THAI_MON[d.getMonth()]+' '+(d.getFullYear()+543)+'</small>';
}
/* ไม่มีช่องไหนในระบบที่ติดลบได้ — เงินที่โอนให้ น้ำหนัก จำนวน ราคา ล้วนเป็นบวกเสมอ */
const TEXT_KEYS = {n:1, mt:1, pm:1, buyer:1, orderedBy:1, cashNote:1, by:1};
let negWarn = 0;
function pos(k, v){
  if(TEXT_KEYS[k]) return v;
  const t = String(v==null?'':v);
  if(t.indexOf('-') < 0) return v;
  const now = Date.now();
  if(now - negWarn > 1500){ negWarn = now; toast('ใส่ค่าติดลบไม่ได้'); }
  return t.replace(/-/g,'');
}
const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
const jq  = s => String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");

let S=null, USER=null, TAB=1, MODE='bag', HIST={};
let VIEW = localStorage['veg.view'] || 'card';
let FILTER={1:'all',2:'ord',asis:'open'};
let dirty=new Set(), pushTimer=null;

/* ---------- โครงข้อมูล ---------- */
const emptyBuy   = () => ({o:'',pr:'',bw:'',r:'',w:'',pm:'cash'});
const emptyPack  = (n,pm) => ({n:n||'',pm:pm||'bag',w:'',ck:'',m:false,t:'',ws:'',mv:'',mt:'',g:'',bg:'',s:''});
const emptyWeigh = n => ({n:n||'',w:'',ck:'',m:false,t:'',ws:'',c:TIERS.map(()=>'')});
const emptyDirect= () => ({q:'',p:''});
function blankDay(d){
  return {date:d, by:(USER&&USER.name)||'', orderedBy:'', buyer:'', bill:'', target:60,
          transferAmt:'', atmAmt:'', cashBack:'', cashNote:'',
          returnedBy:'', returnedAt:'', countedBy:'', countedAt:'',
          lockedAt:'', lockedBy:'', unlockNote:'', buy:{}, direct:{}, alloc:{},
          pack:PACK_ITEMS.map(n=>emptyPack(n)).concat(SET_ITEMS.map(n=>emptyPack(n,'set'))),
          weigh:WEIGH_ITEMS.map(emptyWeigh)};
}
const buyOf    = n => (S.buy[n]    || (S.buy[n]=emptyBuy()));
const directOf = n => (S.direct[n] || (S.direct[n]=emptyDirect()));

/* ---------- ฐานข้อมูล ---------- */
const H = () => ({apikey:CFG.key, Authorization:'Bearer '+CFG.key, 'Content-Type':'application/json'});
async function sbGet(t,qs){ const r=await fetch(CFG.url+'/rest/v1/'+t+'?'+qs,{headers:H()});
  if(!r.ok) throw new Error(t+' '+r.status); return r.json(); }
async function sbUpsert(t,rows){ if(!rows.length)return;
  const r=await fetch(CFG.url+'/rest/v1/'+t,{method:'POST',
    headers:Object.assign(H(),{Prefer:'resolution=merge-duplicates,return=minimal'}),
    body:JSON.stringify(rows)});
  if(!r.ok) throw new Error(t+' '+r.status+' '+await r.text()); }
function setSync(c,t){ $('dot').className='dot '+c; $('syncTxt').textContent=t; }

const lsKey = d => 'veg:'+d;
function saveLocal(){ try{ localStorage[lsKey(S.date)]=JSON.stringify(S); }catch(e){} }
function markDirty(kind,key){
  dirty.add(kind+'|'+key); saveLocal();
  if(!ONLINE){ setSync('off','เก็บในเครื่อง'); return; }
  clearTimeout(pushTimer); pushTimer=setTimeout(push,900);
}
async function push(){
  if(!ONLINE||!dirty.size) return;
  const d=S.date, buy=[],pack=[],weigh=[],direct=[],alloc=[]; const items=[...dirty]; dirty.clear();
  const ts=new Date().toISOString();
  items.forEach(k=>{
    const i=k.indexOf('|'), kind=k.slice(0,i), key=k.slice(i+1);
    if(kind==='buy'){ const r=S.buy[key]; if(r) buy.push({day:d,item:key,
      order_qty:N(r.o)||null, add_qty:null, order_baht:N(r.pr)||null, bill_kg:N(r.bw)||null,
      recv_qty:N(r.r)||null, recv_kg:N(r.w)||null, pay_method:r.pm||'cash',
      updated_by:USER?USER.name:'', updated_at:ts}); }
    if(kind==='pack'){ const r=S.pack.find(x=>x.n===key); if(r) pack.push({day:d,item:key,
      price_mode:r.pm||'bag', recv_kg:N(r.w)||null, cost_kg:N(r.ck)||null, manual:!!r.m,
      trim_kg:N(r.t)||null, waste_kg:N(r.ws)||null, move_kg:N(r.mv)||null, move_to:r.mt||null,
      gram_per_bag:N(r.g)||null, bags:N(r.bg)||null, sell_price:N(r.s)||null, updated_at:ts}); }
    if(kind==='weigh'){ const r=S.weigh.find(x=>x.n===key); if(r) weigh.push({day:d,item:key,
      recv_kg:N(r.w)||null, cost_kg:N(r.ck)||null, manual:!!r.m,
      trim_kg:N(r.t)||null, waste_kg:N(r.ws)||null, tiers:r.c.map(x=>N(x)), updated_at:ts}); }
    if(kind==='alloc'){ const i=key.indexOf('\u0001');
      alloc.push({day:d, from_item:key.slice(0,i), to_item:key.slice(i+1),
                  kg:N(S.alloc[key])||null, updated_at:ts}); }
    if(kind==='direct'){ const r=S.direct[key]; if(r) direct.push({day:d,item:key,
      sell_qty:N(r.q)||null, sell_price:N(r.p)||null, updated_at:ts}); }
  });
  try{
    setSync('off','กำลังบันทึก…');
    await sbUpsert('veg_days',[{day:d, recorded_by:S.by||'', ordered_by:S.orderedBy||null,
      buyer:S.buyer||null, bill_total:N(S.bill)||null, target_margin:N(S.target),
      transfer_amt:N(S.transferAmt)||null, atm_amt:N(S.atmAmt)||null,
      cash_back:S.cashBack===''?null:N(S.cashBack), cash_note:S.cashNote||null,
      returned_by:S.returnedBy||null, returned_at:S.returnedAt||null,
      counted_by:S.countedBy||null, counted_at:S.countedAt||null,
      buy_locked_at:S.lockedAt||null, buy_locked_by:S.lockedBy||null,
      unlock_note:S.unlockNote||null, updated_at:ts}]);
    if(AUDIT.length){ try{ await sbUpsert('veg_audit', AUDIT.splice(0)); }catch(e){} }
    await sbUpsert('veg_buy',buy); await sbUpsert('veg_pack',pack);
    await sbUpsert('veg_weigh',weigh); await sbUpsert('veg_direct',direct);
    await sbUpsert('veg_alloc',alloc);
    setSync('on','ซิงก์แล้ว');
  }catch(e){ items.forEach(k=>dirty.add(k)); setSync('err','ยังไม่ได้ส่ง — จะลองใหม่'); }
}
async function pull(d){
  if(!ONLINE) return false;
  try{
    setSync('off','กำลังโหลด…');
    const q='day=eq.'+d;
    const [days,buy,pack,weigh,direct,alloc]=await Promise.all([sbGet('veg_days',q),sbGet('veg_buy',q),
      sbGet('veg_pack',q),sbGet('veg_weigh',q),sbGet('veg_direct',q),sbGet('veg_alloc',q)]);
    const n=blankDay(d);
    if(days[0]){ const D=days[0];
      n.by=D.recorded_by||''; n.orderedBy=D.ordered_by||''; n.buyer=D.buyer||'';
      n.bill=D.bill_total||''; n.target=D.target_margin||60;
      n.transferAmt=D.transfer_amt||''; n.atmAmt=D.atm_amt||'';
      n.cashBack=D.cash_back==null?'':D.cash_back; n.cashNote=D.cash_note||'';
      n.returnedBy=D.returned_by||''; n.returnedAt=D.returned_at||'';
      n.countedBy=D.counted_by||''; n.countedAt=D.counted_at||'';
      n.lockedAt=D.buy_locked_at||''; n.lockedBy=D.buy_locked_by||''; n.unlockNote=D.unlock_note||''; }
    buy.forEach(r=>{ n.buy[r.item]={o:(N(r.order_qty)+N(r.add_qty))||'',pr:r.order_baht??'',
      bw:r.bill_kg??'',r:r.recv_qty??'',w:r.recv_kg??'',pm:r.pay_method||'cash'}; });
    pack.forEach(r=>{ let x=n.pack.find(p=>p.n===r.item); if(!x){x=emptyPack(r.item);n.pack.push(x);}
      Object.assign(x,{pm:r.price_mode||'bag',w:r.recv_kg??'',ck:r.cost_kg??'',m:!!r.manual,
        t:r.trim_kg??'',ws:r.waste_kg??'',mv:r.move_kg??'',mt:r.move_to??'',
        g:r.gram_per_bag??'',bg:r.bags??'',s:r.sell_price??''}); });
    weigh.forEach(r=>{ let x=n.weigh.find(p=>p.n===r.item); if(!x){x=emptyWeigh(r.item);n.weigh.push(x);}
      Object.assign(x,{w:r.recv_kg??'',ck:r.cost_kg??'',m:!!r.manual,t:r.trim_kg??'',ws:r.waste_kg??'',
        c:(r.tiers||[]).map(v=>v||'')});
      if(x.c.length!==TIERS.length) x.c=TIERS.map((_,i)=>x.c[i]||''); });
    direct.forEach(r=>{ n.direct[r.item]={q:r.sell_qty??'',p:r.sell_price??''}; });
    alloc.forEach(r=>{ if(N(r.kg)>0) n.alloc[AK(r.from_item,r.to_item)]=r.kg; });
    S=n; saveLocal(); setSync('on','ซิงก์แล้ว'); return true;
  }catch(e){ setSync('err','ต่อฐานข้อมูลไม่ได้ — ใช้ข้อมูลในเครื่อง'); return false; }
}
async function loadHistory(d){
  HIST={}; if(!ONLINE) return;
  try{
    const from=new Date(new Date(d).getTime()-30*864e5).toISOString().slice(0,10);
    const rows=await sbGet('veg_price_history','day=gte.'+from+'&day=lt.'+d+'&select=item,real_cost_per_kg');
    const by={};
    rows.forEach(r=>{ const v=N(r.real_cost_per_kg); if(v>0)(by[r.item]=by[r.item]||[]).push(v); });
    Object.keys(by).forEach(k=>{ const a=by[k].sort((x,y)=>x-y), L=a.length;
      HIST[k]={med:L%2?a[(L-1)/2]:(a[L/2-1]+a[L/2])/2, n:L, min:a[0], max:a[L-1]}; });
  }catch(e){}
}
async function openDay(d){
  const raw=localStorage[lsKey(d)];
  S = raw ? JSON.parse(raw) : blankDay(d);
  S.date=d;
  if(!S.pack)  S.pack=PACK_ITEMS.map(n=>emptyPack(n)).concat(SET_ITEMS.map(n=>emptyPack(n,'set')));
  SET_ITEMS.forEach(n=>{ if(!S.pack.some(r=>r.n===n)) S.pack.push(emptyPack(n,'set')); });
  Object.keys(SET_RECIPE).forEach(k=>SET_RECIPE[k].forEach(n=>{
    if(!S.pack.some(r=>r.n===n) && !S.weigh.some(r=>r.n===n)) S.pack.push(emptyPack(n)); }));
  if(!S.weigh) S.weigh=WEIGH_ITEMS.map(emptyWeigh);
  if(!S.direct)S.direct={};
  if(!S.alloc) S.alloc={};
  S.pack.forEach(r=>{ if(!r.pm) r.pm='bag'; });
  render();
  const ok=await pull(d);
  await loadHistory(d); await loadAudit(); await loadStdCost();
  applyStdPrice();
  render();
}

/* ---------- เข้าสู่ระบบ ---------- */
function togglePw(){
  const i=$('lpass'), b=$('eyeBtn');
  if(i.type==='password'){ i.type='text'; b.textContent='ซ่อน'; }
  else { i.type='password'; b.textContent='ดู'; }
}
function pickUser(n){
  $('luser').value=n;
  [].forEach.call(document.querySelectorAll('#userPick button'),b=>b.classList.toggle('on',b.textContent===n));
  $('lpass').focus();
}
async function loadUserList(){
  if(!ONLINE) return;
  try{
    const r=await fetch(CFG.url+'/rest/v1/rpc/veg_user_list',{method:'POST',headers:H(),body:'{}'});
    if(!r.ok) return;
    const rows=await r.json();
    const box=$('userPick'); if(!box||!rows.length) return;
    box.innerHTML=rows.map(u=>'<button type="button" onclick="pickUser(\''+jq(u.name)+'\')">'+
      esc(u.name)+'</button>').join('');
  }catch(e){}
}
async function doLogin(){
  const u=$('luser').value.trim(), p=$('lpass').value.trim();
  if(!u||!p){ $('loginErr').textContent='กรอกชื่อผู้ใช้และรหัสผ่าน'; return; }
  try{
    const res=await fetch(CFG.url+'/rest/v1/rpc/veg_login',{method:'POST',headers:H(),
      body:JSON.stringify({p_name:u,p_code:p})});
    if(!res.ok) throw new Error('rpc '+res.status);
    const rows=await res.json();
    if(!rows.length){ $('loginErr').textContent='รหัสไม่ถูกต้อง — กดปุ่ม “ดู” เพื่อตรวจว่าพิมพ์ถูกไหม'; return; }
    USER={name:rows[0].name, role:rows[0].role||'staff'};
    localStorage['veg.user']=JSON.stringify(USER);
    startApp();
  }catch(e){ $('loginErr').textContent='ต่อฐานข้อมูลไม่ได้ ลองใหม่อีกครั้ง'; }
}
function logout(){ localStorage.removeItem('veg.user'); location.reload(); }

/* ---------- แก้ไขค่า ---------- */
let AUDIT=[], AUDIT_SEEN=[];
const AK=(f,t)=>f+'\u0001'+t;                       // คีย์ตารางแบ่งผักไปทำชุด
const CP=()=>calcPack(S.pack, S.target, S.alloc||{});
const isOwner = () => USER && USER.role==='owner';
const isLocked = () => !!S.lockedAt;
function logChange(item,field,oldV,newV){
  if(String(oldV||'')===String(newV||'')) return;
  AUDIT.push({day:S.date, item:item, field:field, old_value:String(oldV==null?'':oldV),
    new_value:String(newV==null?'':newV), changed_by:USER?USER.name:'', after_lock:isLocked(),
    changed_at:new Date().toISOString()});   // เวลาที่กรอกจริง กันเน็ตหลุดแล้วเวลากองรวมกัน
}
function edBuy(name,k,v,idx){
  v=pos(k,v);
  const r=buyOf(name);
  if(k==='pr'){
    if(isLocked() && !isOwner()){ toast('ใบซื้อปิดแล้ว แก้ราคาไม่ได้'); render(); return; }
    logChange(name,'ราคารวม',r.pr,v);
  }
  if(k==='o') logChange(name,'จำนวนสั่ง',r.o,v);   // สั่งเพิ่มระหว่างวัน = แก้เลขในช่องนี้
  r[k]=v; markDirty('buy',name); paintBuy(name,idx); refreshLinks();
}
function lockBuy(){
  if(isLocked()) return;
  const s=summarize();
  if(!s.ord){ toast('ยังไม่ได้ลงราคาผักเลย'); return; }
  if(!confirm('ปิดใบซื้อวันนี้?\n\nยอดซื้อรวม '+fmt(s.ord,2)+' บาท\nหลังปิดแล้วจะแก้ราคาไม่ได้ (เจ้าของเท่านั้นที่เปิดได้)'))
    return;
  S.lockedAt=new Date().toISOString(); S.lockedBy=USER?USER.name:'';
  logChange('','ปิดใบซื้อ','', fmt(s.ord,2)+' บาท');
  markDirty('day','x'); push(); renderTab(); toast('ปิดใบซื้อแล้ว — ส่งเงินทอนให้เสมียนนับได้');
}
function unlockBuy(){
  if(!isOwner()){ toast('เฉพาะเจ้าของเท่านั้นที่เปิดใบซื้อได้'); return; }
  const why=prompt('เปิดใบซื้อเพื่อแก้ราคา — ระบุเหตุผล (จะถูกบันทึกไว้)');
  if(!why) return;
  logChange('','เปิดใบซื้อแก้ราคา', S.lockedAt, why);
  S.unlockNote=(S.unlockNote?S.unlockNote+' | ':'')+why+' ('+new Date().toLocaleString('th-TH')+')';
  S.lockedAt=''; S.lockedBy='';
  markDirty('day','x'); push(); renderTab(); toast('เปิดใบซื้อแล้ว — การแก้ไขทุกครั้งถูกบันทึก');
}
async function loadStdCost(){
  if(!ONLINE) return;
  try{
    const rows=await sbGet('veg_item_cost','select=item,dept,unit,cost');
    STD_COST={}; rows.forEach(r=>{ STD_COST[r.item]={cost:N(r.cost), unit:r.unit||'', dept:r.dept||''}; });
  }catch(e){}
  try{
    const rows=await sbGet('veg_price','select=item,price,effective_from,note,std_gram,min_margin');
    STD_PRICE={}; rows.forEach(r=>{ STD_PRICE[r.item]={price:N(r.price), from:r.effective_from,
      note:r.note||'', std_gram:N(r.std_gram), min_margin:N(r.min_margin)||70}; });
  }catch(e){}
}
/* เติมราคาขายมาตรฐานอัตโนมัติ เฉพาะรายการที่ยังไม่ได้ตั้งราคาของวันนั้น */
function applyStdPrice(){
  S.pack.forEach(r=>{
    const sp=STD_PRICE[r.n];
    if(!sp || N(r.s)>0 || S.date < sp.from) return;
    r.s = sp.price; markDirty('pack', r.n);
  });
  Object.keys(S.direct||{}).forEach(k=>{
    const sp=STD_PRICE[k], d=S.direct[k];
    if(!sp || !d || N(d.p)>0 || S.date < sp.from) return;
    d.p = sp.price; markDirty('direct', k);
  });
}
async function loadAudit(){
  AUDIT_SEEN=[]; if(!ONLINE) return;
  try{ AUDIT_SEEN = await sbGet('veg_audit','day=eq.'+S.date+'&order=changed_at.desc&limit=50'); }catch(e){}
}
function edPack(i,k,v){ v=pos(k,v); const r=S.pack[i]; r[k]=v; if(k==='w'||k==='ck')r.m=true;
  markDirty('pack',r.n); paintPrice(); }
function edWeigh(i,k,v){ v=pos(k,v); const r=S.weigh[i]; r[k]=v; if(k==='w'||k==='ck')r.m=true;
  markDirty('weigh',r.n); paintPrice(); }
function edAlloc(from,to,v){
  v=pos('kg',v); const k=AK(from,to);
  const old=S.alloc[k]||'';
  if(N(v)>0) S.alloc[k]=v; else delete S.alloc[k];
  markDirty('alloc',k); logChange(from,'แบ่งไป '+to,old,v);
  refreshLinks(); paintPrice();
}
async function setStdCost(item){
  const std=STD_COST[item]||{};
  const c=prompt('ทุนของ "'+item+'" ต่อ 1 '+(std.unit||'หน่วย')+' (บาท)', std.cost||'');
  if(c===null) return;
  const oc=askOwnerCode(); if(!oc) return;
  try{
    const res=await rpc('veg_cost_set',{p_owner:USER.name,p_owner_code:oc,p_item:item,
      p_dept:std.dept||'ของสด',p_unit:std.unit||'หน่วย',p_cost:N(c)});
    if(res==='ok'){ await loadStdCost(); paintPrice(true); toast('บันทึกทุน '+item+' แล้ว'); }
    else { toast(res); OWNER_CODE=''; }
  }catch(e){ toast('บันทึกไม่สำเร็จ'); }
}
function edTier(i,j,v){ v=pos('c',v); S.weigh[i].c[j]=v; markDirty('weigh',S.weigh[i].n); paintPrice(); }
function edDirect(n,k,v){ v=pos(k,v); directOf(n)[k]=v; markDirty('direct',n); paintPrice(); }
function setDay(k,v){ v=pos(k,v); S[k]=v; markDirty('day','x'); if(TAB===4)paintCash(); else if(TAB===5)paintSummary(); }
function setBill(v){ v=pos('bill',v); S.bill=v; markDirty('day','x'); paintSummary(); }
function setTarget(v){ v=pos('target',v); S.target=v; markDirty('day','x'); paintSummary(); }

function lookupCost(){
  const m={};
  Object.keys(S.buy).forEach(n=>{
    const c=calcBuy(S.buy[n], ITEM_INFO[n]);
    if(c.tot>0 && N(S.buy[n].w)>0) m[n]={w:N(S.buy[n].w), ck:+c.real.toFixed(2)};
  });
  return m;
}
function refreshLinks(){
  const m=lookupCost(); let ch=false;
  S.pack.concat(S.weigh).forEach(r=>{
    if(!r.m&&m[r.n]&&(r.w!=m[r.n].w||r.ck!=m[r.n].ck)){ r.w=m[r.n].w; r.ck=m[r.n].ck; ch=true; }
  });
  if(ch){ saveLocal(); if(TAB===3)paintPrice(); }
}

/* ---------- นำทาง ---------- */
function go(n){ TAB=n; [1,2,3,4,5].forEach(i=>{ $('t'+i).classList.toggle('hide',i!==n);
  $('n'+i).classList.toggle('on',i===n); }); window.scrollTo(0,0); renderTab(); }
function setFilter(tab,v){ FILTER[tab]=v;
  const map={1:['f1a','f1b',['all','has']],2:['f2a','f2b',['ord','all']]};
  if(map[tab]){ const [a,b,vals]=map[tab];
    $(a).classList.toggle('on',v===vals[0]); $(b).classList.toggle('on',v===vals[1]); }
  renderTab(); }
function setMode(m){ MODE=m;
  ['bag','set','size','asis'].forEach((x,i)=>$('m'+(i+1)).classList.toggle('on',x===m));
  paintPrice(true); }
const relink=(kind,i)=>{ S[kind][i].m=false; refreshLinks(); renderTab(); };
function toggleView(){ VIEW = VIEW==='card' ? 'table' : 'card';
  localStorage['veg.view']=VIEW; updateViewBtn(); renderTab(); }
function updateViewBtn(){ const b=$('viewBtn'); if(b) b.textContent = VIEW==='card' ? '📋 ตาราง' : '🗂 การ์ด'; }
function render(){ updateViewBtn(); $('dt').value=S.date; paintDayLabel(); $('bill').value=S.bill||''; $('tg').value=S.target||60;
  if($('orderedBy')) $('orderedBy').value=S.orderedBy||'';
  if($('buyer')) $('buyer').value=S.buyer||'';
  $('whoName').textContent=USER?USER.name:''; renderTab(); }
function renderTab(){
  if(TAB<=2) renderBuy(TAB);
  else if(TAB===3) paintPrice(true);
  else if(TAB===4) paintCash();
  else paintSummary();
}
function fld(label,type,val,oninput,cls){
  return '<label><span>'+esc(label)+'</span><input '+(type?'type="'+type+'" step="any" min="0"':'')+
    ' class="'+(cls||'')+'" value="'+esc(val)+'" oninput="'+oninput+'"></label>';
}
const kv=(k,v)=> v ? '<span><span class="k">'+k+'</span> '+v+'</span>' : '';

/* ---------- แท็บ 1-3 : สั่ง / ซื้อ / รับเข้า ---------- */
function renderBuy(tab){
  const q=($('q'+tab).value||'').trim(); const out=[]; let grp='';
  ITEMS.forEach((it,idx)=>{
    if(it[0]) grp=it[0];
    const name=it[1], r=S.buy[name]||emptyBuy();
    const ordered=N(r.o)>0, bought=N(r.pr)>0;
    const used=ordered||bought||N(r.r)>0||N(r.w)>0;
    if(q && name.indexOf(q)<0) return;
    if(tab===1 && FILTER[1]==='has' && !used) return;
    if(tab===2 && FILTER[2]==='ord' && !(ordered||bought)) return;
    if(!out.length || out[out.length-1].g!==grp) out.push({g:grp,rows:[]});
    out[out.length-1].rows.push({name,idx,used});
  });
  let h='';
  out.forEach(sec=>{
    h+='<div class="grp">'+esc(sec.g)+'</div>';
    sec.rows.forEach(({name,idx,used})=>{
      const info=ITEM_INFO[name]||{}, B=S.buy[name]||emptyBuy();
      const sz=(info.k?info.k+' กก./':'')+(info.u||'');
      h+='<div class="it'+(used?' has':'')+'"><div class="top"><span class="ic">'+vegIcon(name)+
         '</span><span class="nm">'+esc(name)+'</span><span class="sz">'+esc(sz)+'</span></div><div class="fl">';
      if(tab===1){
        h+=fld('จำนวนที่สั่ง ('+(info.u||'หน่วย')+')','number',B.o,"edBuy('"+jq(name)+"','o',this.value,"+idx+")");
      }else if(tab===2){
        const ro = (isLocked()&&!isOwner()) ? ' readonly style="background:#f1f5f9;color:#64748b"' : '';
        const pm = B.pm||'cash';
        h+='<label><span>วิธีจ่าย</span><select onchange="edBuy(\''+jq(name)+'\',\'pm\',this.value,'+idx+')">'+
           '<option value="cash"'+(pm==='cash'?' selected':'')+'>เงินสด</option>'+
           '<option value="transfer"'+(pm==='transfer'?' selected':'')+'>โอนให้ร้าน</option></select></label>';
        h+='<label><span>ราคารวมที่จ่าย ฿</span><input type="number" step="any" min="0" value="'+esc(B.pr)+
           '"'+ro+' oninput="edBuy(\''+jq(name)+'\',\'pr\',this.value,'+idx+')"></label>'
          +fld('รับเข้า ('+(info.u||'หน่วย')+')','number',B.r,"edBuy('"+jq(name)+"','r',this.value,"+idx+")")
          +fld('ชั่งได้จริง กก.','number',B.w,"edBuy('"+jq(name)+"','w',this.value,"+idx+")");
      }
      h+='<div class="out" id="o'+tab+'_'+idx+'"></div></div></div>';
    });
  });
  if(VIEW==='table'){
    $('list'+tab).innerHTML = (tab===2?lockBarHTML():'') + buyTable(tab,out);
    return;
  }
  $('list'+tab).innerHTML = (tab===2?lockBarHTML():'') +
    (h || '<div class="empty">ไม่พบรายการ<br>ลองล้างคำค้นหา หรือเปลี่ยนตัวกรอง</div>');
  out.forEach(sec=>sec.rows.forEach(({name,idx})=>paintBuy(name,idx,tab)));
}
function paintBuy(name,idx,tab){
  tab=tab||TAB;
  if(VIEW==='table'){ paintBuyCell(name,idx,tab); if(tab>=2) renderTab(); return; }
  const e=$('o'+tab+'_'+idx); if(!e) return;
  const r=S.buy[name]||emptyBuy(), c=calcBuy(r,ITEM_INFO[name]);
  const U=(ITEM_INFO[name]||{}).u||'', tot=N(r.o);
  let h='';
  if(tab===1){
    const kk=N((ITEM_INFO[name]||{}).k);
    h = tot ? kv('สั่ง','<b>'+fmt(tot,0)+' '+U+'</b>')+(kk?kv('= รวม','<b>'+fmt(tot*kk,(tot*kk)%1?1:0)+' กก.</b>'):'')
            : '<span class="k">ยังไม่ได้สั่ง</span>';
  }else{
    if(tot) h+=kv('สั่งไว้', fmt(tot,0)+' '+U);
    if(c.nom) h+=kv('ควรได้', fmt(c.nom,2)+' กก.');
    if(c.dw) h+='<span class="pill '+(c.dp<-5?'bad':c.dp>5?'good':'warn')+'">'+
      (c.dw>0?'เกิน +':'ขาด ')+fmt(Math.abs(c.dw),2)+' กก. ('+fmt(c.dp,1)+'%)</span>';
    if(c.tot) h+=kv('ทุนจ่ายจริง', fmt(c.tot,2)+' ฿')+kv('<b>ทุน/กก.จริง</b>','<b>'+fmt(c.real,2)+'</b>');
    const hh=HIST[name];
    if(hh&&hh.n>=3&&c.real>0){ const up=(c.real-hh.med)/hh.med*100;
      h+=kv('ราคากลาง '+hh.n+' วัน', fmt(hh.med,2));
      if(up>20) h+='<span class="pill bad">แพงกว่าปกติ +'+fmt(up,0)+'%</span>';
      else if(up<-20) h+='<span class="pill good">ถูกกว่าปกติ '+fmt(up,0)+'%</span>'; }
    if(!c.pu&&!N(r.w)) h='<span class="k">ยังไม่ได้ซื้อ</span>';
  }
  e.innerHTML=h;
}

function th(t,sub){ return '<th>'+t+(sub?'<span>'+sub+'</span>':'')+'</th>'; }
function inpT(val,oninput,w){ return '<input type="number" step="any" min="0" value="'+esc(val)+
  '" oninput="'+oninput+'"'+(w?' style="width:'+w+'px"':'')+'>'; }
function buyTable(tab,out){
  if(!out.length) return '<div class="empty">ไม่พบรายการ<br>ลองล้างคำค้นหา หรือเปลี่ยนตัวกรอง</div>';
  const locked = isLocked()&&!isOwner();
  let head='<tr>'+th('รายการ');
  if(tab===1) head+=th('จำนวนที่สั่ง','หน่วย')+th('รวม','กก.');
  else head+=th('วิธีจ่าย')+th('ราคารวม','บาท')+th('รับเข้า')+th('ชั่งได้','กก.')+
       th('ควรได้','กก.')+th('ขาด/เกิน','กก.')+th('ทุน/กก.','จริง')+th('ปกติ','30 วัน');
  head+='</tr>';
  let body='';
  const cols = tab===1?3:9;
  out.forEach(sec=>{
    body+='<tr class="grprow"><td colspan="'+cols+'">'+esc(sec.g)+'</td></tr>';
    sec.rows.forEach(({name,idx,used})=>{
      const B=S.buy[name]||emptyBuy(), c=calcBuy(B,ITEM_INFO[name]);
      const U=(ITEM_INFO[name]||{}).u||'', tot=N(B.o);
      const info=ITEM_INFO[name]||{};
      const pk = info.k ? fmt0(N(info.k),N(info.k)%1?1:0)+' กก./'+(info.u||'หน่วย') : (info.u||'');
      body+='<tr'+(used?' class="has"':'')+'><td class="nm"><span class="ic">'+vegIcon(name)+'</span>'+
            esc(name)+'<small>'+esc(pk)+'</small></td>';
      if(tab===1){
        const kgTot = (tot && N(info.k)) ? tot*N(info.k) : 0;
        body+='<td>'+inpT(B.o,"edBuy('"+jq(name)+"','o',this.value,"+idx+")",70)+
              ' <span class="k" style="font-size:11px">'+esc(U)+'</span></td>'+
              '<td class="c" id="o'+tab+'_'+idx+'">'+(kgTot?'<b>'+fmt(kgTot,kgTot%1?1:0)+'</b> กก.':'')+'</td>';
      } else {
        const pm=B.pm||'cash';
        body+='<td><select style="width:78px" onchange="edBuy(\''+jq(name)+'\',\'pm\',this.value,'+idx+')">'+
              '<option value="cash"'+(pm==='cash'?' selected':'')+'>เงินสด</option>'+
              '<option value="transfer"'+(pm==='transfer'?' selected':'')+'>โอน</option></select></td>'+
              '<td><input type="number" step="any" min="0" value="'+esc(B.pr)+'" style="width:84px"'+
                (locked?' readonly style="width:84px;background:#f1f5f9;color:#64748b"':'')+
                ' oninput="edBuy(\''+jq(name)+'\',\'pr\',this.value,'+idx+')"></td>'+
              '<td>'+inpT(B.r,"edBuy('"+jq(name)+"','r',this.value,"+idx+")",58)+'</td>'+
              '<td>'+inpT(B.w,"edBuy('"+jq(name)+"','w',this.value,"+idx+")",70)+'</td>'+
              '<td class="c">'+fmt(c.nom,2)+'</td>'+
              '<td class="c" id="od'+idx+'"></td>'+
              '<td class="c"><b>'+fmt(c.real,2)+'</b></td>'+
              '<td class="c" id="o'+tab+'_'+idx+'"></td>';
      }
      body+='</tr>';
    });
  });
  setTimeout(()=>out.forEach(sec=>sec.rows.forEach(({name,idx})=>paintBuyCell(name,idx,tab))),0);
  return '<div class="gt"'+(tab===1?' style="max-width:620px"':'')+'><table><thead>'+head+
         '</thead><tbody>'+body+'</tbody></table></div>';
}
function paintBuyCell(name,idx,tab){
  const e=$('o'+tab+'_'+idx); if(!e) return;
  const B=S.buy[name]||emptyBuy(), c=calcBuy(B,ITEM_INFO[name]);
  if(tab===1){
    const info=ITEM_INFO[name]||{}, kgTot=(N(B.o)&&N(info.k))?N(B.o)*N(info.k):0;
    e.innerHTML = kgTot ? '<b>'+fmt(kgTot,kgTot%1?1:0)+'</b> กก.' : '';
    return; }
  else { const hh=HIST[name];
    if(hh&&hh.n>=3&&c.real>0){ const up=(c.real-hh.med)/hh.med*100;
      e.innerHTML = fmt(hh.med,2)+(up>20?' <span class="neg">+'+fmt(up,0)+'%</span>':
                    (up<-20?' <span class="pos">'+fmt(up,0)+'%</span>':'')); }
    else e.innerHTML='';
    const d=$('od'+idx);
    if(d) d.innerHTML = c.dw ? '<span class="'+(c.dp<-5?'neg':c.dp>5?'pos':'')+'">'+
           (c.dw>0?'+':'')+fmt(c.dw,2)+'</span>' : ''; }
}

function addPack(){ S.pack.push(emptyPack('', MODE==='set'?'set':'bag')); renderTab(); }
function rmPack(i){ const n=S.pack[i].n; S.pack.splice(i,1); markDirty('pack',n); renderTab(); }
function addWeigh(){ S.weigh.push(emptyWeigh('')); renderTab(); }
function rmWeigh(i){ const n=S.weigh[i].n; S.weigh.splice(i,1); markDirty('weigh',n); renderTab(); }

/* ---------- แท็บ 5 : ติดราคาเพื่อขาย ---------- */
const HINTS={
 bag:'<b>แพคถุง</b> — กรอกน้ำหนักต่อถุงกับราคาขาย ระบบบอกให้ทั้งสองทาง:<br>'+
     '• ใส่กรัมแล้ว → <b>ควรขายถุงละเท่าไหร่</b> &nbsp;•&nbsp; ตั้งราคาแล้ว → <b>วันนี้ควรใส่ถุงละกี่กรัม</b>',
 set:'<b>ชุดที่เราจัดแพ็กใหม่เอง</b> — ชุดผักชาบู · ชุดหมูกระทะ · ชุดแกงจืด · ชุดต้มยำ · ถุงรวมผักชี-ต้นหอม<br>'+
     'กรอกน้ำหนักวัตถุดิบในการ์ดชุดได้เลย ทุนจะถูกหักจากผักต้นทางและวิ่งมาที่ชุดนี้เอง · ผัก 1 อย่างแบ่งไปได้หลายชุดพร้อมกัน',
 size:'<b>คัดไซส์</b> — คัดขนาดแล้วขายคนละราคา กรอกจำนวนหัวที่ขายได้ในแต่ละช่วงราคา เช่น กะหล่ำปลี ผักกาดขาว',
 asis:'<b>สินค้าแพ็กเกจพร้อมขาย</b> — ของที่มาเป็นแพ็กสำเร็จรูปอยู่แล้ว ไม่ต้องตัดแต่ง ไม่ต้องแบ่งถุง<br>'+
      '<b>แค่บวกกำไรแล้วติดราคา</b> เช่น ชุดแกงป่า · หน่อไม้ดอง · หน่อไม้เปรี้ยว · หน่อไม้เส้น · ผักกาดดอง · ข้าวโพดถาด · ขนมจีน'};
function paintPrice(full){
  $('modeHint').innerHTML=HINTS[MODE];
  const C=CP();
  paintGramSheet(C);
  if(full){
    let h='', add='';
    if(MODE==='bag'||MODE==='set'){
      const wantSet = MODE==='set';
      S.pack.forEach((r,i)=>{
        if((r.pm==='set')!==wantSet) return;
        h+='<div class="it'+(N(r.bg)?' has':'')+'"><div class="top"><span class="ic">'+vegIcon(r.n)+
           '</span><span class="nm">'+esc(r.n||'(ตั้งชื่อ)')+
           '</span><span class="sz">ทุน/กก.พร้อมขาย '+fmt(C[i].ckt,2)+' ฿</span>'+
           (r.m&&!wantSet?'<button class="btn sm" onclick="relink(\'pack\','+i+')">↺ ดึงทุนใหม่</button>':'')+
           '<button class="x" onclick="rmPack('+i+')">×</button></div><div class="fl c3">'+
           (r.n?'':'<label><span>ชื่อรายการ</span><input list="items" value="" oninput="edPack('+i+',\'n\',this.value)"></label>');
        const U = wantSet ? 'ชุด' : 'ถุง';
        if(wantSet){
          const rec = SET_RECIPE[r.n] || [];
          const extra = Object.keys(S.alloc).filter(k=>k.split('\u0001')[1]===r.n)
                        .map(k=>k.split('\u0001')[0]).filter(x=>rec.indexOf(x)<0);
          h+='<div class="recipe"><div class="rtitle">ส่วนประกอบ — กรอกน้ำหนักที่ใส่ (กก.)</div>'+
             rec.concat(extra).map(ing=>{
               const have = S.alloc[AK(ing,r.n)]||'';
               const src  = S.pack.find(x=>x.n===ing) || S.weigh.find(x=>x.n===ing);
               const ck   = (src && N(src.w)>0) ? N(src.ck) : 0;
               const std  = STD_COST[ing];
               let tag;
               if(ck) tag='<small> '+fmt(ck,2)+' ฿/กก.</small>';
               else if(std && std.cost>0) tag='<small> '+fmt(std.cost,2)+' ฿/'+esc(std.unit||'หน่วย')+
                 ' <span class="dept">'+esc(std.dept||'ต่างแผนก')+'</span></small>';
               else if(std) tag='<small class="warn2"> รอใส่ทุน ('+esc(std.dept||'ต่างแผนก')+')</small>'+
                 (isOwner()?' <button class="btn sm" onclick="setStdCost(\''+jq(ing)+'\')">ใส่ทุน</button>':'');
               else tag='<small class="warn2"> ยังไม่ได้ซื้อวันนี้</small>';
               const unit = ck ? 'กก.' : (std ? (std.unit||'หน่วย') : 'กก.');
               return '<label class="ring"><span>'+vegIcon(ing)+' '+esc(ing)+tag+'</span>'+
                 '<span class="runit">'+esc(unit)+'</span>'+
                 '<input type="number" step="any" min="0" value="'+esc(have)+
                 '" oninput="edAlloc(\''+jq(ing)+'\',\''+jq(r.n)+'\',this.value)"></label>';
             }).join('')+'</div>';
        }
        if(!wantSet){
          h+=fld('นน.รับ กก.','number',r.w,'edPack('+i+',\'w\',this.value)')+
             fld('ทุน/กก. ฿','number',r.ck,'edPack('+i+',\'ck\',this.value)')+
             fld('หลังตัดแต่ง กก.','number',r.t,'edPack('+i+',\'t\',this.value)')+
             fld('ผักเสีย กก.','number',r.ws,'edPack('+i+',\'ws\',this.value)');
        }
        h+=fld('นน./'+U+' กรัม','number',r.g,'edPack('+i+',\'g\',this.value)')+
           fld('ทำได้จริง '+U,'number',r.bg,'edPack('+i+',\'bg\',this.value)')+
           fld('ราคาขาย/'+U+' ฿','number',r.s,'edPack('+i+',\'s\',this.value)')+
           '<div class="out" id="pp_'+i+'"></div></div></div>';
      });
      add='<button class="btn sm" onclick="addPack()">+ เพิ่ม'+(wantSet?'ชุดใหม่':'รายการ')+'</button>';
      if(!h) h='<div class="empty">ยังไม่มีรายการ<br>กด “+ เพิ่ม'+(wantSet?'ชุดใหม่':'รายการ')+'”</div>';
    }
    else if(MODE==='size'){
      S.weigh.forEach((r,i)=>{
        h+='<div class="it'+(calcWeigh(r).pcs?' has':'')+'"><div class="top"><span class="ic">'+vegIcon(r.n)+
           '</span><span class="nm">'+esc(r.n||'(ตั้งชื่อ)')+
           '</span><span class="sz">ทุน/กก.หลังตัด '+fmt(calcWeigh(r).ckt,2)+' ฿</span>'+
           '<button class="x" onclick="rmWeigh('+i+')">×</button></div><div class="fl">'+
           (r.n?'':'<label><span>ชื่อรายการ</span><input list="items" value="" oninput="edWeigh('+i+',\'n\',this.value)"></label>')+
           '</div><div class="fl c3">'+
           fld('นน.รับ กก.','number',r.w,'edWeigh('+i+',\'w\',this.value)')+
           fld('ทุน/กก. ฿','number',r.ck,'edWeigh('+i+',\'ck\',this.value)')+
           fld('หลังตัดแต่ง กก.','number',r.t,'edWeigh('+i+',\'t\',this.value)')+
           fld('ผักเสีย กก.','number',r.ws,'edWeigh('+i+',\'ws\',this.value)')+
           '<div class="tiers">'+TIERS.map((t,j)=>'<label><span>'+t+' ฿</span><input type="number" step="any" min="0" value="'+
             esc(r.c[j]||'')+'" oninput="edTier('+i+','+j+',this.value)"></label>').join('')+'</div>'+
           '<div class="out" id="pw_'+i+'"></div></div></div>';
      });
      add='<button class="btn sm" onclick="addWeigh()">+ เพิ่มรายการ</button>';
    }
    else{
      const names=directItems();
      const show=names.filter(n=>FILTER.asis!=='open'||!(calcDirect(n).rev>0));
      show.forEach(n=>{
        const info=ITEM_INFO[n]||{}, d=S.direct[n]||emptyDirect(), c=calcDirect(n);
        h+='<div class="it'+(c.rev?' has':'')+'"><div class="top"><span class="ic">'+vegIcon(n)+
           '</span><span class="nm">'+esc(n)+'</span>'+
           '<span class="sz">ทุน '+fmt(c.cost,2)+' ฿ · รับมา '+fmt(c.recv,0)+' '+esc(info.u||'')+'</span></div><div class="fl">'+
           fld('จำนวนที่ขาย ('+(info.u||'หน่วย')+')','number',d.q,"edDirect('"+jq(n)+"','q',this.value)")+
           fld('ติดราคา/'+(info.u||'หน่วย')+' ฿','number',d.p,"edDirect('"+jq(n)+"','p',this.value)")+
           '<div class="out" id="pd_'+slug(n)+'"></div></div></div>';
      });
      add='<div class="seg" style="max-width:320px"><button class="'+(FILTER.asis==='open'?'on':'')+
          '" onclick="FILTER.asis=\'open\';paintPrice(true)">ที่ยังไม่ลงราคา</button><button class="'+
          (FILTER.asis==='all'?'on':'')+'" onclick="FILTER.asis=\'all\';paintPrice(true)">ทั้งหมด</button></div>';
      if(!h) h='<div class="empty">'+(names.length?'ติดราคาครบทุกรายการแล้ว':'ยังไม่มีรายการ — กรอกแท็บซื้อกับรับเข้าก่อน')+'</div>';
    }
    $('list5').innerHTML=h; $('addBtn').innerHTML=add;
  }
  if(MODE==='bag'||MODE==='set'){
    S.pack.forEach((r,i)=>{ const e=$('pp_'+i); if(!e)return; const c=C[i];
      let h='';
      if(r.pm==='set'){
        h += c.inKg>0
          ? kv('วัตถุดิบรวม','<b>'+fmt(c.inKg,2)+' กก.</b>')+kv('ทุนรวม','<b>'+fmt(c.inCost,2)+' ฿</b>')
          : '<span class="pill warn">ยังไม่ได้กรอกน้ำหนักวัตถุดิบ</span>';
      }
      if(r.pm!=='set'){
        if(c.moveKg>0){
          const to=Object.keys(S.alloc).filter(k=>k.split('\u0001')[0]===r.n)
            .map(k=>k.split('\u0001')[1]+' '+fmt(N(S.alloc[k]),2)+' กก.');
          h+='<span class="pill warn">แบ่งไป: '+to.join(' · ')+'</span>';
        }
        if(c.y) h+=kv('เหลือ', fmt(c.y,1)+'%');
        if(N(r.ws)) h+=kv('ผักเสีย', fmt(N(r.ws),2)+' กก.');
        if(c.ckt) h+=kv('ทุน/กก.พร้อมขาย','<b>'+fmt(c.ckt,2)+'</b>');
        if(Math.abs(c.miss)>0.3) h+='<span class="pill bad">ตัวเลขไม่ลงตัว '+fmt(c.miss,2)+' กก.</span>';
      }
      if(c.exp) h+=kv('ควรได้', fmt(c.exp,1)+(r.pm==='set'?' ชุด':' ถุง'))+
        (c.df?'<span class="pill '+(Math.abs(c.df)>10?'warn':'good')+'">ต่าง '+(c.df>0?'+':'')+fmt(c.df,1)+'%</span>':'');
      if(c.sug) h+=kv('ควรขาย', fmt(c.sug,0)+' ฿');
      const sp=STD_PRICE[r.n];
      if(sp && S.date>=sp.from) h+='<span class="pill">ราคามาตรฐาน '+fmt(sp.price,0)+' ฿'+
        (sp.note?' · '+esc(sp.note):'')+'</span>';
      if(c.todayG) h+='<span class="pill '+(c.mustCut?'bad':'good')+'">วันนี้ใส่ถุงละ <b>'+
        fmt(c.todayG,0)+' กรัม</b>'+(c.mustCut?' (ลดจากมาตรฐาน '+fmt(c.stdG,0)+' ก.)':'')+
        ' → กำไร '+fmt(c.marginToday,0)+'%</span>';
      if(c.cpb) h+=kv('<b>ทุน/'+(r.pm==='set'?'ชุด':'ถุง')+'</b>','<b>'+fmt(c.cpb,2)+'</b>');
      if(c.pf)  h+='<span class="'+(c.pf<0?'neg':'pos')+'">กำไร/'+(r.pm==='set'?'ชุด':'ถุง')+' '+
        fmt(c.pf,2)+' ฿ ('+fmt(c.pc,0)+'%)</span>';
      if(c.rev) h+=kv('ยอดขาย', fmt(c.rev,2)+' ฿')+
        '<span class="'+(c.gp<0?'neg':'pos')+'">กำไรรวม '+fmt(c.gp,2)+' ฿</span>';
      e.innerHTML=h||'<span class="k">ยังไม่ได้กรอก</span>'; });
  }
  else if(MODE==='size'){
    S.weigh.forEach((r,i)=>{ const e=$('pw_'+i); if(!e)return; const c=calcWeigh(r);
      let h=kv('เหลือ',c.y?fmt(c.y,1)+'%':'')+
        kv('ผักเสีย',N(r.ws)?fmt(N(r.ws),2)+' กก.':'')+
        kv('ทุน/กก.หลังตัด',c.ckt?fmt(c.ckt,2):'')+kv('ทุนรวม',fmt(c.tot,2)+' ฿');
      if(c.pcs) h+=kv('ขายได้',fmt(c.pcs,0)+' หัว')+kv('เฉลี่ย/หัว',fmt(c.avg,2)+' ฿')+
        kv('<b>ยอดขาย</b>','<b>'+fmt(c.rev,2)+' ฿</b>')+
        '<span class="'+(c.gp<0?'neg':'pos')+'">กำไร '+fmt(c.gp,2)+' ฿ ('+fmt(c.pc,0)+'%)</span>';
      e.innerHTML=h||'<span class="k">ยังไม่ได้กรอก</span>'; });
  }
  else{
    directItems().forEach(n=>{ const e=$('pd_'+slug(n)); if(!e)return;
      const c=calcDirect(n), info=ITEM_INFO[n]||{};
      let h=kv(N((S.direct[n]||{}).q)?'ทุน/หน่วยที่ขาย':'ทุน/'+(info.u||'หน่วย'), fmt(c.cpu,2)+' ฿');
      if(c.sug) h+=kv('ควรขาย', fmt(c.sug,0)+' ฿');
      if(c.rev) h+=kv('<b>ยอดขาย</b>','<b>'+fmt(c.rev,2)+' ฿</b>')+
        '<span class="'+(c.gp<0?'neg':'pos')+'">กำไร '+fmt(c.gp,2)+' ฿ ('+fmt(c.pc,0)+'%)</span>';
      e.innerHTML=h||'<span class="k">ยังไม่ได้ลงราคาขาย</span>'; });
  }
}
/* ตารางน้ำหนักวันนี้ — ให้พนักงานดูแล้วชั่งตามได้เลย */
function paintGramSheet(C){
  const box=$('gramSheet'); if(!box) return;
  if(MODE!=='bag'){ box.innerHTML=''; return; }
  const rows=[];
  S.pack.forEach((r,i)=>{ const c=C[i];
    if(r.pm==='set' || !c.todayG) return;
    rows.push({n:r.n, c:c, used:N(r.g)});
  });
  if(!rows.length){ box.innerHTML=''; return; }
  rows.sort((a,b)=> (b.c.mustCut?1:0)-(a.c.mustCut?1:0) || a.n.localeCompare(b.n,'th'));
  const cut=rows.filter(x=>x.c.mustCut).length;
  box.innerHTML='<div class="gsheet"><h3>⚖️ น้ำหนักที่ควรใส่วันนี้'+
    '<small>อิงทุนจริงหลังตัดแต่งของวันนี้ · กำไรขั้นต่ำ 70%</small>'+
    (cut?'<small style="margin-left:auto;background:rgba(255,255,255,.22);padding:3px 10px;border-radius:99px">'+
      cut+' รายการต้องลดกรัม</small>':'')+'</h3>'+
    '<div style="overflow-x:auto"><table><thead><tr>'+
    '<th>รายการ</th><th>ใส่ถุงละ</th><th>มาตรฐาน</th><th>ทุน/กก.<br>พร้อมขาย</th>'+
    '<th>ราคาขาย</th><th>ทุน/ถุง</th><th>กำไร</th></tr></thead><tbody>'+
    rows.map(x=>{ const c=x.c;
      return '<tr'+(c.mustCut?' class="cut"':'')+'>'+
        '<td class="nm">'+vegIcon(x.n)+' '+esc(x.n)+'</td>'+
        '<td class="g">'+fmt(c.todayG,0)+'<small>กรัม</small></td>'+
        '<td class="n">'+(c.stdG?fmt(c.stdG,0)+' ก.':'—')+'</td>'+
        '<td class="n">'+fmt(c.ckt,2)+'</td>'+
        '<td class="n">'+fmt(N(S.pack.find(p=>p.n===x.n).s),0)+' ฿</td>'+
        '<td class="n">'+fmt(c.cpbToday,2)+'</td>'+
        '<td class="n"><b style="color:'+(c.marginToday>=c.minM?'#0a7d44':'#c0392b')+'">'+
          fmt(c.marginToday,0)+'%</b></td></tr>';
    }).join('')+'</tbody></table></div>'+
    '<div class="foot">แถวสีส้ม = ของแพงขึ้น ต้องลดกรัมลงจากมาตรฐานเพื่อรักษากำไร 70%<br>'+
    'ถ้าของถูกกว่าปกติจะใส่ตามมาตรฐานเท่าเดิม ไม่เพิ่มกรัมให้กำไรลด</div></div>';
}
let SLUGS={}, SLUGN=0;
function slug(n){ if(!SLUGS[n]) SLUGS[n]='i'+(++SLUGN); return SLUGS[n]; }

/* สินค้าแพ็กเกจพร้อมขาย — ของสำเร็จรูป แค่บวกกำไรติดราคา */
function directItems(){
  const used={}; S.pack.concat(S.weigh).forEach(r=>{ if(r.n) used[r.n]=1; });
  const out=[], seen={};
  READY_ITEMS.forEach(n=>{ if(used[n]) return;                      // รายการแพ็กสำเร็จที่ตั้งไว้ โชว์เสมอ
    if(S.buy[n]||S.direct[n]){ out.push(n); seen[n]=1; } });
  Object.keys(S.buy).forEach(n=>{                                   // ของอื่นที่ซื้อมาแต่ไม่ได้เข้าสายตัดแต่ง
    if(used[n]||seen[n]) return;
    if(calcBuy(S.buy[n],ITEM_INFO[n]).tot>0){ out.push(n); seen[n]=1; } });
  return out;
}
function calcDirect(name){
  const c=calcBuy(S.buy[name]||{}, ITEM_INFO[name]);
  const d=S.direct[name]||emptyDirect();
  const b=S.buy[name]||{}, recv=N(b.r)||N(b.o);
  const q=N(d.q), p=N(d.p), cost=c.tot, base=q>0?q:recv;
  const cpu=base>0?cost/base:0, sug=cpu>0?Math.ceil(cpu*(1+N(S.target)/100)/5)*5:0;
  const rev=q*p, gp=rev?rev-cost:0;
  return {cost,recv,cpu,sug,rev,gp,pc:(cost>0&&rev)?gp/cost*100:0};
}

/* ---------- แถบล็อกใบซื้อ ---------- */
function lockBarHTML(){
  const s=summarize();
  if(isLocked()){
    return '<div class="lockbar locked" id="lockBar">🔒 <b>ปิดใบซื้อแล้ว</b> — ยอดซื้อ '+fmt(s.ord,2)+
      ' บาท · ปิดโดย '+esc(S.lockedBy)+' '+new Date(S.lockedAt).toLocaleString('th-TH')+
      ' · แก้ราคาไม่ได้แล้ว'+
      (isOwner()?' <button class="btn sm" onclick="unlockBuy()">เปิดเพื่อแก้ (เจ้าของ)</button>':'')+
      (S.unlockNote?'<div style="color:var(--bad);width:100%">เคยเปิดแก้: '+esc(S.unlockNote)+'</div>':'')+
      '</div>';
  }
  return '<div class="lockbar" id="lockBar">✍️ <b>ใบซื้อยังเปิดอยู่</b> — ลงราคาให้ครบทุกรายการก่อน '+
    'แล้วกดปิดใบ จึงจะเห็นยอดเงินทอนที่ต้องส่งคืน<div style="width:100%">ยอดซื้อตอนนี้ <b>'+
    fmt(s.ord,2)+' บาท</b></div><button class="btn p" onclick="lockBuy()">🔒 ปิดใบซื้อ</button></div>';
}

/* ---------- แท็บ 6 : ตรวจเงินสด ---------- */
function paintCash(){
  const s=summarize();
  const tr=N(S.transferAmt), atm=N(S.atmAmt), ord=s.ord;
  const should = (isLocked()&&atm>0) ? atm-ord : null;      // เงินทอนที่ควรเหลือ (เห็นได้หลังปิดใบซื้อ)
  const back  = S.cashBack===''? null : N(S.cashBack);
  const gap   = (should!==null && back!==null) ? back-should : null;
  const sameP = S.countedBy && S.buyer && S.countedBy===S.buyer;

  let h='';
  h+='<div class="cashbox"><h3><span class="n">1</span>เงินตั้งต้น</h3>'+
     '<div class="crow"><span class="lb">คนไปซื้อ</span><input value="'+esc(S.buyer||'')+
       '" style="width:150px;text-align:left" oninput="setDay(\'buyer\',this.value)" placeholder="ชื่อ เช่น เอ"></div>'+
     '<div class="crow"><span class="lb">เงินที่โอนให้</span><input type="number" step="any" min="0" value="'+
       esc(S.transferAmt)+'" oninput="setDay(\'transferAmt\',this.value)"></div>'+
     '<div class="crow"><span class="lb">กดเงินสดจาก ATM ได้จริง</span><input type="number" step="any" min="0" value="'+
       esc(S.atmAmt)+'" oninput="setDay(\'atmAmt\',this.value)"></div>';
  if(tr&&atm&&Math.abs(atm-tr)>0.5)
    h+='<div class="crow"><span class="lb">ต่างจากที่โอน</span><span class="vl '+(atm<tr?'neg':'pos')+'">'+
       (atm-tr>0?'+':'')+fmt(atm-tr,2)+' ฿</span></div>';
  h+='</div>';

  h+='<div class="cashbox"><h3><span class="n">2</span>ซื้อผัก</h3>'+
     '<div class="crow"><span class="lb">ยอดซื้อด้วย<b>เงินสด</b></span><span class="vl">'+fmt(ord,2)+' ฿</span></div>'+
     (s.ordTransfer?'<div class="crow"><span class="lb">เสมียนโอนให้ร้าน (ไม่เกี่ยวกับเงินสด)</span><span class="vl">'+
       fmt(s.ordTransfer,2)+' ฿</span></div>':'')+
     '<div class="crow"><span class="lb">สถานะใบซื้อ</span><span class="vl">'+
       (isLocked()?'<span class="pill good">ปิดแล้ว</span>':'<span class="pill warn">ยังเปิดอยู่</span>')+'</span></div>';
  if(!isLocked()) h+='<div style="margin-top:9px"><button class="btn p" style="width:100%;padding:12px" onclick="lockBuy()">'+
    '🔒 ปิดใบซื้อ แล้วดูยอดเงินทอน</button><div style="font-size:12px;color:var(--dim);margin-top:7px;line-height:1.6">'+
    'ต้องปิดใบซื้อก่อน ถึงจะเห็นยอดเงินทอนที่ควรเหลือ — กันการย้อนกลับไปปรับราคาผักให้พอดีกับเงินที่เหลือ</div></div>';
  h+='</div>';

  h+='<div class="cashbox"><h3><span class="n">3</span>ส่งเงินทอนคืน</h3>';
  if(should===null){
    h+='<div class="bigres wait"><div class="t">เงินทอนที่ควรเหลือ</div><div class="v">🔒 ปิดใบซื้อก่อน</div></div>';
  }else{
    h+='<div class="crow"><span class="lb">เงินทอนที่ควรเหลือ (กด ATM − ยอดซื้อ)</span><span class="vl">'+
       fmt(should,2)+' ฿</span></div>';
  }
  h+='<div class="crow"><span class="lb">เงินสดที่นับได้จริง (เสมียนนับ)</span><input type="number" step="any" min="0" value="'+
     esc(S.cashBack)+'" oninput="setDay(\'cashBack\',this.value)"></div>'+
     '<div class="crow"><span class="lb">หมายเหตุ</span><input value="'+esc(S.cashNote||'')+
       '" style="width:170px;text-align:left" oninput="setDay(\'cashNote\',this.value)" placeholder="เช่น ค่าธรรมเนียม ATM"></div>';
  if(gap!==null){
    h+= Math.abs(gap)<0.5
      ? '<div class="bigres ok"><div class="t">ตรงกันพอดี</div><div class="v">ลงตัว ✓</div></div>'
      : '<div class="bigres no"><div class="t">เงิน'+(gap<0?'ขาด':'เกิน')+'</div><div class="v">'+
        (gap>0?'+':'')+fmt(gap,2)+' ฿</div></div>';
  }
  h+='</div>';

  h+='<div class="cashbox"><h3><span class="n">4</span>ยืนยัน 2 ฝ่าย</h3><div class="sign">';
  h+= S.returnedBy
    ? '<div class="signed">✓ '+esc(S.returnedBy)+' ส่งเงินคืนแล้ว<br><span style="color:var(--dim)">'+
      new Date(S.returnedAt).toLocaleString('th-TH')+'</span></div>'
    : '<button onclick="signReturn()">คนซื้อ ยืนยันส่งเงินคืน</button>';
  h+= S.countedBy
    ? '<div class="signed">✓ '+esc(S.countedBy)+' นับเงินแล้ว<br><span style="color:var(--dim)">'+
      new Date(S.countedAt).toLocaleString('th-TH')+'</span></div>'
    : '<button class="'+(S.returnedBy?'':'gray')+'" onclick="signCount()">เสมียน ยืนยันนับเงินแล้ว</button>';
  h+='</div>';
  if(sameP) h+='<div style="color:var(--bad);font-size:12.5px;margin-top:9px">'+
    '⚠ คนส่งเงินกับคนนับเงินเป็นคนเดียวกัน ควรให้คนละคนตรวจ</div>';
  h+='</div>';

  h+=flowHTML();

  const after=AUDIT_SEEN.filter(a=>a.after_lock);
  h+='<div class="cashbox"><h3><span class="n">6</span>ปูมการแก้ไขราคา</h3>';
  if(after.length) h+='<div style="color:var(--bad);font-size:13px;margin-bottom:8px">'+
    '⚠ มีการแก้ราคา '+after.length+' ครั้ง หลังปิดใบซื้อแล้ว</div>';
  h+='<div class="audit">'+ (AUDIT_SEEN.length
    ? AUDIT_SEEN.slice(0,25).map(a=>'<div class="ln'+(a.after_lock?' after':'')+'">'+
        new Date(a.changed_at).toLocaleTimeString('th-TH')+' · '+esc(a.changed_by||'-')+' · '+
        esc(a.item||'')+' '+esc(a.field)+': '+esc(a.old_value||'(ว่าง)')+' → '+esc(a.new_value||'(ว่าง)')+
        (a.after_lock?'  [หลังปิดใบ]':'')+'</div>').join('')
    : '<span style="color:var(--dim)">ยังไม่มีการแก้ไข</span>')+'</div></div>';
  $('cashBody').innerHTML=h;
}
/* ความต่อเนื่องการลงราคา: ลงทีละรายการระหว่างเดินตลาด หรือลงรวดเดียวตอนกลับ */
function priceEvents(){
  const ev=AUDIT_SEEN.filter(a=>a.field==='ราคารวม'&&a.item)
    .map(a=>({t:new Date(a.changed_at).getTime(), item:a.item, first:!a.old_value}));
  // เอาเฉพาะครั้งแรกของแต่ละรายการ = เวลาที่ลงราคาครั้งแรก
  const seen={}, out=[];
  ev.sort((a,b)=>a.t-b.t).forEach(e=>{ if(seen[e.item])return; seen[e.item]=1; out.push(e); });
  return out;
}
function flowHTML(){
  const ev=priceEvents();
  let h='<div class="cashbox"><h3><span class="n">5</span>ความต่อเนื่องการลงราคา</h3>';
  if(ev.length<2){
    return h+'<div style="color:var(--dim);font-size:13px;line-height:1.7">ยังมีข้อมูลไม่พอ'+
      '<br>ส่วนนี้จะดูว่าราคาถูกลงทีละรายการระหว่างเดินตลาด หรือลงรวดเดียวตอนกลับถึงโรงงาน'+
      '<br><span style="color:var(--bad)">หมายเหตุ: นับเฉพาะราคาที่พิมพ์ในแอป ข้อมูลที่ใส่จากปุ่มตัวอย่างไม่นับ</span></div></div>';
  }
  const t0=ev[0].t, t1=ev[ev.length-1].t, span=(t1-t0)/60000;      // นาที
  // หาช่วง 10 นาทีที่กระจุกที่สุด
  let burst=0, bAt=t0;
  for(let i=0;i<ev.length;i++){
    let c=0; for(let j=i;j<ev.length&&ev[j].t-ev[i].t<=10*60000;j++)c++;
    if(c>burst){ burst=c; bAt=ev[i].t; }
  }
  const ratio=burst/ev.length;
  const bad = ev.length>=5 && ratio>=0.6;
  const hhmm=t=>new Date(t).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'});

  h+='<div class="crow"><span class="lb">ลงราคาแล้ว</span><span class="vl">'+ev.length+' รายการ</span></div>'+
     '<div class="crow"><span class="lb">ตั้งแต่ – ถึง</span><span class="vl">'+hhmm(t0)+' – '+hhmm(t1)+'</span></div>'+
     '<div class="crow"><span class="lb">กินเวลา</span><span class="vl">'+
       (span>=60?Math.floor(span/60)+' ชม. '+Math.round(span%60)+' นาที':Math.round(span)+' นาที')+'</span></div>'+
     '<div class="crow"><span class="lb">กระจุกที่สุด (ช่วง 10 นาที)</span><span class="vl'+(bad?' neg':'')+'">'+
       burst+' รายการ ตอน '+hhmm(bAt)+'</span></div>';

  // กราฟแท่งราย 30 นาที
  const B=30*60000, n=Math.max(1,Math.min(16,Math.ceil((t1-t0)/B)+1));
  const buckets=new Array(n).fill(0);
  ev.forEach(e=>{ const i=Math.min(n-1,Math.floor((e.t-t0)/B)); buckets[i]++; });
  const mx=Math.max.apply(null,buckets)||1;
  h+='<div class="tl">'+buckets.map((c,i)=>'<div class="b'+(c/ev.length>=0.5?' hot':'')+
      '" style="height:'+Math.max(4,c/mx*100)+'%" title="'+c+' รายการ"><em>'+(c||'')+'</em>'+
      (i%2===0?'<span>'+hhmm(t0+i*B)+'</span>':'')+'</div>').join('')+'</div>';

  h+= bad
    ? '<div class="bigres no" style="margin-top:18px"><div class="t">ลงราคาแบบกระจุก</div>'+
      '<div class="v">'+Math.round(ratio*100)+'% ลงใน 10 นาที</div>'+
      '<div class="t" style="margin-top:6px">ควรถามว่าทำไมไม่ลงระหว่างซื้อ</div></div>'
    : '<div class="bigres ok" style="margin-top:18px"><div class="t">ลงราคากระจายตลอดช่วง</div>'+
      '<div class="v">ปกติ ✓</div></div>';
  return h+'</div>';
}

function signReturn(){
  if(!isLocked()){ toast('ต้องปิดใบซื้อก่อน'); return; }
  S.returnedBy=USER?USER.name:''; S.returnedAt=new Date().toISOString();
  logChange('','ยืนยันส่งเงินคืน','',S.returnedBy); markDirty('day','x'); push(); paintCash();
}
function signCount(){
  if(!S.returnedBy){ toast('รอคนซื้อยืนยันส่งเงินก่อน'); return; }
  if(S.cashBack===''){ toast('กรอกเงินสดที่นับได้ก่อน'); return; }
  S.countedBy=USER?USER.name:''; S.countedAt=new Date().toISOString();
  logChange('','ยืนยันนับเงิน','',S.countedBy+' = '+fmt(N(S.cashBack),2)+' ฿');
  markDirty('day','x'); push(); paintCash();
}

/* ---------- แท็บ 7 : สรุป ---------- */
function summarize(){
  let ord=0,ordTransfer=0,got=0,overBaht=0,overList=[],shortKg=0,shortBaht=0,shortList=[];
  let cost=0,rev=0,loss=[],noPrice=[],unsold=0,spikes=[];
  Object.keys(S.buy).forEach(n=>{
    const r=S.buy[n], c=calcBuy(r,ITEM_INFO[n]);
    if((r.pm||'cash')==='transfer') ordTransfer+=N(r.pr); else ord+=N(r.pr);
    got+=c.tot;
    const o=N(r.o), rq=N(r.r);
    if(o>0&&rq>0&&rq<o){ const d=N(r.pr)-c.tot;
      if(d>0){ overBaht+=d; overList.push(n+' ขาด '+fmt(o-rq,0)+' '+((ITEM_INFO[n]||{}).u||'')+' = '+fmt(d,2)+' ฿'); } }
    if(c.dw<0&&c.pkg>0){ shortKg+=-c.dw; shortBaht+=-c.dw*c.pkg;
      if(c.dp<-5) shortList.push(n+' '+fmt(c.dw,2)+' กก.'); }
    const hh=HIST[n];
    if(hh&&hh.n>=3&&c.real>0){ const up=(c.real-hh.med)/hh.med*100;
      if(up>20) spikes.push(n+' '+fmt(c.real,2)+' (ปกติ '+fmt(hh.med,2)+' · +'+fmt(up,0)+'%)'); }
  });
  const C=CP();
  S.pack.forEach((r,i)=>{ const c=C[i];
    if(c.tot>0){ if(c.rev>0){ cost+=c.tot; rev+=c.rev; if(c.gp<0)loss.push(r.n); }
                 else { unsold+=c.tot; noPrice.push(r.n); } } });
  S.weigh.forEach(r=>{ const c=calcWeigh(r);
    if(c.tot>0){ if(c.rev>0){ cost+=c.tot; rev+=c.rev; if(c.gp<0)loss.push(r.n); }
                 else { unsold+=c.tot; noPrice.push(r.n); } } });
  const dOpen=[];
  directItems().forEach(n=>{ const c=calcDirect(n);
    if(c.rev>0){ cost+=c.cost; rev+=c.rev; if(c.gp<0)loss.push(n); }
    else { unsold+=c.cost; dOpen.push(n); } });
  const cashOut=N(S.atmAmt), cashBack=N(S.cashBack);
  const cashGap = (cashOut>0 && S.cashBack!=='') ? cashBack-(cashOut-ord) : 0;
  const profit=rev-cost;
  return {ord,ordTransfer,got,overBaht,overList,shortKg,shortBaht,shortList,spikes,cashOut,cashBack,cashGap,
          cost,rev,profit,unsold,dOpen,noPrice,loss,
          mg:cost>0?profit/cost*100:0, billDiff:N(S.bill)?ord-N(S.bill):0, C};
}
const kcard=(t,v,c)=>'<div class="kpi"><span>'+t+'</span><b class="'+(c||'')+'">'+v+'</b></div>';
function paintSummary(){
  const _d=new Date(S.date+'T00:00:00');
  const _thai = isNaN(_d) ? S.date
    : 'วัน'+THAI_DAY[_d.getDay()]+'ที่ '+_d.getDate()+' '+THAI_MON[_d.getMonth()]+' '+(_d.getFullYear()+543);
  $('printHead').textContent='รายงานต้นทุน–ราคาขายผัก ประจำ'+_thai+
    (S.orderedBy?'  ·  คนสั่ง: '+S.orderedBy:'')+(S.buyer?'  ·  คนซื้อ: '+S.buyer:'')+
    (S.by?'  ·  ผู้บันทึก: '+S.by:'');
  void 0;
  const s=summarize();
  $('kpi').innerHTML=
    kcard('ยอดซื้อเงินสด', fmt0(s.ord,2)+' ฿')+
    kcard('ยอดโอนให้ร้าน', s.ordTransfer?fmt(s.ordTransfer,2)+' ฿':'—')+
    kcard('กด ATM', s.cashOut?fmt(s.cashOut,2)+' ฿':'—')+
    kcard('เงินทอนที่นับได้', S.cashBack!==''?fmt(s.cashBack,2)+' ฿':'—')+
    kcard('เงินขาด/เกิน', (s.cashOut&&S.cashBack!=='')?(s.cashGap>0?'+':'')+s.cashGap.toFixed(2)+' ฿':'—',
          (s.cashOut&&S.cashBack!==''&&Math.abs(s.cashGap)>1)?'neg':'pos')+
    kcard('ต่างจากบิล', N(S.bill)?(s.billDiff>0?'+':'')+s.billDiff.toFixed(2)+' ฿':'—',
          Math.abs(s.billDiff)>1?'neg':'pos')+
    kcard('บิลเก็บเกินของที่ได้', s.overBaht?fmt(s.overBaht,2)+' ฿':'— ตรงกัน', s.overBaht?'neg':'pos')+
    kcard('น้ำหนักขาดจากบรรจุ', s.shortKg?fmt(s.shortKg,2)+' กก. = '+fmt(s.shortBaht,0)+' ฿':'—', s.shortKg?'neg':'')+
    kcard('ทุนที่ลงราคาขายแล้ว', fmt0(s.cost,2)+' ฿')+
    kcard('ทุนที่ยังไม่ลงราคา', s.unsold?fmt(s.unsold,2)+' ฿':'— ครบแล้ว', s.unsold?'neg':'pos')+
    kcard('ยอดขายคาดการณ์', fmt0(s.rev,2)+' ฿')+
    kcard('กำไรคาดการณ์', fmt0(s.profit,2)+' ฿', s.profit<0?'neg':'pos')+
    kcard('% กำไรต่อทุน', fmt0(s.mg,1)+' %', s.mg<0?'neg':'pos');
  const a=[];
  if(s.cashOut&&S.cashBack!==''&&Math.abs(s.cashGap)>1)
    a.push('<span class="neg">เงินสด'+(s.cashGap<0?'ขาด':'เกิน')+' '+Math.abs(s.cashGap).toFixed(2)+
      ' บาท:</span> ควรเหลือ '+fmt(s.cashOut-s.ord,2)+' แต่นับได้ '+fmt(s.cashBack,2)+' — ดูแท็บเงินสด');
  if(!isLocked()&&s.ord) a.push('<span class="neg">ยังไม่ได้ปิดใบซื้อ</span> — ราคายังแก้ได้อยู่');
  if(s.spikes.length) a.push('<span class="neg">ราคาสูงผิดปกติเทียบ 30 วันย้อนหลัง:</span> '+s.spikes.join(' · ')+' — ขอดูเหตุผล');
  if(s.overList.length) a.push('<span class="neg">บิลเก็บเงินแต่ของมาไม่ครบ '+fmt(s.overBaht,2)+' บาท:</span> '+
    s.overList.join(' · ')+' — ขอเงินคืนหรือหักบิลครั้งหน้า');
  if(s.shortList.length) a.push('<span class="neg">ชั่งแล้วขาดเกิน 5%:</span> '+s.shortList.join(' · ')+' — ควรทักร้านค้าส่ง');
  if(s.loss.length) a.push('<span class="neg">ขาดทุน:</span> '+s.loss.join(', ')+' — ราคาขายต่ำกว่าทุน');
  const open=s.noPrice.concat(s.dOpen);
  if(open.length) a.push('ยังไม่ได้ลงราคาขาย '+open.length+' รายการ (ทุนรวม '+fmt(s.unsold,2)+' ฿): '+
    open.slice(0,8).join(', ')+(open.length>8?' …':'')+' — ลงให้ครบแล้ว % กำไรจะเป็นของทั้งวันจริง');
  else a.push('<span class="pos">ลงราคาขายครบทุกรายการแล้ว</span> — ตัวเลขกำไรด้านบนคือกำไรทั้งวันจริง');
  $('alerts').innerHTML=a.join('<br>')||'กรอกข้อมูลเพื่อดูสรุป';
  buildTables(s);
  const ds=Object.keys(localStorage).filter(k=>k.indexOf('veg:')===0).map(k=>k.slice(4)).sort().reverse().slice(0,20);
  paintUsers();
  $('hist').innerHTML = ds.map(d=>{ const x=new Date(d+'T00:00:00');
    const lab = isNaN(x) ? d : 'วัน'+THAI_DAY[x.getDay()]+'ที่ '+x.getDate()+' '+THAI_MON[x.getMonth()]+' '+(x.getFullYear()+543);
    return '<a href="#" onclick="jump(\''+d+'\');return false"><span>'+lab+
      (d===S.date?' · เปิดอยู่':'')+'</span><span>เปิด →</span></a>'; }).join('')
    || '<div class="empty">ยังไม่มีข้อมูลย้อนหลัง</div>';
}
function buildTables(s){
  let h1='<table><thead><tr><th>รายการ</th><th>สั่ง</th><th>ราคารวม</th>'+
    '<th>ราคา/กก.</th><th>รับ</th><th>ชั่งได้</th><th>ขาด/เกิน</th><th>ทุนจ่ายจริง</th><th>ทุน/กก.จริง</th></tr></thead><tbody>';
  ITEMS.forEach(it=>{ const n=it[1], r=S.buy[n]; if(!r)return;
    const c=calcBuy(r,ITEM_INFO[n]); if(!c.tot&&!N(r.w)&&!N(r.o))return;
    h1+='<tr><td>'+esc(n)+'</td><td class="n">'+esc(r.o||'')+'</td><td class="n">'+fmt(N(r.pr),2)+'</td>'+
      '<td class="n">'+fmt(c.pkg,2)+'</td><td class="n">'+esc(r.r||'')+'</td><td class="n">'+fmt(N(r.w),2)+'</td>'+
      '<td class="n'+(c.dp<-5?' neg':'')+'">'+(c.dw?(c.dw>0?'+':'')+fmt(c.dw,2):'')+'</td>'+
      '<td class="n">'+fmt(c.tot,2)+'</td><td class="n"><b>'+fmt(c.real,2)+'</b></td></tr>'; });
  h1+='</tbody></table>';

  let h2='<table><thead><tr><th>รายการ</th><th>นน.รับ</th><th>แบ่งไปทำชุด</th><th>หลังตัดแต่ง</th><th>ผักเสีย</th><th>เหลือ%</th>'+
    '<th>ก./ถุง</th><th>ควรได้</th><th>ได้จริง</th><th>ทุน/ถุง</th><th>ราคาขาย</th>'+
    '<th>กำไร/ถุง</th><th>ยอดขาย</th><th>กำไรรวม</th></tr></thead><tbody>'; let any2=false;
  S.pack.forEach((r,i)=>{ const c=s.C[i]; if(!c.tot&&!N(r.bg))return; any2=true;
    h2+='<tr><td>'+esc(r.n)+'</td>'+
      '<td class="n">'+fmt(N(r.w),2)+'</td><td class="n">'+(s.C[i].moveKg?fmt(s.C[i].moveKg,2):'')+'</td><td class="n">'+fmt(N(r.t),2)+'</td>'+
      '<td class="n">'+fmt(N(r.ws),2)+'</td><td class="n">'+fmt(c.y,1)+'</td><td class="n">'+esc(r.g||'')+'</td>'+
      '<td class="n">'+fmt(c.exp,1)+'</td><td class="n">'+esc(r.bg||'')+'</td><td class="n"><b>'+fmt(c.cpb,2)+'</b></td>'+
      '<td class="n">'+esc(r.s||'')+'</td><td class="n'+(c.pf<0?' neg':'')+'">'+fmt(c.pf,2)+'</td>'+
      '<td class="n">'+fmt(c.rev,2)+'</td><td class="n'+(c.gp<0?' neg':'')+'">'+fmt(c.gp,2)+'</td></tr>'; });
  h2+='</tbody></table>';

  let h3='<table><thead><tr><th>รายการ</th><th>นน.รับ</th><th>หลังตัดแต่ง</th><th>ผักเสีย</th><th>ทุนรวม</th>'+
    TIERS.map(t=>'<th>'+t+'฿</th>').join('')+'<th>รวมหัว</th><th>ยอดขาย</th><th>กำไรรวม</th><th>กำไร%</th></tr></thead><tbody>';
  let any3=false;
  S.weigh.forEach(r=>{ const c=calcWeigh(r); if(!c.tot&&!c.pcs)return; any3=true;
    h3+='<tr><td>'+esc(r.n)+'</td><td class="n">'+fmt(N(r.w),2)+'</td>'+
      '<td class="n">'+fmt(N(r.t),2)+'</td><td class="n">'+fmt(N(r.ws),2)+'</td><td class="n">'+fmt(c.tot,2)+'</td>'+
      r.c.map(x=>'<td class="n">'+(N(x)||'')+'</td>').join('')+
      '<td class="n">'+fmt(c.pcs,0)+'</td><td class="n"><b>'+fmt(c.rev,2)+'</b></td>'+
      '<td class="n'+(c.gp<0?' neg':'')+'">'+fmt(c.gp,2)+'</td><td class="n">'+fmt(c.pc,0)+'%</td></tr>'; });
  h3+='</tbody></table>';

  let h4='<table><thead><tr><th>รายการ</th><th>ทุนรวม</th><th>รับมา</th><th>ทุน/หน่วย</th><th>ขายได้</th>'+
    '<th>ราคาขาย</th><th>ยอดขาย</th><th>กำไร</th><th>กำไร%</th></tr></thead><tbody>'; let any4=false;
  directItems().forEach(n=>{ const c=calcDirect(n), d=S.direct[n]||emptyDirect(); if(!c.rev)return; any4=true;
    h4+='<tr><td>'+esc(n)+'</td><td class="n">'+fmt(c.cost,2)+'</td><td class="n">'+fmt(c.recv,0)+'</td>'+
      '<td class="n">'+fmt(c.cpu,2)+'</td><td class="n">'+esc(d.q||'')+'</td><td class="n">'+esc(d.p||'')+'</td>'+
      '<td class="n"><b>'+fmt(c.rev,2)+'</b></td><td class="n'+(c.gp<0?' neg':'')+'">'+fmt(c.gp,2)+'</td>'+
      '<td class="n">'+fmt(c.pc,0)+'%</td></tr>'; });
  h4+='</tbody></table>';

  $('sumTable').innerHTML =
    '<div class="tblTitle">ใบที่ 1 · สั่ง + ซื้อ + รับเข้า</div>'+h1+
    (any2?'<div class="tblTitle">ใบที่ 2 · ตัดแต่ง &amp; แพคถุง</div>'+h2:'')+
    (any3?'<div class="tblTitle">ใบที่ 3 · คัดไซส์ขาย</div>'+h3:'')+
    (any4?'<div class="tblTitle">ใบที่ 4 · สินค้าแพ็กเกจพร้อมขาย</div>'+h4:'');
}
function jump(d){ $('dt').value=d; openDay(d); }

/* ---------- จัดการผู้ใช้ (เฉพาะเจ้าของ) ---------- */
let OWNER_CODE = '';
async function rpc(fn, body){
  const r = await fetch(CFG.url+'/rest/v1/rpc/'+fn, {method:'POST', headers:H(), body:JSON.stringify(body)});
  if(!r.ok) throw new Error(fn+' '+r.status);
  return r.json();
}
function askOwnerCode(){
  if(OWNER_CODE) return OWNER_CODE;
  const c = prompt('ยืนยันรหัสผ่านของเจ้าของ');
  if(c) OWNER_CODE = c.trim();
  return OWNER_CODE;
}
async function paintUsers(){
  const box = $('userAdmin'); if(!box) return;
  box.classList.toggle('hide', !(USER && USER.role==='owner' && ONLINE));
  if(box.classList.contains('hide')) return;
  try{
    const rows = await rpc('veg_user_list', {});
    $('userRows').innerHTML = rows.map(u=>
      '<div class="crow"><span class="lb">'+(u.role==='owner'?'👑 ':'👤 ')+esc(u.name)+
      '<span class="k"> · '+(u.role==='owner'?'เจ้าของ':'พนักงาน')+'</span></span>'+
      (u.role==='owner' ? '<span class="k">ลบไม่ได้</span>'
        : '<button class="btn sm" onclick="removeUser(\''+jq(u.name)+'\')">ลบ</button>')+
      '</div>').join('') || '<span class="k">ยังไม่มีผู้ใช้</span>';
  }catch(e){ $('userRows').innerHTML='<span class="k">โหลดรายชื่อไม่ได้</span>'; }
}
async function saveUser(){
  const n=$('nuName').value.trim(), c=$('nuCode').value.trim(), r=$('nuRole').value;
  const msg=$('userMsg');
  if(!n||!c){ msg.innerHTML='<span class="neg">กรอกชื่อและรหัสให้ครบ</span>'; return; }
  const oc=askOwnerCode(); if(!oc) return;
  try{
    const res = await rpc('veg_user_save',
      {p_owner:USER.name, p_owner_code:oc, p_name:n, p_code:c, p_role:r});
    if(res==='ok'){ msg.innerHTML='<span class="pos">บันทึก '+esc(n)+' แล้ว</span>';
      $('nuName').value=''; $('nuCode').value=''; paintUsers(); loadUserList(); }
    else { msg.innerHTML='<span class="neg">'+esc(res)+'</span>'; OWNER_CODE=''; }
  }catch(e){ msg.innerHTML='<span class="neg">บันทึกไม่สำเร็จ</span>'; }
}
async function removeUser(n){
  if(!confirm('ปิดการใช้งานบัญชี "'+n+'" ?\nข้อมูลที่เคยกรอกยังอยู่ครบ')) return;
  const oc=askOwnerCode(); if(!oc) return;
  try{
    const res = await rpc('veg_user_remove', {p_owner:USER.name, p_owner_code:oc, p_name:n});
    if(res==='ok'){ $('userMsg').innerHTML='<span class="pos">ปิดบัญชี '+esc(n)+' แล้ว</span>';
      paintUsers(); loadUserList(); }
    else { $('userMsg').innerHTML='<span class="neg">'+esc(res)+'</span>'; OWNER_CODE=''; }
  }catch(e){ $('userMsg').innerHTML='<span class="neg">ทำรายการไม่สำเร็จ</span>'; }
}

/* ---------- ใบสั่ง: คัดลอก/ส่งไลน์ ---------- */
function orderText(){
  const L=['ใบสั่งผัก '+S.date+(S.orderedBy?'  (คนสั่ง: '+S.orderedBy+')':'')];
  ITEMS.forEach(it=>{ const n=it[1], r=S.buy[n]||{}, tot=N(r.o);
    if(!tot) return;
    L.push('• '+n+' '+tot+' '+((ITEM_INFO[n]||{}).u||'')); });
  if(L.length===1) L.push('(ยังไม่ได้สั่งอะไร)');
  return L.join('\n');
}
function copyOrder(){
  const t=orderText(), done=()=>toast('คัดลอกใบสั่งแล้ว — วางในไลน์ได้เลย');
  if(navigator.clipboard&&navigator.clipboard.writeText)
    navigator.clipboard.writeText(t).then(done,()=>fallbackCopy(t,done));
  else fallbackCopy(t,done);
}
function fallbackCopy(t,done){
  const a=document.createElement('textarea'); a.value=t;
  a.style.position='fixed'; a.style.opacity='0'; document.body.appendChild(a); a.select();
  try{ document.execCommand('copy'); done(); }catch(e){ prompt('คัดลอกข้อความนี้',t); }
  document.body.removeChild(a);
}
function shareOrder(){
  const t=orderText();
  if(navigator.share) navigator.share({title:'ใบสั่งผัก '+S.date, text:t}).catch(()=>{});
  else copyOrder();
}
function toast(t){ const e=$('toast'); e.textContent=t; e.classList.add('on');
  setTimeout(()=>e.classList.remove('on'),1800); }

/* ---------- CSV ---------- */
function csv(){
  const q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
  const L=['ใบสั่ง+ซื้อ+รับเข้า,'+S.date+',คนสั่ง,'+q(S.orderedBy)+',คนซื้อ,'+q(S.buyer),
    'รายการ,ขนาดบรรจุ,หน่วย,วิธีจ่าย,จำนวนที่สั่ง,ราคารวม,ราคา/หน่วย,นน.ตามบิล,ราคา/กก.บิล,รับเข้า,ชั่งได้จริง,ขาด/เกิน,ทุนจ่ายจริง,ทุน/กก.จริง'];
  ITEMS.forEach(it=>{ const n=it[1], r=S.buy[n]; if(!r)return;
    const c=calcBuy(r,ITEM_INFO[n]); if(!c.tot&&!N(r.w))return;
    L.push([q(n),it[2],it[3],(r.pm==='transfer'?'โอน':'เงินสด'),r.o,r.pr,c.pu.toFixed(2),c.bw.toFixed(2),
      c.pkg.toFixed(2),r.r,r.w,c.dw?c.dw.toFixed(2):'',c.tot.toFixed(2),c.real.toFixed(2)].join(',')); });
  L.push('','ตัดแต่ง & แพคถุง',
    'รายการ,นน.รับ,แบ่งไปทำชุด,หลังตัดแต่ง,ผักเสีย,เหลือ%,กรัม/ถุง,ควรได้,ได้จริง,ทุน/ถุง,ราคาขาย,กำไร/ถุง,ยอดขาย,กำไรรวม');
  const C=CP();
  S.pack.forEach((r,i)=>{ const c=C[i]; if(!c.tot&&!N(r.bg))return;
    L.push([q(r.n),r.w,c.moveKg?c.moveKg.toFixed(2):'',r.t,r.ws,c.y.toFixed(1),
      r.g,c.exp.toFixed(1),r.bg,c.cpb.toFixed(2),r.s,c.pf.toFixed(2),c.rev.toFixed(2),c.gp.toFixed(2)].join(',')); });
  L.push('','คัดไซส์ขาย',
    ['รายการ','นน.รับ','หลังตัดแต่ง','ผักเสีย','ทุนรวม'].concat(TIERS.map(t=>t+'฿')).concat(['รวมหัว','ยอดขาย','กำไรรวม']).join(','));
  S.weigh.forEach(r=>{ const c=calcWeigh(r); if(!c.tot&&!c.pcs)return;
    L.push([q(r.n),r.w,r.t,r.ws,c.tot.toFixed(2)].concat(r.c.map(x=>x||0))
      .concat([c.pcs,c.rev.toFixed(2),c.gp.toFixed(2)]).join(',')); });
  L.push('','แบ่งผักไปทำชุด','ผักต้นทาง,ไปชุด,กก.,ทุนที่ย้ายไป');
  Object.keys(S.alloc||{}).forEach(k=>{ const i=k.indexOf('\u0001');
    const f=k.slice(0,i), t=k.slice(i+1), kg=N(S.alloc[k]);
    const src=S.pack.find(x=>x.n===f)||S.weigh.find(x=>x.n===f);
    L.push([q(f),q(t),kg,(kg*(src?N(src.ck):0)).toFixed(2)].join(',')); });
  L.push('','สินค้าแพ็กเกจพร้อมขาย','รายการ,ทุนรวม,รับมา,ทุน/หน่วย,ขายได้,ราคาขาย,ยอดขาย,กำไร');
  directItems().forEach(n=>{ const c=calcDirect(n), d=S.direct[n]||emptyDirect(); if(!c.rev)return;
    L.push([q(n),c.cost.toFixed(2),c.recv,c.cpu.toFixed(2),d.q,d.p,c.rev.toFixed(2),c.gp.toFixed(2)].join(',')); });
  const b=new Blob(['﻿'+L.join('\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download='ผัก-'+S.date+'.csv'; a.click();
  toast('ดาวน์โหลดแล้ว');
}

/* ---------- ตัวอย่างข้อมูลจริง 4 ต.ค. 69 ---------- */
function demo(){
  /* [สั่งแรก, สั่งเพิ่ม, ราคารวม, นน.ตามบิล, ชั่งได้จริง] */
  const B={'กะหล่ำปลี':[2,1,450,'',32.27],'ผักกาดขาว':[1,4,1500,'',52.53],'คะน้า':[1,0,260,'',5.60],
   'กวางตุ้ง':[2,0,'','',''],'หัวไชเท้า':[2,1,540,'',30.68],'มะเขือยาว':[2,0,400,'',10.41],
   'มะเขือเปราะ':[1,0,500,'',10.07],'กระเทียมจีน':[1,0,520,'',9.76],'ถั่วฝักยาว':[1,0,400,'',10.77],
   'ผักชี':[3,2,550,'',5.01],'ผักชีล้อม':[4,0,600,'',4.00],'ต้นหอม':[3,3,840,'',6.12],
   'ผักชีใบเลื่อย':[2,0,140,'',2.04],'ใบโหระพา':[1,0,150,'',1.14],'ใบกระเพรา':[1,0,120,'',1.02],
   'ข้าวโพดถาด':[30,0,480,'',''],'ขิงซอย':[5,0,150,'',5.30],'เห็ดหูหนู':[3,0,165,'',''],
   'ชุดแกงป่า':[25,0,250,'',''],'พริกหอม':[3,0,480,'',2.83],'พริกเม็ดใหญ่แดง':[1,0,70,'',0.99],
   'พริกเม็ดใหญ่เขียว':[1,0,55,'',1.01],'ขนมจีน 1 กก. (5 ชิ้น/หัว)':[4,0,420,'',''],
   'หอมแขก':[1,0,160,'',5.02],'พริกแห้งเม็ดเล็ก':[1,0,600,'',4.90],'เห็ดครีมแพ็ค':[15,0,195,'',''],
   'เห็ดเข็มทอง (20 ชิ้น/ลัง)':[3,0,'','',''],'กวางตุ้งฮ่องเต้':[1,2,'','',4.97],'มันฝรั่ง':[1,0,'','',''],
   'เห็ดขาว (แพ็ค)':[30,0,'','',''],'เห็ดดำ (แพ็ค)':[15,0,'','',''],'เห็ดออรินจิ (แพ็ค)':[30,0,'','',''],
   'บล็อกโคลี่':[20,0,'','',''],'แครอท':[1,0,'','',''],'หอมหัวใหญ่':[3,0,'','',15.62],
   'กะหล่ำปลีม่วง':[5,0,109,3.1,3.16],'กะหล่ำปลีดอก':[10,0,200,4.0,4.81],
   'ข้าวโพดหวาน':[2,0,280,'',21.29],'ฟักทอง':[4,0,300,20,19.84],'มะเขือเทศ':[1,0,120,'',5.10],
   'พริกหยวก':[1,0,'','',''],'ผักกาดดอง':[10,0,200,'',''],'แตงกวา':[1,0,400,'',10.21],
   'ผักบุ้ง':[1,4,1900,'',22.49],'พริกซุปเปอร์':[2,0,550,'',9.87],
   'ขนมจีน 0.5 กก. (10 ชิ้น/หัว)':[2,0,210,'',''],'ผักกาดแก้ว':[5,0,170,3.4,3.49],
   'เห็ดขาว (กก.)':[1,0,'','',''],'เห็ดออรินจิ (กก.)':[1,0,'','',''],'ชุดผักรวม':[20,0,'','','']};
  Object.keys(B).forEach(n=>{ const v=B[n], tot=N(v[0])+N(v[1]);
    S.buy[n]={o:tot||'',pr:v[2],bw:v[3],r:tot||'',w:v[4],pm:'cash'};
    markDirty('buy',n); });
  /* [หลังตัดแต่ง, กรัม/ถุง, ได้จริงถุง, ราคาขาย] */
  const P={'ผักชีใบเลื่อย':[1.97,40,34,10],'ใบโหระพา':[0.99,40,26,10],'ใบกระเพรา':[0.95,50,19,10],
   'คะน้า':[4.76,200,22,20],'ผักชี':[4.50,150,31,15],'ต้นหอม':[4.88,110,43,15],
   'ผักชี-ต้นหอม':['',60,72,20],'ผักชีล้อม':[3.84,60,65,15],'ผักบุ้ง':[15.52,175,96,25]};
  S.pack.forEach(r=>{ const v=P[r.n]; if(v){ r.t=v[0];r.g=v[1];r.bg=v[2];r.s=v[3]; markDirty('pack',r.n);} });
  /* ตัวอย่างถุงราคาคงที่: กระเทียมจีน ขายถุงละ 10 บาท */
  /* [หลังตัดแต่ง, {ราคา:จำนวน}] */
  const W={'ผักกาดขาว':[35.61,{30:3,35:3,40:8,45:6,50:8,60:16},42.05],
           'กะหล่ำปลี':[21.17,{20:10,25:15,30:7,35:9,40:1}],
           'ผักกาดแก้ว':[2.51,{50:2,70:3}]};
  S.weigh.forEach(r=>{ const v=W[r.n]; if(v){ r.t=v[0];
    TIERS.forEach((t,j)=>{ r.c[j]=v[1][t]||''; }); markDirty('weigh',r.n); } });
  S.bill=14434; S.orderedBy='เสมียน'; S.buyer='mai';
  refreshLinks(); render(); toast('ใส่ตัวอย่างแล้ว');
}

/* ---------- เริ่มต้น ---------- */
function startApp(){
  $('login').classList.add('hide');
  setSync(ONLINE?'on':'off', ONLINE?'ซิงก์แล้ว':'เก็บในเครื่อง');
  document.body.insertAdjacentHTML('beforeend',
    '<datalist id="items">'+ITEMS.map(r=>'<option value="'+esc(r[1])+'">').join('')+'</datalist>');
  $('dt').onchange=e=>openDay(e.target.value);
  openDay($('dt').value||today());
  if(ONLINE){
    setInterval(()=>{ if(dirty.size) push(); }, 20000);
    setInterval(()=>{ if(!dirty.size && document.visibilityState==='visible')
      pull(S.date).then(ok=>{ if(ok) renderTab(); }); }, 150000);
  }
  window.addEventListener('beforeunload',saveLocal);
}
(function boot(){
  $('dt').value=today();
  if(!ONLINE){ USER={name:'พนักงาน',role:'staff'}; startApp(); return; }
  const u=localStorage['veg.user'];
  if(u){ try{ USER=JSON.parse(u); startApp(); return; }catch(e){} }
  $('login').classList.remove('hide');
  loadUserList();
})();
