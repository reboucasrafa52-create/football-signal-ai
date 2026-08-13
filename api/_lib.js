const SM = 'https://api.sportmonks.com/v3/football';
const FD = 'https://api.football-data.org/v4';

function token(req, envName, headerName) {
  return process.env[envName] || req.headers[headerName] || '';
}
function tokens(req) {
  return {
    sm: token(req, 'SPORTMONKS_TOKEN', 'x-sportmonks-token'),
    fd: token(req, 'FOOTBALL_DATA_TOKEN', 'x-football-data-token'),
    odds: token(req, 'ODDS_API_KEY', 'x-odds-api-key')
  };
}
function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  res.end(JSON.stringify(body));
}
async function fetchJson(url, options={}, timeout=12000) {
  const ctl = new AbortController();
  const timer = setTimeout(()=>ctl.abort(), timeout);
  try {
    const r = await fetch(url, {...options, signal:ctl.signal});
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = {message:text}; }
    if (!r.ok) {
      const msg = data?.message || data?.error || `HTTP ${r.status}`;
      const e = new Error(msg);
      e.status = r.status;
      e.body = data;
      throw e;
    }
    return {data, headers:r.headers};
  } finally { clearTimeout(timer); }
}
function smUrl(path, tokenValue, params={}) {
  const u = new URL(SM + path);
  u.searchParams.set('api_token', tokenValue);
  Object.entries(params).forEach(([k,v])=> {
    if(v!==undefined && v!==null && v!=='') u.searchParams.set(k,String(v));
  });
  return u.toString();
}
function cleanName(s='') {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/\b(fc|cf|sc|ac|club|clube|deportivo|futebol)\b/g,'')
    .replace(/[^a-z0-9]+/g,' ').trim();
}
function isoDate(d) {
  const x = new Date(d);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth()+1).padStart(2,'0')}-${String(x.getUTCDate()).padStart(2,'0')}`;
}
function smParticipants(f) {
  const ps = Array.isArray(f?.participants) ? f.participants : [];
  const home = ps.find(x=>x?.meta?.location==='home') || ps[0] || {};
  const away = ps.find(x=>x?.meta?.location==='away') || ps[1] || {};
  return {home,away};
}
function smScore(f) {
  const scores = Array.isArray(f?.scores) ? f.scores : [];
  let h = null, a = null;
  for (const s of scores) {
    const type = String(s?.description || s?.type?.name || s?.type || '').toUpperCase();
    if(type && !/CURRENT|2ND_HALF|FULLTIME|FT|NORMALTIME|TOTAL/.test(type)) continue;
    const goals = Number(s?.score?.goals);
    const side = s?.score?.participant;
    if(Number.isFinite(goals) && side==='home') h = goals;
    if(Number.isFinite(goals) && side==='away') a = goals;
  }
  if(h===null || a===null) {
    for (const s of scores) {
      const goals=Number(s?.score?.goals), side=s?.score?.participant;
      if(Number.isFinite(goals) && side==='home') h = goals;
      if(Number.isFinite(goals) && side==='away') a = goals;
    }
  }
  return {home:h,away:a};
}
function normalizeSM(f) {
  const {home,away} = smParticipants(f);
  const sc = smScore(f);
  return {
    id: String(f.id), provider:'sportmonks', providerId:String(f.id),
    start: f.starting_at ? String(f.starting_at).replace(' ','T')+'Z' : null,
    timestamp: f.starting_at_timestamp ? Number(f.starting_at_timestamp)*1000 : null,
    league: f.league?.name || f.league?.data?.name || `Liga ${f.league_id || ''}`.trim(),
    country: f.league?.country?.name || f.country?.name || '',
    home:{id:home.id?String(home.id):'', name:home.name || 'Casa', logo:home.image_path || ''},
    away:{id:away.id?String(away.id):'', name:away.name || 'Fora', logo:away.image_path || ''},
    state: f.state?.short_name || f.state?.name || String(f.state_id || ''),
    live: [2,3,4,6,7,9,22].includes(Number(f.state_id)),
    finished: [5,8,11,12,13,14,15,16,17].includes(Number(f.state_id)),
    score:sc, hasOdds:!!(f.has_odds || f.has_premium_odds)
  };
}
function normalizeFD(m) {
  return {
    id:'fd-'+String(m.id), provider:'football-data', providerId:String(m.id),
    start:m.utcDate || null, timestamp:m.utcDate?Date.parse(m.utcDate):null,
    league:m.competition?.name || '', country:m.area?.name || m.competition?.area?.name || '',
    home:{id:m.homeTeam?.id?String(m.homeTeam.id):'',name:m.homeTeam?.name||'Casa',logo:m.homeTeam?.crest||''},
    away:{id:m.awayTeam?.id?String(m.awayTeam.id):'',name:m.awayTeam?.name||'Fora',logo:m.awayTeam?.crest||''},
    state:m.status || '', live:['IN_PLAY','PAUSED'].includes(m.status), finished:m.status==='FINISHED',
    score:{home:m.score?.fullTime?.home??null,away:m.score?.fullTime?.away??null}, hasOdds:false
  };
}
function matchKey(f) {
  const t = f.timestamp ? Math.round(f.timestamp/3600000) : 0;
  return `${cleanName(f.home?.name)}|${cleanName(f.away?.name)}|${t}`;
}
function mergeGames(primary=[], secondary=[]) {
  const map = new Map();
  for(const f of [...primary,...secondary]) {
    const k=matchKey(f), old=map.get(k);
    if(!old || (old.provider!=='sportmonks' && f.provider==='sportmonks')) map.set(k,f);
  }
  return [...map.values()].sort((a,b)=>(a.timestamp||0)-(b.timestamp||0));
}
function resultFromFixture(f, teamId) {
  const {home}=smParticipants(f), sc=smScore(f);
  if(sc.home===null || sc.away===null) return null;
  const isHome=String(home.id)===String(teamId);
  const gf=isHome?sc.home:sc.away, ga=isHome?sc.away:sc.home;
  return gf>ga?'W':gf<ga?'L':'D';
}
function formStats(fixtures, teamId, max=10) {
  const done=(fixtures||[]).filter(x=>{const s=smScore(x); return s.home!==null && s.away!==null;})
    .sort((a,b)=>(b.starting_at_timestamp||0)-(a.starting_at_timestamp||0)).slice(0,max);
  let pts=0,w=0,d=0,l=0;
  for(const f of done) { const r=resultFromFixture(f,teamId); if(r==='W'){pts+=3;w++} else if(r==='D'){pts+=1;d++} else if(r==='L')l++; }
  return {n:done.length,w,d,l,ppg:done.length?pts/done.length:0};
}
function h2hStats(fixtures, homeId, awayId, max=10) {
  const done=(fixtures||[]).filter(x=>{const s=smScore(x); return s.home!==null && s.away!==null;})
    .sort((a,b)=>(b.starting_at_timestamp||0)-(a.starting_at_timestamp||0)).slice(0,max);
  let home=0,draw=0,away=0;
  for(const f of done) {
    const {home:hp,away:ap}=smParticipants(f), sc=smScore(f);
    if(sc.home===sc.away){draw++;continue}
    const winnerId=sc.home>sc.away?String(hp.id):String(ap.id);
    if(winnerId===String(homeId)) home++; else if(winnerId===String(awayId)) away++;
  }
  return {n:done.length,home,draw,away};
}
function oddsTriplet(raw, homeName='', awayName='') {
  const arr=Array.isArray(raw)?raw:Array.isArray(raw?.data)?raw.data:[];
  const hN=cleanName(homeName), aN=cleanName(awayName); let home=[],draw=[],away=[];
  for(const o of arr){
    const value=Number(o.value ?? o.odds ?? o.price); if(!Number.isFinite(value) || value<=1) continue;
    const label=cleanName([o.label,o.name,o.market_description,o.description,o?.market?.name].filter(Boolean).join(' '));
    const original=String(o.label??o.name??'').trim().toLowerCase();
    if(original==='1' || label===hN || label.includes('home')) home.push(value);
    else if(original==='x' || original==='draw' || label.includes('draw') || label.includes('empate')) draw.push(value);
    else if(original==='2' || label===aN || label.includes('away')) away.push(value);
  }
  const median=a=>a.length?a.sort((x,y)=>x-y)[Math.floor(a.length/2)]:null;
  const trip=[median(home),median(draw),median(away)];
  return trip.every(x=>Number.isFinite(x))?trip:null;
}
function normalizeImplied(odds) {
  if(!odds) return null; const inv=odds.map(x=>1/x), sum=inv.reduce((a,b)=>a+b,0);
  return {p:inv.map(x=>x/sum), margin:(sum-1)*100};
}
function softmax3(scores) { const m=Math.max(...scores), e=scores.map(x=>Math.exp(x-m)), s=e.reduce((a,b)=>a+b,0); return e.map(x=>x/s); }
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function probabilityEngine({odds,homeForm,awayForm,h2h,live=false,statsCount=0}) {
  const implied=normalizeImplied(odds); let components=[];
  if(implied) components.push({name:'Mercado',p:implied.p,w:0.62});
  if(homeForm?.n>=3 && awayForm?.n>=3) {
    const delta=clamp((homeForm.ppg-awayForm.ppg)/3,-1,1);
    const p=softmax3([0.22+delta*0.85, -0.05-Math.abs(delta)*0.20, -delta*0.85]);
    components.push({name:'Forma',p,w:0.23});
  }
  if(h2h?.n>=2) {
    const alpha=1.2, den=h2h.n+alpha*3;
    const p=[(h2h.home+alpha)/den,(h2h.draw+alpha)/den,(h2h.away+alpha)/den];
    components.push({name:'H2H',p,w:Math.min(0.15,0.05+h2h.n*0.012)});
  }
  if(!components.length) components.push({name:'Base',p:[0.42,0.29,0.29],w:1});
  const sumW=components.reduce((a,c)=>a+c.w,0); let p=[0,0,0];
  for(const c of components) for(let i=0;i<3;i++) p[i]+=c.p[i]*c.w/sumW;
  const ha=implied?0.008:0.025; p[0]+=ha;p[2]-=ha;
  const sum=p.reduce((a,b)=>a+b,0); p=p.map(x=>clamp(x/sum,0.03,0.94));
  const s2=p.reduce((a,b)=>a+b,0);p=p.map(x=>x/s2);
  const sorted=[...p].sort((a,b)=>b-a), separation=sorted[0]-sorted[1];
  let quality=20;
  if(implied) quality+=38;
  if(homeForm?.n>=5 && awayForm?.n>=5) quality+=18; else if(homeForm?.n>=3 && awayForm?.n>=3) quality+=10;
  if(h2h?.n>=5) quality+=12; else if(h2h?.n>=2) quality+=6;
  if(statsCount>0) quality+=live?8:3;
  if(implied && implied.margin<=8) quality+=5;
  quality=clamp(Math.round(quality),0,100);
  let agreement=1;
  if(components.length>1){ const favorites=components.map(c=>c.p.indexOf(Math.max(...c.p))); agreement=favorites.filter(x=>x===favorites[0]).length/favorites.length; }
  let conf='Baixa';
  if(quality>=72 && sorted[0]>=0.50 && separation>=0.10 && agreement>=0.67) conf='Alta';
  else if(quality>=50 && sorted[0]>=0.42 && separation>=0.055) conf='Média';
  const fav=p.indexOf(Math.max(...p));
  return {probabilities:{home:+(p[0]*100).toFixed(1),draw:+(p[1]*100).toFixed(1),away:+(p[2]*100).toFixed(1)},favorite:['home','draw','away'][fav],confidence:conf,quality,marketMargin:implied?+implied.margin.toFixed(2):null,sources:components.map(c=>c.name)};
}
module.exports={tokens,send,fetchJson,smUrl,FD,normalizeSM,normalizeFD,mergeGames,smParticipants,smScore,formStats,h2hStats,oddsTriplet,probabilityEngine,isoDate};
