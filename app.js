const $=id=>document.getElementById(id);
const store={
  get(){return {sm:localStorage.getItem('fsai_sm')||'',fd:localStorage.getItem('fsai_fd')||'',odds:localStorage.getItem('fsai_odds')||''}},
  set(v){localStorage.setItem('fsai_sm',v.sm||'');localStorage.setItem('fsai_fd',v.fd||'');localStorage.setItem('fsai_odds',v.odds||'')},
  clear(){['fsai_sm','fsai_fd','fsai_odds'].forEach(k=>localStorage.removeItem(k))}
};
const state={date:null,games:[],selected:null,timer:null,busy:false,analysisBusy:false};
function headers(){const k=store.get();const h={};if(k.sm)h['x-sportmonks-token']=k.sm;if(k.fd)h['x-football-data-token']=k.fd;if(k.odds)h['x-odds-api-key']=k.odds;return h}
function dateKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function dayLabel(d,i){if(i===0)return'Hoje';if(i===1)return'Amanhã';return d.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit'}).replace('.','')}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function fmtTime(f){const d=new Date(f.start||f.timestamp);return isNaN(d)?'--:--':d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}
function renderDays(){
  const now=new Date();let html='';
  for(let i=0;i<8;i++){const d=new Date(now);d.setDate(d.getDate()+i);const key=dateKey(d);html+=`<button class="day ${state.date===key?'active':''}" data-date="${key}">${dayLabel(d,i)}</button>`}
  $('days').innerHTML=html;
  document.querySelectorAll('.day').forEach(b=>b.onclick=()=>{state.date=b.dataset.date;state.selected=null;renderDays();loadGames()})
}
function renderLeagues(){
  const current=$('league').value;
  const leagues=[...new Set(state.games.map(g=>g.league).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  $('league').innerHTML='<option value="">Todos os campeonatos</option>'+leagues.map(x=>`<option>${esc(x)}</option>`).join('');
  if(leagues.includes(current))$('league').value=current;
}
function filtered(){
  const q=$('search').value.trim().toLowerCase(), lg=$('league').value;
  return state.games.filter(g=>(!lg||g.league===lg)&&(!q||`${g.home.name} ${g.away.name} ${g.league}`.toLowerCase().includes(q)));
}
function renderGames(){
  const rows=filtered();
  $('count').textContent=`${rows.length} jogo${rows.length===1?'':'s'} • ${state.date===dateKey(new Date())?'Hoje':state.date}`;
  if(!rows.length){$('games').innerHTML='<div class="empty">Nenhum jogo encontrado neste filtro.</div>';return}
  const groups=new Map();
  for(const g of rows){const k=g.league||'Outros campeonatos';if(!groups.has(k))groups.set(k,[]);groups.get(k).push(g)}
  let html='';
  for(const [league,list] of groups){
    html+=`<div class="league"><div class="league-title"><b>${esc(league)}</b><span>${list.length} jogo${list.length===1?'':'s'}</span></div>`;
    for(const g of list){
      const open=state.selected===g.id;
      const score=(g.score?.home!==null&&g.score?.away!==null)?`<span class="score">${g.score.home}–${g.score.away}</span>`:'';
      html+=`<div class="match ${open?'open':''}" data-id="${esc(g.id)}">
        <div class="match-top"><div class="time">${fmtTime(g)}</div><div class="teams"><div class="team">${esc(g.home.name)}</div><div class="team">${esc(g.away.name)}</div></div>
        <div class="state ${g.live?'live':''}">${score||esc(g.live?'AO VIVO':g.state||'Agendado')}</div></div>
        ${open?'<div class="analysis loading" id="analysis-'+esc(g.id)+'">Analisando odds, forma e H2H…</div>':''}
      </div>`;
    }
    html+='</div>';
  }
  $('games').innerHTML=html;
  document.querySelectorAll('.match').forEach(el=>el.onclick=async()=>{
    const id=el.dataset.id;
    state.selected=state.selected===id?null:id;
    renderGames();
    if(state.selected)await loadAnalysis(id);
  });
}
function analysisHtml(a){
  const p=a.probabilities||{}, f=a.form||{}, h=a.h2h||{};
  const fav={home:'Casa',draw:'Empate',away:'Fora'}[a.favorite]||'—';
  return `<div class="probs">
    <div class="prob"><b>${p.home??'—'}%</b><span>CASA</span></div>
    <div class="prob"><b>${p.draw??'—'}%</b><span>EMPATE</span></div>
    <div class="prob"><b>${p.away??'—'}%</b><span>FORA</span></div>
  </div>
  <div class="signal"><div><b style="font-size:12px">Tendência: ${fav}</b><div class="quality">Qualidade dos dados ${a.quality??0}%</div></div><span class="confidence ${a.confidence}">${a.confidence}</span></div>
  <div class="meta-grid">
    <div class="meta"><b>Forma casa</b><br>${f.home?.n||0} jogos • ${Number(f.home?.ppg||0).toFixed(2)} PPG</div>
    <div class="meta"><b>Forma fora</b><br>${f.away?.n||0} jogos • ${Number(f.away?.ppg||0).toFixed(2)} PPG</div>
    <div class="meta"><b>H2H</b><br>${h.n||0} jogos • ${h.home||0}/${h.draw||0}/${h.away||0}</div>
    <div class="meta"><b>Odds</b><br>${a.odds?`${a.odds.home.toFixed(2)} / ${a.odds.draw.toFixed(2)} / ${a.odds.away.toFixed(2)}`:'não disponíveis'}</div>
  </div>
  <div class="mut" style="margin-top:7px">Fontes do cálculo: ${(a.sources||[]).map(esc).join(' + ')||'base estatística'}${a.marketMargin!==null?` • margem mercado ${a.marketMargin}%`:''}</div>
  ${(a.errors||[]).length?`<div class="mut" style="margin-top:5px">Dados indisponíveis: ${(a.errors||[]).map(esc).join(' • ')}</div>`:''}`;
}
async function loadAnalysis(id){
  const g=state.games.find(x=>x.id===id);if(!g)return;
  const el=()=>document.getElementById('analysis-'+CSS.escape(id));
  if(g.provider!=='sportmonks'){const e=el();if(e)e.innerHTML='<div class="mut">Esta partida veio da fonte de fallback. A análise avançada será exibida quando houver correspondência Sportmonks.</div>';return}
  if(state.analysisBusy)return;state.analysisBusy=true;
  try{
    const r=await fetch(`/api/analyze?id=${encodeURIComponent(g.providerId)}`,{headers:headers()});
    const a=await r.json();if(!r.ok)throw new Error(a.error||'Falha na análise');
    const e=el();if(e){e.classList.remove('loading');e.innerHTML=analysisHtml(a)}
  }catch(err){const e=el();if(e)e.innerHTML=`<div class="error">${esc(err.message)}</div>`}
  finally{state.analysisBusy=false}
}
async function loadGames(){
  if(state.busy)return;state.busy=true;$('robotText').textContent='ATUALIZANDO…';
  try{
    const r=await fetch(`/api/fixtures?date=${state.date}`,{headers:headers()});
    const d=await r.json();if(!r.ok)throw new Error(d.error||'Falha ao carregar jogos');
    state.games=d.games||[];
    renderLeagues();renderGames();
    $('updated').textContent='Atualizado '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    $('sources').innerHTML=`<span class="pill">Sportmonks ${d.sources?.sportmonks||0}</span><span class="pill">football-data ${d.sources?.footballData||0}</span>`;
    if((d.errors||[]).length)$('sources').innerHTML+=`<span class="pill">⚠ ${(d.errors||[]).length} aviso(s)</span>`;
    if(state.selected)await loadAnalysis(state.selected);
  }catch(err){$('games').innerHTML=`<div class="error">${esc(err.message)}</div>`;$('count').textContent='Falha ao carregar'}
  finally{state.busy=false;$('robotText').textContent='ROBÔ ATIVO'}
}
function startRobot(){clearInterval(state.timer);state.timer=setInterval(()=>loadGames(),60000)}
function init(){
  const k=store.get();$('sm').value=k.sm;$('fd').value=k.fd;$('odds').value=k.odds;
  state.date=dateKey(new Date());renderDays();
  $('save').onclick=()=>{store.set({sm:$('sm').value.trim(),fd:$('fd').value.trim(),odds:$('odds').value.trim()});loadGames()};
  $('clear').onclick=()=>{store.clear();$('sm').value=$('fd').value=$('odds').value='';state.games=[];renderGames()};
  $('toggleConfig').onclick=()=>{$('configBody').classList.toggle('hidden');$('toggleConfig').textContent=$('configBody').classList.contains('hidden')?'mostrar':'ocultar'};
  $('search').oninput=renderGames;$('league').onchange=renderGames;
  startRobot();loadGames();
}
init();
