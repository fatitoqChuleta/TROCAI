function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff'}})}
export async function onRequestGet({env}){
  const url=(env.SUPABASE_URL||'').replace(/\/$/,'');const key=env.SUPABASE_ANON_KEY||'';
  if(!url||!key)return json({ads:[]},200);
  const response=await fetch(`${url}/rest/v1/site_advertisements?select=id,image_url,target_url,alt_text,active&active=eq.true&order=created_at.desc&limit=100`,{headers:{apikey:key,Accept:'application/json'}});
  if(!response.ok)return json({error:'Não foi possível carregar as publicidades.'},502);
  return json({ads:await response.json()});
}
