function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff','Vary':'Authorization'}})}
function adminHeaders(key){return {apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${key}`}),Accept:'application/json'}}
async function authorize(request,env){
  const match=(request.headers.get('Authorization')||'').match(/^Bearer\s+(.+)$/i);if(!match)return {error:json({error:'Autenticação necessária.'},401)};
  const url=(env.SUPABASE_URL||'').replace(/\/$/,'');const anon=env.SUPABASE_ANON_KEY||'';const secret=env.SUPABASE_SERVICE_ROLE_KEY||'';
  if(!url||!anon||!secret)return {error:json({error:'Função administrativa não configurada no Cloudflare.'},503)};
  const session=await fetch(`${url}/auth/v1/user`,{headers:{apikey:anon,Authorization:`Bearer ${match[1]}`}});if(!session.ok)return {error:json({error:'Sessão inválida ou expirada.'},401)};
  const account=await session.json();if(!account?.id)return {error:json({error:'Não foi possível validar a conta.'},401)};
  const h=adminHeaders(secret);const role=await fetch(`${url}/rest/v1/user_roles?select=role&user_id=eq.${encodeURIComponent(account.id)}&limit=1`,{headers:h});
  if(!role.ok)return {error:json({error:'Não foi possível validar a permissão administrativa.'},502)};
  const roles=await role.json();if(!roles.some(x=>x.role==='admin'))return {error:json({error:'Acesso administrativo não autorizado.'},403)};
  return {url,secret,headers:{...h,'Content-Type':'application/json'}};
}
const allowedTypes=new Set(['image/jpeg','image/png','image/webp','image/gif']);
function extFor(type){return ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'})[type]}
function validTarget(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)}catch{return false}}
async function uploadImage(ctx,file){
  if(!file||typeof file.arrayBuffer!=='function')throw Error('Selecione uma imagem.');
  if(!allowedTypes.has(file.type))throw Error('Formato inválido. Use JPG, PNG, WEBP ou GIF.');
  if(file.size>5*1024*1024)throw Error('A imagem deve ter no máximo 5 MB.');
  const path=`${crypto.randomUUID()}.${extFor(file.type)}`;
  const response=await fetch(`${ctx.url}/storage/v1/object/site-advertisements/${path}`,{method:'POST',headers:{...adminHeaders(ctx.secret),'Content-Type':file.type,'x-upsert':'false'},body:await file.arrayBuffer()});
  if(!response.ok){const msg=await response.text();throw Error(`Falha no upload do Storage: ${msg.slice(0,300)}`)}
  return {path,url:`${ctx.url}/storage/v1/object/public/site-advertisements/${path}`};
}
async function db(ctx,path,options={}){const response=await fetch(`${ctx.url}/rest/v1/${path}`,{...options,headers:{...ctx.headers,...(options.headers||{})}});const body=await response.text();if(!response.ok)throw Error(body.slice(0,500)||`Erro ${response.status} no banco.`);return body?JSON.parse(body):null}
export async function onRequestGet({request,env}){
  const ctx=await authorize(request,env);if(ctx.error)return ctx.error;
  try{return json({ads:await db(ctx,'site_advertisements?select=id,image_path,image_url,target_url,alt_text,active,created_at,updated_at&order=created_at.desc&limit=200')})}catch(e){return json({error:e.message},502)}
}
export async function onRequestPost({request,env}){
  const ctx=await authorize(request,env);if(ctx.error)return ctx.error;
  try{
    const form=await request.formData();const file=form.get('image');const target=String(form.get('target_url')||'').trim();const alt=String(form.get('alt_text')||'').trim().slice(0,120);
    if(!validTarget(target))return json({error:'Informe um link válido começando com http:// ou https://.'},400);
    const uploaded=await uploadImage(ctx,file);
    try{const rows=await db(ctx,'site_advertisements',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({image_path:uploaded.path,image_url:uploaded.url,target_url:target,alt_text:alt,active:true})});return json({ad:rows?.[0]||null})}
    catch(e){await fetch(`${ctx.url}/storage/v1/object/site-advertisements/${uploaded.path}`,{method:'DELETE',headers:adminHeaders(ctx.secret)});throw e}
  }catch(e){return json({error:e.message||'Não foi possível cadastrar a publicidade.'},400)}
}
export async function onRequestPatch({request,env}){
  const ctx=await authorize(request,env);if(ctx.error)return ctx.error;
  try{
    const form=await request.formData();const id=String(form.get('_id')||'').trim();if(!/^[0-9a-f-]{36}$/i.test(id))return json({error:'Identificador de publicidade inválido.'},400);
    const currentRows=await db(ctx,`site_advertisements?select=id,image_path& id=eq.${encodeURIComponent(id)}`.replace('& id','&id'));
    if(!currentRows.length)return json({error:'Publicidade não encontrada.'},404);
    const target=String(form.get('target_url')||'').trim();if(!validTarget(target))return json({error:'Informe um link válido começando com http:// ou https://.'},400);
    const active=String(form.get('active'))==='true';const alt=String(form.get('alt_text')||'').trim().slice(0,120);const patch={target_url:target,alt_text:alt,active,updated_at:new Date().toISOString()};
    const file=form.get('image');let oldPath=null;
    if(file&&typeof file.arrayBuffer==='function'&&file.size>0){const uploaded=await uploadImage(ctx,file);patch.image_path=uploaded.path;patch.image_url=uploaded.url;oldPath=currentRows[0].image_path||null}
    const rows=await db(ctx,`site_advertisements?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(patch)});
    if(oldPath)await fetch(`${ctx.url}/storage/v1/object/site-advertisements/${oldPath}`,{method:'DELETE',headers:adminHeaders(ctx.secret)});
    return json({ad:rows?.[0]||null});
  }catch(e){return json({error:e.message||'Não foi possível atualizar a publicidade.'},400)}
}
export async function onRequestDelete({request,env}){
  const ctx=await authorize(request,env);if(ctx.error)return ctx.error;
  try{
    const body=await request.json();const id=String(body.id||'').trim();if(!/^[0-9a-f-]{36}$/i.test(id))return json({error:'Identificador de publicidade inválido.'},400);
    const rows=await db(ctx,`site_advertisements?select=id,image_path&id=eq.${encodeURIComponent(id)}`);if(!rows.length)return json({error:'Publicidade não encontrada.'},404);
    await db(ctx,`site_advertisements?id=eq.${encodeURIComponent(id)}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});
    if(rows[0].image_path)await fetch(`${ctx.url}/storage/v1/object/site-advertisements/${rows[0].image_path}`,{method:'DELETE',headers:adminHeaders(ctx.secret)});
    return json({success:true});
  }catch(e){return json({error:e.message||'Não foi possível remover a publicidade.'},400)}
}
