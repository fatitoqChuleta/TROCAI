const cfg=window.TROCAI_CONFIG||{};
const base=(cfg.SUPABASE_URL||'').replace(/\/$/,'');
const key=cfg.SUPABASE_ANON_KEY||'';
let token=localStorage.getItem('trocai_access_token')||'';
let user=JSON.parse(localStorage.getItem('trocai_user')||'null');
let currentCategory='';
let listings=[];
let proposalTab='received';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),3500)}
function configured(){if(!base.startsWith('https://')||!key||key.startsWith('COLE_')){toast('Configure a URL e a chave pública do Supabase no arquivo config.js.');return false}return true}
async function api(path,{method='GET',body,auth=true,headers={}}={}){
  if(!configured())throw Error('Supabase ainda não configurado');
  const h={apikey:key,'Content-Type':'application/json',...headers};
  if(auth&&token)h.Authorization=`Bearer ${token}`;
  const r=await fetch(`${base}/rest/v1/${path}`,{method,headers:h,body:body?JSON.stringify(body):undefined});
  const txt=await r.text();let data;
  try{data=txt?JSON.parse(txt):null}catch{throw Error(`Resposta inesperada do Supabase (${r.status}).`)}
  if(!r.ok)throw Error(data?.message||data?.msg||data?.error_description||`Erro ${r.status} ao acessar o banco.`);
  return data;
}
async function authRequest(path,body){
  if(!configured())throw Error('Supabase ainda não configurado');
  const r=await fetch(`${base}/auth/v1/${path}`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(data.msg||data.message||data.error_description||'Não foi possível autenticar.');
  return data;
}
function showModal(html){$('#modalContent').innerHTML=html;$('#modal').classList.remove('hidden')}
function closeModal(){$('#modal').classList.add('hidden')}
function updateAccount(){
  const b=$('#accountBtn');
  b.textContent=user?(user.user_metadata?.name||user.email?.split('@')[0]||'Minha conta'):'Entrar / criar conta';
  const old=$('#proposalsBtn');
  if(old)old.remove();
  if(user){
    const btn=document.createElement('button');
    btn.className='textbtn';btn.id='proposalsBtn';btn.textContent='Minhas propostas';
    btn.addEventListener('click',openProposals);
    $('#accountBtn').insertAdjacentElement('beforebegin',btn);
  }
}
function authForm(mode='login'){
  const signup=mode==='signup';
  showModal(`<h2>${signup?'Crie sua conta':'Que bom ter você de volta!'}</h2><p>${signup?'Faça parte de uma comunidade de trocas.':'Entre para anunciar, conversar e combinar trocas.'}</p><form id="authForm">${signup?'<label class="field">Seu nome<input name="name" required maxlength="80" autocomplete="name"></label>':''}<label class="field">E-mail<input name="email" type="email" required autocomplete="email"></label><label class="field">Senha<input name="password" type="password" required minlength="6" autocomplete="current-password"></label><button class="primary" type="submit">${signup?'Criar minha conta':'Entrar'}</button></form><button class="switch" id="switchAuth">${signup?'Já tenho conta · Entrar':'Ainda não tenho conta · Criar conta'}</button><button class="switch" id="forgot">Esqueci minha senha</button>`);
  $('#authForm').onsubmit=async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget),email=f.get('email'),password=f.get('password');
    try{
      if(signup){
        const d=await authRequest('signup',{email,password,data:{name:f.get('name')}});
        if(d.access_token){saveSession(d);toast('Conta criada! Bem-vindo ao Trocaí.');closeModal();await loadListings()}
        else toast('Cadastro iniciado. Confira seu e-mail para confirmar a conta.');
      }else{
        const d=await authRequest('token?grant_type=password',{email,password});
        saveSession(d);closeModal();toast('Login realizado com sucesso!');await loadListings();
      }
    }catch(err){toast(err.message)}
  };
  $('#switchAuth').onclick=()=>authForm(signup?'login':'signup');
  $('#forgot').onclick=forgotForm;
}
function forgotForm(){
  showModal(`<h2>Recuperar senha</h2><p>Enviaremos um link de recuperação para seu e-mail.</p><form id="forgotForm"><label class="field">E-mail<input name="email" type="email" required></label><button class="primary">Enviar link</button></form>`);
  $('#forgotForm').onsubmit=async e=>{
    e.preventDefault();
    try{
      const email=new FormData(e.currentTarget).get('email');
      const r=await fetch(`${base}/auth/v1/recover`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email})});
      if(!r.ok)throw Error('Não foi possível enviar o e-mail.');
      toast('Se o endereço estiver cadastrado, você receberá as instruções.');closeModal();
    }catch(err){toast(err.message)}
  };
}
function saveSession(d){
  token=d.access_token;user=d.user;
  localStorage.setItem('trocai_access_token',token);localStorage.setItem('trocai_user',JSON.stringify(user));
  updateAccount();
}
async function logout(){
  token='';user=null;localStorage.removeItem('trocai_access_token');localStorage.removeItem('trocai_user');
  updateAccount();toast('Você saiu da sua conta.');
}
function renderListings(){
  const grid=$('#listingGrid'),term=$('#search').value.trim().toLowerCase();
  const rows=listings.filter(x=>(!currentCategory||x.category===currentCategory)&&(!term||`${x.title} ${x.description} ${x.location} ${x.category}`.toLowerCase().includes(term)));
  if(!rows.length){grid.innerHTML='<div class="empty"><span>✦</span><h3>Nenhum anúncio por aqui ainda</h3><p>Experimente outra busca ou seja a primeira pessoa a anunciar.</p></div>';return}
  grid.innerHTML=rows.map(x=>`<article class="listing"><img src="${esc(x.image_url||'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=800&q=80')}" alt="${esc(x.title)}" onerror="this.src='https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=800&q=80'"><div class="listing-body"><span class="tag">${esc(x.category)}</span><h3>${esc(x.title)}</h3><p>⌖ ${esc(x.location)} · ${esc(x.condition)}</p><p><b>Procura por:</b> ${esc(x.wants)}</p>${user&&user.id!==x.owner_id?`<button class="primary propose" data-id="${x.id}" style="width:100%;margin-top:8px">Tenho interesse</button>`:''}</div></article>`).join('');
  document.querySelectorAll('.propose').forEach(b=>b.onclick=()=>createProposal(b.dataset.id));
}
async function loadListings(){
  try{
    listings=await api('swap_listings?select=id,owner_id,title,category,description,condition,wants,location,image_url,status,created_at&status=eq.active&order=created_at.desc&limit=60',{auth:false});
    renderListings();
  }catch(e){if(!String(e.message).includes('Configure'))toast('Não foi possível carregar anúncios: '+e.message)}
}
function announceForm(){
  if(!user){authForm();toast('Entre ou crie uma conta para anunciar.');return}
  showModal(`<h2>Seu próximo anúncio</h2><p>Conte para a comunidade o que você quer trocar.</p><form id="listingForm"><label class="field">Título<input name="title" required maxlength="120" placeholder="Ex.: Bicicleta infantil"></label><label class="field">Categoria<select name="category" required><option value="">Selecione</option>${['Livros','Roupas','Calçados','Acessórios','Eletrônicos','Jogos','Material escolar','Colecionáveis','Outros'].map(x=>`<option>${x}</option>`).join('')}</select></label><label class="field">Estado de conservação<select name="condition" required><option>Novo</option><option>Quase novo</option><option>Usado, mas está bem</option><option>Usado, com algumas marcas</option><option>Precisa de alguns cuidados</option></select></label><label class="field">O que você procura em troca?<input name="wants" required maxlength="255"></label><label class="field">Cidade / região<input name="location" required maxlength="120"></label><label class="field">Descrição<textarea name="description" rows="3" required maxlength="2000"></textarea></label><label class="field">Foto do item (opcional)<input name="photo" type="file" accept="image/*"></label><button class="primary">Publicar anúncio</button></form>`);
  $('#listingForm').onsubmit=async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget),photo=f.get('photo');let image_url=null;
    try{
      if(photo?.size){
        if(photo.size>5*1024*1024)throw Error('A imagem deve ter até 5 MB.');
        const ext=(photo.name.split('.').pop()||'jpg').replace(/[^a-z0-9]/gi,'').toLowerCase();
        const path=`${user.id}/${crypto.randomUUID()}.${ext}`;
        const r=await fetch(`${base}/storage/v1/object/listing-images/${path}`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':photo.type||'image/jpeg','x-upsert':'false'},body:photo});
        if(!r.ok)throw Error('Falha no envio da imagem. Confira as políticas do Storage.');
        image_url=`${base}/storage/v1/object/public/listing-images/${path}`;
      }
      const payload={owner_id:user.id,title:f.get('title'),category:f.get('category'),condition:f.get('condition'),wants:f.get('wants'),location:f.get('location'),description:f.get('description'),image_url,status:'active'};
      await api('swap_listings',{method:'POST',body:payload,headers:{Prefer:'return=representation'}});
      closeModal();toast('Anúncio publicado!');await loadListings();
    }catch(err){toast(err.message)}
  };
}
async function createProposal(id){
  if(!user){authForm();return}
  const message=prompt('Conte brevemente qual item você oferece ou por que tem interesse nesta troca:');
  if(message===null)return;
  if(!message.trim()){toast('Escreva uma mensagem antes de enviar.');return}
  try{
    const listing=listings.find(x=>String(x.id)===String(id));
    if(!listing)throw Error('Anúncio não encontrado. Atualize a página e tente novamente.');
    await api('swap_proposals',{method:'POST',body:{listing_id:Number(id),owner_id:listing.owner_id,proposer_id:user.id,offered_item:message.trim(),status:'pending'},headers:{Prefer:'return=representation'}});
    toast('Interesse enviado! O dono poderá ver sua proposta em “Minhas propostas”.');
  }catch(e){toast('Não foi possível enviar a proposta: '+e.message)}
}
async function openProposals(tab='received'){
  if(!user){authForm();return}
  proposalTab=tab;
  showModal(`<div class="proposal-heading"><h2>Minhas propostas</h2><p>Acompanhe os interesses recebidos e as propostas que você enviou.</p></div><div class="proposal-tabs"><button class="${tab==='received'?'active':''}" id="receivedTab">Recebidas</button><button class="${tab==='sent'?'active':''}" id="sentTab">Enviadas</button></div><div id="proposalList" class="proposal-list"><p class="proposal-loading">Carregando propostas…</p></div>`);
  $('#receivedTab').onclick=()=>openProposals('received');
  $('#sentTab').onclick=()=>openProposals('sent');
  await loadProposals();
}
async function loadProposals(){
  const host=$('#proposalList');
  if(!host)return;
  try{
    const filter=proposalTab==='received'?`owner_id.eq.${user.id}`:`proposer_id.eq.${user.id}`;
    const rows=await api(`swap_proposals?select=id,listing_id,owner_id,proposer_id,offered_item,status,created_at&or=(${filter})&order=created_at.desc&limit=100`);
    if(!rows.length){
      host.innerHTML=`<div class="empty proposal-empty"><span>♡</span><h3>${proposalTab==='received'?'Nenhuma proposta recebida ainda':'Você ainda não enviou propostas'}</h3><p>${proposalTab==='received'?'Quando alguém demonstrar interesse em um dos seus anúncios, a proposta aparecerá aqui.':'Quando você demonstrar interesse em um anúncio, poderá acompanhar por aqui.'}</p></div>`;
      return;
    }
    const listingIds=[...new Set(rows.map(x=>x.listing_id))];
    const profileIds=[...new Set(rows.map(x=>proposalTab==='received'?x.proposer_id:x.owner_id))];
    const [listingRows,profileRows]=await Promise.all([
      api(`swap_listings?select=id,title,category&id=in.(${listingIds.join(',')})`,{auth:false}),
      api(`profiles?select=id,display_name&id=in.(${profileIds.join(',')})`,{auth:false})
    ]);
    const listingMap=new Map(listingRows.map(x=>[String(x.id),x]));
    const profileMap=new Map(profileRows.map(x=>[x.id,x]));
    host.innerHTML=rows.map(p=>{
      const l=listingMap.get(String(p.listing_id));
      const person=profileMap.get(proposalTab==='received'?p.proposer_id:p.owner_id);
      const status=p.status||'pending';
      const statusLabel={pending:'Aguardando resposta',accepted:'Aceita',declined:'Recusada',completed:'Concluída',cancelled:'Cancelada'}[status]||status;
      const canRespond=proposalTab==='received'&&p.owner_id===user.id&&status==='pending';
      return `<article class="proposal-card"><div class="proposal-card-top"><div><span class="tag">${esc(l?.category||'Proposta')}</span><h3>${esc(l?.title||`Anúncio #${p.listing_id}`)}</h3></div><span class="proposal-status status-${esc(status)}">${esc(statusLabel)}</span></div><p class="proposal-person">${proposalTab==='received'?'Enviada por':'Proposta para'} <b>${esc(person?.display_name||'Usuário do Trocaí')}</b></p><div class="offered-item"><small>${proposalTab==='received'?'O que a pessoa oferece':'O que você ofereceu'}</small><p>${esc(p.offered_item)}</p></div>${canRespond?`<div class="proposal-actions"><button class="accept-proposal" data-id="${p.id}">Aceitar</button><button class="decline-proposal" data-id="${p.id}">Recusar</button></div>`:''}</article>`;
    }).join('');
    host.querySelectorAll('.accept-proposal').forEach(b=>b.onclick=()=>respondProposal(b.dataset.id,'accepted'));
    host.querySelectorAll('.decline-proposal').forEach(b=>b.onclick=()=>respondProposal(b.dataset.id,'declined'));
  }catch(e){
    host.innerHTML=`<div class="empty"><h3>Não foi possível carregar as propostas</h3><p>${esc(e.message)}</p><p>Confira se a tabela swap_proposals e as permissões de leitura estão configuradas.</p></div>`;
  }
}
async function respondProposal(id,status){
  const action=status==='accepted'?'aceitar':'recusar';
  if(!confirm(`Tem certeza de que deseja ${action} esta proposta?`))return;
  try{
    await api(`swap_proposals?id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(user.id)}`,{method:'PATCH',body:{status,updated_at:new Date().toISOString()},headers:{Prefer:'return=minimal'}});
    toast(status==='accepted'?'Proposta aceita!':'Proposta recusada.');
    await loadProposals();
  }catch(e){toast('Não foi possível atualizar a proposta: '+e.message)}
}
$('#accountBtn').onclick=()=>user?showModal(`<h2>Olá, ${esc(user.user_metadata?.name||user.email)}</h2><p>${esc(user.email)}</p><button class="primary" id="openMyProposals">Minhas propostas</button><button class="secondary" id="logoutBtn">Sair da conta</button>`):authForm();
$('#closeModal').onclick=closeModal;
$('#modal').onclick=e=>{if(e.target.id==='modal')closeModal()};
$('#announceBtn').onclick=announceForm;
$('#heroAnnounce').onclick=announceForm;
$('#exploreBtn').onclick=()=>$('#explorar').scrollIntoView({behavior:'smooth'});
$('#allBtn').onclick=()=>{currentCategory='';$('#search').value='';document.querySelectorAll('.chip').forEach(c=>c.classList.toggle('active',!c.dataset.cat));renderListings()};
$('#searchBtn').onclick=renderListings;
$('#search').oninput=renderListings;
$('#category').onchange=e=>{currentCategory=e.target.value;renderListings()};
document.querySelectorAll('.chip').forEach(c=>c.onclick=()=>{currentCategory=c.dataset.cat;$('#category').value=currentCategory;document.querySelectorAll('.chip').forEach(x=>x.classList.toggle('active',x===c));renderListings()});
$('#menuBtn').onclick=()=>toast('Use os atalhos de navegação rolando a página.');
document.addEventListener('click',e=>{
  if(e.target.id==='logoutBtn')logout();
  if(e.target.id==='openMyProposals')openProposals();
});
if(token&&user){
  updateAccount();
  fetch(`${base}/auth/v1/user`,{headers:{apikey:key,Authorization:`Bearer ${token}`}})
    .then(r=>{if(!r.ok)logout()}).catch(()=>{});
}else updateAccount();
loadListings();
