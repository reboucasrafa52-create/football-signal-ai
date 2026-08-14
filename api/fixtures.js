const {tokens,send,fetchJson,smUrl,FD,normalizeSM,normalizeFD,mergeGames}=require('./_lib');

function normalizeESPN(e){
  const c=(e.competitions||[])[0]||{};
  const teams=c.competitors||[];
  const home=teams.find(x=>x.homeAway==='home')||teams[0]||{};
  const away=teams.find(x=>x.homeAway==='away')||teams[1]||{};
  const st=c.status?.type||e.status?.type||{};
  const state=st.description||st.detail||st.name||'';
  const completed=Boolean(st.completed);
  const live=Boolean(!completed && (st.state==='in' || /in progress|halftime|1st|2nd|live/i.test(state)));
  const league=e.season?.slug || c.type?.text || e.league?.name || 'Futebol';
  const hs=Number(home.score), as=Number(away.score);
  return {
    id:'espn-'+String(e.id), provider:'espn', providerId:String(e.id),
    start:e.date||null, timestamp:e.date?Date.parse(e.date):null,
    league:String(league).replace(/-/g,' '), country:'',
    home:{id:home.team?.id?String(home.team.id):'',name:home.team?.displayName||home.team?.name||'Casa',logo:home.team?.logo||''},
    away:{id:away.team?.id?String(away.team.id):'',name:away.team?.displayName||away.team?.name||'Fora',logo:away.team?.logo||''},
    state:state||'Agendado', live, finished:completed,
    score:{home:Number.isFinite(hs)?hs:null,away:Number.isFinite(as)?as:null}, hasOdds:false
  };
}

module.exports=async function handler(req,res){
  if(req.method!=='GET')return send(res,405,{error:'Use GET'});
  const {sm,fd}=tokens(req),date=String(req.query?.date||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return send(res,400,{error:'date deve ser YYYY-MM-DD'});

  const errors=[],sources={sportmonks:0,footballData:0,espn:0};
  let a=[],b=[],c=[];

  if(sm){
    try{
      let page=1,all=[],more=true;
      while(more&&page<=20){
        const {data}=await fetchJson(smUrl(`/fixtures/date/${date}`,sm,{include:'participants;league.country;state;scores',per_page:50,page}),{},12000);
        const x=Array.isArray(data?.data)?data.data:[];
        all.push(...x);
        const p=data?.pagination||{};
        more=Boolean(p.has_more)||(p.current_page&&p.last_page&&p.current_page<p.last_page);
        if(!x.length)more=false;
        page++;
      }
      a=all.map(normalizeSM);sources.sportmonks=a.length;
    }catch(e){errors.push(`Sportmonks: ${e.message}`)}
  }

  if(fd){
    try{
      const u=new URL(FD+'/matches');u.searchParams.set('dateFrom',date);u.searchParams.set('dateTo',date);
      const {data}=await fetchJson(u.toString(),{headers:{'X-Auth-Token':fd}},10000);
      b=(data?.matches||[]).map(normalizeFD);sources.footballData=b.length;
    }catch(e){errors.push(`football-data: ${e.message}`)}
  }

  // Fallback público: funciona mesmo sem token e evita painel preso em zero.
  try{
    const ymd=date.replace(/-/g,'');
    const url=`https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates=${ymd}&limit=1000`;
    const {data}=await fetchJson(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json'}},10000);
    c=(data?.events||[]).map(normalizeESPN);
    sources.espn=c.length;
  }catch(e){errors.push(`ESPN: ${e.message}`)}

  const games=mergeGames(mergeGames(a,b),c);
  return send(res,200,{date,count:games.length,games,sources,errors});
};
