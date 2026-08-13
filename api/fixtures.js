const {tokens,send,fetchJson,smUrl,FD,normalizeSM,normalizeFD,mergeGames}=require('./_lib');
module.exports=async function handler(req,res){
 if(req.method!=='GET')return send(res,405,{error:'Use GET'}); const {sm,fd}=tokens(req),date=String(req.query?.date||'');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return send(res,400,{error:'date deve ser YYYY-MM-DD'}); if(!sm&&!fd)return send(res,400,{error:'Configure Sportmonks ou football-data.org'});
 const errors=[],sources={sportmonks:0,footballData:0};let a=[],b=[];
 if(sm)try{let page=1,all=[],more=true;while(more&&page<=20){const {data}=await fetchJson(smUrl(`/fixtures/date/${date}`,sm,{include:'participants;league.country;state;scores',per_page:50,page}),{},14000);const x=Array.isArray(data?.data)?data.data:[];all.push(...x);const p=data?.pagination||{};more=Boolean(p.has_more)||(p.current_page&&p.last_page&&p.current_page<p.last_page);if(!x.length)more=false;page++;}a=all.map(normalizeSM);sources.sportmonks=a.length}catch(e){errors.push(`Sportmonks: ${e.message}`)}
 if(fd)try{const u=new URL(FD+'/matches');u.searchParams.set('dateFrom',date);u.searchParams.set('dateTo',date);const {data}=await fetchJson(u.toString(),{headers:{'X-Auth-Token':fd}},12000);b=(data?.matches||[]).map(normalizeFD);sources.footballData=b.length}catch(e){errors.push(`football-data: ${e.message}`)}
 const games=mergeGames(a,b);return send(res,200,{date,count:games.length,games,sources,errors});
};
