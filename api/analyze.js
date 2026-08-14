const {tokens,send,fetchJson,smUrl,smParticipants,formStats,h2hStats,oddsTriplet,probabilityEngine,isoDate}=require('./_lib');
module.exports=async function handler(req,res){
 if(req.method==='OPTIONS')return send(res,200,{ok:true});
 if(req.method!=='GET')return send(res,405,{error:'Use GET'});
 const {sm}=tokens(req);if(!sm)return send(res,400,{error:'A análise avançada requer o token Sportmonks'});
 const id=String(req.query?.id||'');if(!/^\d+$/.test(id))return send(res,400,{error:'fixture id inválido'});
 const errors=[];let fixture,h2h=[],hf=[],af=[],oddsRaw=[];
 try{const {data}=await fetchJson(smUrl(`/fixtures/${id}`,sm,{include:'participants;league.country;state;scores;events;statistics;periods;venue'}),{},14000);fixture=data?.data}catch(e){return send(res,502,{error:`Fixture: ${e.message}`})}
 const {home,away}=smParticipants(fixture);if(!home?.id||!away?.id)return send(res,422,{error:'Times não identificados nesta partida'});
 const live=[2,3,4,6,7,9,22].includes(Number(fixture.state_id));
 const now=new Date(fixture.starting_at?fixture.starting_at.replace(' ','T')+'Z':Date.now()),from=new Date(now),to=new Date(now);from.setUTCDate(from.getUTCDate()-150);to.setUTCDate(to.getUTCDate()-1);const d1=isoDate(from),d2=isoDate(to);
 await Promise.all([
  (async()=>{try{const {data}=await fetchJson(smUrl(`/fixtures/head-to-head/${home.id}/${away.id}`,sm,{include:'participants;scores',per_page:20}),{},12000);h2h=data?.data||[]}catch(e){errors.push(`H2H: ${e.message}`)}})(),
  (async()=>{try{const {data}=await fetchJson(smUrl(`/fixtures/between/${d1}/${d2}/${home.id}`,sm,{include:'participants;scores',per_page:50}),{},12000);hf=data?.data||[]}catch(e){errors.push(`Forma casa: ${e.message}`)}})(),
  (async()=>{try{const {data}=await fetchJson(smUrl(`/fixtures/between/${d1}/${d2}/${away.id}`,sm,{include:'participants;scores',per_page:50}),{},12000);af=data?.data||[]}catch(e){errors.push(`Forma fora: ${e.message}`)}})(),
  (async()=>{
    const paths=live?[`/odds/inplay/fixtures/${id}`,`/odds/pre-match/fixtures/${id}`]:[`/odds/pre-match/fixtures/${id}`];
    for(const path of paths){try{const {data}=await fetchJson(smUrl(path,sm,{include:'market;bookmaker'}),{},12000);const rows=data?.data||[];if(rows.length){oddsRaw=rows;return}}catch(e){errors.push(`${live&&path.includes('inplay')?'Odds ao vivo':'Odds'}: ${e.message}`)}}
  })()
 ]);
 const homeForm=formStats(hf,home.id,10),awayForm=formStats(af,away.id,10),h2hResult=h2hStats(h2h,home.id,away.id,10),odds=oddsTriplet(oddsRaw,home.name,away.name),statsCount=Array.isArray(fixture.statistics)?fixture.statistics.length:0;
 const engine=probabilityEngine({odds,homeForm,awayForm,h2h:h2hResult,live,statsCount});
 return send(res,200,{fixture:{id:String(fixture.id),home:{id:String(home.id),name:home.name,logo:home.image_path||''},away:{id:String(away.id),name:away.name,logo:away.image_path||''},league:fixture.league?.name||'',start:fixture.starting_at,state:fixture.state?.short_name||fixture.state?.name||'',live},...engine,odds:odds?{home:odds[0],draw:odds[1],away:odds[2]}:null,form:{home:homeForm,away:awayForm},h2h:h2hResult,statsCount,updatedAt:new Date().toISOString(),errors});
};
