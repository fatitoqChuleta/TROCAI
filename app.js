const cfg=window.TROCAI_CONFIG||{};
const base=(cfg.SUPABASE_URL||'').replace(/\/$/,'');
const key=cfg.SUPABASE_ANON_KEY||'';
let token=localStorage.getItem('trocai_access_token')||'';
let user=JSON.parse(localStorage.getItem('trocai_user')||'null');
let isAdmin=false;
let currentCategory='';
let listings=[];
let proposalTab='received';
let activeConversation=null;
let chatListCache=[];
let chatFetchBusy=false;
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
function closeModal(){$('#modal').classList.add('hidden');$('#modal .dialog')?.classList.remove('admin-dialog')}
function updateAccount(){
  const b=$('#accountBtn');
  b.textContent=user?(user.user_metadata?.name||user.email?.split('@')[0]||'Minha conta'):'Entrar / criar conta';
  const old=$('#proposalsBtn');
  if(old)old.remove();
  const oldNotifications=$('#notificationsBtn');
  if(oldNotifications)oldNotifications.remove();
  const oldChats=$('#chatsBtn');
  if(oldChats)oldChats.remove();
  const oldAdmin=$('#adminBtn');
  if(oldAdmin)oldAdmin.remove();
  if(user){
    const chatsBtn=document.createElement('button');
    chatsBtn.className='textbtn chat-nav';
    chatsBtn.id='chatsBtn';
    chatsBtn.innerHTML='♧ Conversas <span id="chatUnreadCount" class="notification-count" hidden>0</span>';
    chatsBtn.addEventListener('click',openChats);
    $('#accountBtn').insertAdjacentElement('beforebegin',chatsBtn);

    const noticeBtn=document.createElement('button');
    noticeBtn.className='textbtn notification-nav';
    noticeBtn.id='notificationsBtn';
    noticeBtn.innerHTML='♧ Notificações <span id="notificationCount" class="notification-count" hidden>0</span>';
    noticeBtn.addEventListener('click',openNotifications);
    $('#accountBtn').insertAdjacentElement('beforebegin',noticeBtn);

    const btn=document.createElement('button');
    btn.className='textbtn';btn.id='proposalsBtn';btn.textContent='Minhas propostas';
    btn.addEventListener('click',openProposals);
    $('#accountBtn').insertAdjacentElement('beforebegin',btn);
    loadNotificationCount();
    if(isAdmin){
      const adminBtn=document.createElement('button');
      adminBtn.className='textbtn admin-nav';adminBtn.id='adminBtn';
      adminBtn.textContent='Painel administrativo';
      adminBtn.addEventListener('click',openAdminPanel);
      $('#accountBtn').insertAdjacentElement('beforebegin',adminBtn);
    }
  }
}
async function refreshAdminRole(){
  isAdmin=false;
  if(!user||!token){updateAccount();return}
  try{
    const rows=await api(`user_roles?select=role&user_id=eq.${encodeURIComponent(user.id)}&limit=1`);
    isAdmin=rows.some(row=>row.role==='admin');
  }catch(error){
    console.warn('Não foi possível verificar a função administrativa:',error.message);
  }
  updateAccount();
}
function openAdminPanel(){
  if(!user||!isAdmin){toast('Acesso administrativo não autorizado.');return}
  showModal(`<div class="admin-panel"><span class="eyebrow">ÁREA RESTRITA</span><h2>Painel administrativo</h2><p>Gerencie informações da comunidade Trocaí.</p>
  <div class="admin-tabs" role="tablist"><button type="button" class="admin-tab active" role="tab" aria-selected="true" data-admin-tab="users">Usuários</button><button type="button" class="admin-tab" role="tab" aria-selected="false" data-admin-tab="ads">Publicidade</button></div>
  <div class="admin-pane" data-admin-pane="users"><section class="admin-users"><div class="admin-users-head"><div><h3>Usuários cadastrados</h3><p>Consulta protegida de perfis e contas.</p></div><button class="secondary admin-refresh" id="refreshAdminUsers" type="button">Atualizar</button></div><div class="admin-user-stats"><div><small>Total de usuários</small><strong id="adminUserTotal">—</strong></div><div><small>Administradores</small><strong id="adminAdminTotal">—</strong></div></div><label class="admin-search-label" for="adminUserSearch">Buscar usuário</label><input id="adminUserSearch" class="admin-user-search" type="search" placeholder="Nome, e-mail ou cidade"><div id="adminUsersContent" class="admin-users-content"><p class="admin-loading">Carregando usuários...</p></div><p class="admin-footnote">Esta tela é somente para consulta. Nenhuma conta pode ser alterada ou excluída por aqui.</p></section></div>
  <div class="admin-pane" data-admin-pane="ads" hidden><section class="admin-ads" id="adminAdsSection"><div class="admin-section-heading"><div><h3>Gerenciamento de publicidade</h3><p>Cadastre banners que aparecem nas laterais do site em computadores e dentro da página no celular.</p></div><button class="secondary" id="refreshAdminAds" type="button">Atualizar</button></div>
  <form id="adminAdForm" class="admin-ad-form"><label class="field">Imagem da publicidade<input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" required></label><label class="field">Link aberto ao clicar<input name="target_url" type="url" required placeholder="https://exemplo.com"></label><label class="field">Texto alternativo (opcional)<input name="alt_text" maxlength="120" placeholder="Descrição da imagem"></label><button class="primary" type="submit">＋ Adicionar publicidade</button><small>Imagens JPG, PNG, WEBP ou GIF de até 5 MB.</small></form>
  <div class="admin-ad-list-heading"><h4>Publicidades cadastradas</h4><span id="adminAdCount">—</span></div><div id="adminAdsContent"><p class="admin-loading">Carregando publicidades...</p></div><p class="admin-footnote">A cada nova visita ou atualização, o site escolhe banners ativos aleatoriamente. Em telas pequenas, os banners saem das laterais e aparecem entre as seções da página, sem cobrir o conteúdo.</p></section></div></div>`);
  $('#refreshAdminUsers').onclick=loadAdminUsers;
  $('#adminUserSearch').oninput=()=>renderAdminUsers(window.trocaiAdminUsers||[]);
  $('#refreshAdminAds').onclick=loadAdminAds;
  $('#adminAdForm').onsubmit=submitAdminAd;
  // Painel ampliado com rolagem própria para manter a publicidade acessível.
  const adminDialog=$('#modal .dialog');
  if(adminDialog)adminDialog.classList.add('admin-dialog');
  document.querySelectorAll('.admin-tab').forEach(tab=>tab.addEventListener('click',()=>{
    const target=tab.dataset.adminTab;
    document.querySelectorAll('.admin-tab').forEach(t=>{const on=t===tab;t.classList.toggle('active',on);t.setAttribute('aria-selected',String(on))});
    document.querySelectorAll('.admin-pane').forEach(p=>{p.hidden=p.dataset.adminPane!==target});
    adminDialog?.scrollTo({top:0});
  }));
  loadAdminUsers();loadAdminAds();
}
async function loadAdminUsers(){
  const host=$('#adminUsersContent');
  if(!host)return;
  host.innerHTML='<p class="admin-loading">Carregando usuários...</p>';
  const refresh=$('#refreshAdminUsers');
  if(refresh)refresh.disabled=true;
  try{
    const response=await fetch('/api/admin/users',{headers:{Authorization:`Bearer ${token}`,'Accept':'application/json'},cache:'no-store'});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(data.error||`Erro ${response.status} ao consultar usuários.`);
    window.trocaiAdminUsers=Array.isArray(data.users)?data.users:[];
    $('#adminUserTotal').textContent=String(data.total??window.trocaiAdminUsers.length);
    $('#adminAdminTotal').textContent=String(data.admins??window.trocaiAdminUsers.filter(x=>x.role==='admin').length);
    renderAdminUsers(window.trocaiAdminUsers);
  }catch(error){
    host.innerHTML=`<div class="admin-load-error"><b>Não foi possível carregar os usuários.</b><p>${esc(error.message)}</p><small>Confira as variáveis de ambiente da função administrativa no Cloudflare e tente novamente.</small></div>`;
  }finally{if(refresh)refresh.disabled=false;}
}
function renderAdminUsers(rows){
  const host=$('#adminUsersContent');
  if(!host)return;
  const term=($('#adminUserSearch')?.value||'').trim().toLocaleLowerCase('pt-BR');
  const filtered=rows.filter(item=>`${item.name} ${item.email} ${item.city}`.toLocaleLowerCase('pt-BR').includes(term));
  if(!filtered.length){host.innerHTML='<div class="admin-users-empty">Nenhum usuário encontrado.</div>';return;}
  host.innerHTML=filtered.map(item=>`<article class="admin-user-card"><div class="admin-user-main"><b>${esc(item.name)}</b><span>${esc(item.email||'E-mail indisponível')}</span></div><div class="admin-user-meta"><span>${esc(item.city||'Cidade não informada')}</span><span>Cadastro: ${item.created_at?esc(new Date(item.created_at).toLocaleDateString('pt-BR')):'—'}</span><span class="admin-role ${item.role==='admin'?'is-admin':''}">${item.role==='admin'?'Administrador':'Usuário'}</span></div></article>`).join('');
}
async function adminAdsRequest(method='GET',body){
  const headers={Authorization:`Bearer ${token}`};
  let payload=body;
  if(body instanceof FormData){}else if(body!==undefined){headers['Content-Type']='application/json';payload=JSON.stringify(body)}
  const response=await fetch('/api/admin/ads',{method,headers,body:payload,cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||`Erro ${response.status} ao gerenciar publicidades.`);
  return data;
}
async function loadAdminAds(){
  const host=$('#adminAdsContent');if(!host)return;
  host.innerHTML='<p class="admin-loading">Carregando publicidades...</p>';
  const refresh=$('#refreshAdminAds');if(refresh)refresh.disabled=true;
  try{const data=await adminAdsRequest('GET');window.trocaiAdminAds=Array.isArray(data.ads)?data.ads:[];renderAdminAds(window.trocaiAdminAds);$('#adminAdCount').textContent=String(window.trocaiAdminAds.length)}
  catch(error){host.innerHTML=`<div class="admin-load-error"><b>Não foi possível carregar as publicidades.</b><p>${esc(error.message)}</p><small>Confira a configuração da tabela e do bucket de publicidade no Supabase.</small></div>`}
  finally{if(refresh)refresh.disabled=false}
}
function renderAdminAds(ads){
  const host=$('#adminAdsContent');if(!host)return;
  if(!ads.length){host.innerHTML='<div class="admin-users-empty">Nenhuma publicidade cadastrada ainda.</div>';return}
  host.innerHTML=ads.map(ad=>`<article class="admin-ad-card" data-ad-id="${esc(ad.id)}"><img src="${esc(ad.image_url)}" alt="${esc(ad.alt_text||'Publicidade')}" loading="lazy"><div class="admin-ad-fields"><label class="field">Link de destino<input class="admin-ad-url" type="url" value="${esc(ad.target_url)}" required></label><label class="admin-ad-alt-label">Texto alternativo<input class="admin-ad-alt" maxlength="120" value="${esc(ad.alt_text||'')}"></label><label class="admin-ad-active"><input type="checkbox" class="admin-ad-enabled" ${ad.active?'checked':''}> Publicidade ativa</label><label class="admin-ad-replace">Substituir imagem<input class="admin-ad-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label><div class="admin-ad-actions"><button type="button" class="secondary admin-ad-save">Salvar alterações</button><button type="button" class="admin-ad-delete">Remover</button></div></div></article>`).join('');
  host.querySelectorAll('.admin-ad-card').forEach(card=>{
    const id=card.dataset.adId;
    card.querySelector('.admin-ad-save').onclick=()=>saveAdminAd(card,id);
    card.querySelector('.admin-ad-delete').onclick=()=>deleteAdminAd(id);
  });
}
async function submitAdminAd(event){
  event.preventDefault();const form=event.currentTarget;const button=form.querySelector('button[type="submit"]');button.disabled=true;
  try{const file=form.elements.image.files[0];if(!file)throw Error('Selecione uma imagem.');const data=new FormData();data.append('image',file);data.append('target_url',form.elements.target_url.value.trim());data.append('alt_text',form.elements.alt_text.value.trim());await adminAdsRequest('POST',data);form.reset();toast('Publicidade adicionada!');await loadAdminAds();await loadPublicAds()}
  catch(error){toast('Não foi possível adicionar: '+error.message)}finally{button.disabled=false}
}
async function saveAdminAd(card,id){
  const button=card.querySelector('.admin-ad-save');button.disabled=true;
  try{const data=new FormData();data.append('target_url',card.querySelector('.admin-ad-url').value.trim());data.append('alt_text',card.querySelector('.admin-ad-alt').value.trim());data.append('active',String(card.querySelector('.admin-ad-enabled').checked));const file=card.querySelector('.admin-ad-file').files[0];if(file)data.append('image',file);data.append('_id',id);await adminAdsRequest('PATCH',data);toast('Publicidade atualizada!');await loadAdminAds();await loadPublicAds()}
  catch(error){toast('Não foi possível salvar: '+error.message)}finally{button.disabled=false}
}
async function deleteAdminAd(id){
  if(!confirm('Remover esta publicidade?'))return;
  try{await adminAdsRequest('DELETE',{id});toast('Publicidade removida.');await loadAdminAds();await loadPublicAds()}
  catch(error){toast('Não foi possível remover: '+error.message)}
}
async function loadPublicAds(){
  try{const response=await fetch('/api/ads',{cache:'no-store'});if(!response.ok)return;const data=await response.json();const ads=Array.isArray(data.ads)?data.ads.filter(ad=>ad.active&&ad.image_url&&ad.target_url):[];renderSideAds(ads)}catch(error){console.warn('Publicidade indisponível:',error.message)}
}
function renderSideAds(ads){
  document.querySelectorAll('.trocai-side-ad,.trocai-inline-ad').forEach(node=>node.remove());if(!ads.length)return;
  const pool=[...ads];for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]]}
  const selected=pool.slice(0,Math.min(2,pool.length));
  // Evita repetir exatamente a mesma combinação/posição no próximo carregamento.
  if(selected.length>1){
    try{const previous=JSON.parse(localStorage.getItem('trocai_last_ad_rotation')||'[]');const current=selected.map(ad=>ad.id);if(JSON.stringify(current)===JSON.stringify(previous))selected.push(selected.shift());localStorage.setItem('trocai_last_ad_rotation',JSON.stringify(selected.map(ad=>ad.id)))}catch{}
  }
  selected.forEach((ad,index)=>{
    const rail=document.createElement('aside');
    rail.className=`trocai-side-ad ${index===0?'side-ad-left':'side-ad-right'}`;
    const link=document.createElement('a');
    link.href=ad.target_url;
    link.target='_blank';
    link.rel='noopener noreferrer sponsored';
    link.setAttribute('aria-label',ad.alt_text||'Publicidade — abre em nova aba');
    const img=document.createElement('img');
    img.src=ad.image_url;
    img.alt=ad.alt_text||'Publicidade';
    img.loading='lazy';
    link.appendChild(img);
    rail.appendChild(link);
    if(ad.alt_text){
      const caption=document.createElement('p');
      caption.className='trocai-side-ad-caption';
      caption.textContent=ad.alt_text;
      rail.appendChild(caption);
    }
    document.body.appendChild(rail);
  });
  // Versão para celular e telas menores: as laterais ficam ocultas abaixo de 1450px,
  // então os mesmos anúncios aparecem dentro da página, entre as seções.
  const inlineSpots=[document.querySelector('.stats'),document.querySelector('#como-funciona')];
  selected.forEach((ad,index)=>{
    const spot=inlineSpots[index];if(!spot)return;
    const box=document.createElement('aside');
    box.className='trocai-inline-ad';
    box.setAttribute('aria-label','Publicidade');
    const label=document.createElement('span');
    label.className='trocai-inline-ad-label';
    label.textContent='Publicidade';
    const link=document.createElement('a');
    link.href=ad.target_url;
    link.target='_blank';
    link.rel='noopener noreferrer sponsored';
    link.setAttribute('aria-label',ad.alt_text||'Publicidade — abre em nova aba');
    const img=document.createElement('img');
    img.src=ad.image_url;
    img.alt=ad.alt_text||'Publicidade';
    img.loading='lazy';
    link.appendChild(img);
    box.append(label,link);
    if(ad.alt_text){
      const caption=document.createElement('p');
      caption.className='trocai-side-ad-caption';
      caption.textContent=ad.alt_text;
      box.appendChild(caption);
    }
    spot.after(box);
  });
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
  refreshAdminRole();
}
async function logout(){
  token='';user=null;isAdmin=false;localStorage.removeItem('trocai_access_token');localStorage.removeItem('trocai_user');
  updateAccount();renderListings();toast('Você saiu da sua conta.');
}
function renderListings(){
  const grid=$('#listingGrid'),term=$('#search').value.trim().toLowerCase();
  const rows=listings.filter(x=>(!currentCategory||x.category===currentCategory)&&(!term||`${x.title} ${x.description} ${x.location} ${x.category}`.toLowerCase().includes(term)));
  if(!rows.length){grid.innerHTML='<div class="empty"><span>✦</span><h3>Nenhum anúncio por aqui ainda</h3><p>Experimente outra busca ou seja a primeira pessoa a anunciar.</p></div>';return}
  grid.innerHTML=rows.map(x=>`<article class="listing"><img src="${esc(x.image_url||'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=800&q=80')}" alt="${esc(x.title)}" onerror="this.src='https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=800&q=80'"><div class="listing-body"><span class="tag">${esc(x.category)}</span><h3>${esc(x.title)}</h3><p>⌖ ${esc(x.location)} · ${esc(x.condition)}</p><p><b>Procura por:</b> ${esc(x.wants)}</p>${user&&user.id!==x.owner_id?`<button class="primary propose" data-id="${x.id}" style="width:100%;margin-top:8px">Tenho interesse</button>`:''}${user&&x.owner_id===user.id?`<div class="listing-owner-actions"><button type="button" class="edit-listing-card" data-id="${x.id}">Editar</button><button type="button" class="delete-listing-card" data-id="${x.id}">Excluir</button></div>`:''}</div></article>`).join('');
  document.querySelectorAll('.propose').forEach(b=>b.onclick=()=>createProposal(b.dataset.id));
  document.querySelectorAll('.edit-listing-card').forEach(b=>b.onclick=()=>editListingForm(b.dataset.id,'explore'));
  document.querySelectorAll('.delete-listing-card').forEach(b=>b.onclick=()=>deleteListing(b.dataset.id));
}
async function loadListings(){
  try{
    listings=await api('swap_listings?select=id,owner_id,title,category,description,condition,wants,location,image_url,status,created_at&status=eq.active&order=created_at.desc&limit=60',{auth:false});
    renderListings();
  }catch(e){if(!String(e.message).includes('Configure'))toast('Não foi possível carregar anúncios: '+e.message)}
}
function announceForm(){
  if(!user){authForm();toast('Entre ou crie uma conta para anunciar.');return}
  showModal(`<h2>Seu próximo anúncio</h2><p>Conte para a comunidade o que você quer trocar.</p><form id="listingForm"><label class="field">Título<input name="title" required maxlength="120" placeholder="Ex.: Bicicleta infantil"></label><label class="field">Categoria<select name="category" required><option value="">Selecione</option>${['Livros','Roupas','Calçados','Acessórios','Eletrônicos','Jogos','Material escolar','Colecionáveis','Outros'].map(x=>`<option>${x}</option>`).join('')}</select></label><label class="field">Estado de conservação<select name="condition" required><option>Novo</option><option>Quase novo</option><option>Usado, mas está bem</option><option>Usado, com algumas marcas</option><option>Precisa de alguns cuidados</option></select></label><label class="field">O que você procura em troca?<input name="wants" required maxlength="255"></label><label class="field">Cidade / região<input name="location" required maxlength="120"></label><label class="field">Descrição<textarea name="description" rows="3" required maxlength="2000"></textarea></label><label class="field">Foto do item (opcional)<input name="photo" type="file" accept="image/*"></label><div class="trade-disclaimer" role="note"><b>⚠ Aviso importante</b><p>A Trocaí atua exclusivamente como plataforma para <strong>viabilizar e facilitar</strong> a conexão entre pessoas que desejam trocar itens. A empresa <strong>não se responsabiliza pela justiça ou equivalência das trocas</strong>, nem por quaisquer acontecimentos antes, durante ou depois delas, incluindo negociações, encontros, o estado dos itens e a conduta das pessoas envolvidas. Toda troca é de responsabilidade exclusiva de quem participa dela.</p><label class="trade-disclaimer-check"><input type="checkbox" name="accept_terms" required><span>Li e estou ciente do aviso acima.</span></label></div><button class="primary">Publicar anúncio</button></form>`);
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
  showModal(`<div class="proposal-heading"><h2>Minhas propostas</h2><p>Acompanhe os interesses recebidos e as propostas que você enviou.</p></div><div class="proposal-tabs"><button class="${tab==='received'?'active':''}" id="receivedTab">Recebidas</button><button class="${tab==='sent'?'active':''}" id="sentTab">Enviadas</button><button class="${tab==='listings'?'active':''}" id="listingsTab">Meus anúncios</button></div><div id="proposalList" class="proposal-list"><p class="proposal-loading">Carregando propostas…</p></div>`);
  $('#receivedTab').onclick=()=>openProposals('received');
  $('#sentTab').onclick=()=>openProposals('sent');
  $('#listingsTab').onclick=()=>openProposals('listings');
  await loadProposals();
}
async function loadProposals(){
  const host=$('#proposalList');
  if(!host)return;
  if(proposalTab==='listings')return loadMyListings();
  try{
    const filter=proposalTab==='received'?`owner_id.eq.${user.id}`:`proposer_id.eq.${user.id}`;
    const rows=await api(`swap_proposals?select=id,listing_id,owner_id,proposer_id,offered_item,status,created_at&or=(${filter})&order=created_at.desc&limit=100`);
    if(!rows.length){
      host.innerHTML=`<div class="empty proposal-empty"><span>♡</span><h3>${proposalTab==='received'?'Nenhuma proposta recebida ainda':'Você ainda não enviou propostas'}</h3><p>${proposalTab==='received'?'Quando alguém demonstrar interesse em um dos seus anúncios, a proposta aparecerá aqui.':'Quando você demonstrar interesse em um anúncio, poderá acompanhar por aqui.'}</p></div>`;
      return;
    }
    window.trocaiProposalRows=rows;
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
      const mine=proposalTab==='sent'&&p.proposer_id===user.id;
      const canEdit=mine&&status==='pending';
      const canDelete=mine&&['pending','declined','cancelled'].includes(status);
      const mineActions=(canEdit||canDelete)?`<div class="proposal-actions">${canEdit?`<button class="edit-proposal" data-id="${p.id}">Editar</button>`:''}${canDelete?`<button class="delete-proposal" data-id="${p.id}">Excluir</button>`:''}</div>`:'';
      return `<article class="proposal-card"><div class="proposal-card-top"><div><span class="tag">${esc(l?.category||'Proposta')}</span><h3>${esc(l?.title||`Anúncio #${p.listing_id}`)}</h3></div><span class="proposal-status status-${esc(status)}">${esc(statusLabel)}</span></div><p class="proposal-person">${proposalTab==='received'?'Enviada por':'Proposta para'} <b>${esc(person?.display_name||'Usuário do Trocaí')}</b></p><div class="offered-item"><small>${proposalTab==='received'?'O que a pessoa oferece':'O que você ofereceu'}</small><p>${esc(p.offered_item)}</p></div>${canRespond?`<div class="proposal-actions"><button class="accept-proposal" data-id="${p.id}">Aceitar</button><button class="decline-proposal" data-id="${p.id}">Recusar</button></div>`:''}${status==='accepted'?`<div class="proposal-actions"><button class="open-proposal-chat" data-id="${p.id}">Abrir conversa</button></div>`:''}${mineActions}</article>`;
    }).join('');
    host.querySelectorAll('.accept-proposal').forEach(b=>b.onclick=()=>respondProposal(b.dataset.id,'accepted'));
    host.querySelectorAll('.decline-proposal').forEach(b=>b.onclick=()=>respondProposal(b.dataset.id,'declined'));
    host.querySelectorAll('.open-proposal-chat').forEach(b=>b.onclick=()=>openChatForProposal(b.dataset.id));
    host.querySelectorAll('.edit-proposal').forEach(b=>b.onclick=()=>editProposal(b.dataset.id));
    host.querySelectorAll('.delete-proposal').forEach(b=>b.onclick=()=>deleteProposal(b.dataset.id));
  }catch(e){
    host.innerHTML=`<div class="empty"><h3>Não foi possível carregar as propostas</h3><p>${esc(e.message)}</p><p>Confira se a tabela swap_proposals e as permissões de leitura estão configuradas.</p></div>`;
  }
}

async function loadChatUnreadCount(){
  // A tabela atual swap_messages não possui read_at.
  // O contador será omitido até implementarmos recibos de leitura no banco.
  const badge=$('#chatUnreadCount');
  if(badge){badge.hidden=true;badge.textContent='0'}
}
async function openChats(){
  if(!user){authForm();return}
  activeConversation=null;
  showModal(`<div class="chat-shell"><div class="chat-heading"><div><h2>Conversas</h2><p>Negocie os detalhes das suas trocas por aqui.</p></div></div><div id="chatConversationList" class="chat-conversation-list"><p class="proposal-loading">Carregando conversas…</p></div></div>`);
  await loadConversations();
}
async function loadConversations(){
  const host=$('#chatConversationList');
  if(!host||!user)return;
  try{
    // Cada proposta aceita representa uma conversa. Não dependemos de swap_conversations.
    const rows=await api(`swap_proposals?select=id,listing_id,owner_id,proposer_id,offered_item,status,created_at,updated_at&status=eq.accepted&or=(owner_id.eq.${encodeURIComponent(user.id)},proposer_id.eq.${encodeURIComponent(user.id)})&order=updated_at.desc&limit=100`);
    chatListCache=rows;
    if(!rows.length){
      host.innerHTML='<div class="empty proposal-empty"><span>♡</span><h3>Nenhuma conversa disponível</h3><p>Quando uma proposta sua for aceita, a conversa aparecerá aqui.</p></div>';
      return;
    }
    const listingIds=[...new Set(rows.map(x=>x.listing_id))];
    const otherIds=[...new Set(rows.map(x=>x.owner_id===user.id?x.proposer_id:x.owner_id))];
    const [listingRows,profileRows,messageRows]=await Promise.all([
      api(`swap_listings?select=id,title,category&id=in.(${listingIds.join(',')})`,{auth:false}),
      api(`profiles?select=id,display_name&id=in.(${otherIds.join(',')})`,{auth:false}),
      api(`swap_messages?select=id,proposal_id,content,created_at,sender_id&proposal_id=in.(${rows.map(x=>x.id).join(',')})&order=created_at.desc&limit=500`)
    ]);
    const listingMap=new Map(listingRows.map(x=>[String(x.id),x]));
    const profileMap=new Map(profileRows.map(x=>[x.id,x]));
    const latestMap=new Map();
    for(const m of messageRows){if(!latestMap.has(String(m.proposal_id)))latestMap.set(String(m.proposal_id),m)}
    host.innerHTML=rows.map(p=>{
      const l=listingMap.get(String(p.listing_id));
      const otherId=p.owner_id===user.id?p.proposer_id:p.owner_id;
      const person=profileMap.get(otherId);
      const last=latestMap.get(String(p.id));
      const preview=last?last.content:'Conversa iniciada. Envie a primeira mensagem!';
      const when=last?new Date(last.created_at).toLocaleDateString('pt-BR'):'Proposta aceita';
      return `<button class="chat-conversation-item" data-id="${p.id}"><span class="chat-avatar">${esc((person?.display_name||'T').trim().charAt(0).toUpperCase())}</span><span class="chat-conversation-copy"><b>${esc(person?.display_name||'Pessoa do Trocaí')}</b><strong>${esc(l?.title||`Anúncio #${p.listing_id}`)}</strong><small>${esc(preview)}</small></span><time>${esc(when)}</time></button>`;
    }).join('');
    host.querySelectorAll('.chat-conversation-item').forEach(b=>b.addEventListener('click',()=>{
      const proposal=chatListCache.find(p=>String(p.id)===String(b.dataset.id));
      if(proposal)openChat(proposal);
    }));
  }catch(e){
    host.innerHTML=`<div class="empty"><h3>Não foi possível carregar as conversas</h3><p>${esc(e.message)}</p><p>Confira as permissões de leitura de swap_proposals e swap_messages no Supabase.</p></div>`;
  }
}
async function openChatForProposal(proposalId){
  try{
    let proposal=chatListCache.find(p=>String(p.id)===String(proposalId));
    if(!proposal){
      const rows=await api(`swap_proposals?select=id,listing_id,owner_id,proposer_id,offered_item,status,created_at,updated_at&id=eq.${encodeURIComponent(proposalId)}&status=eq.accepted&limit=1`);
      proposal=rows[0];
    }
    if(!proposal)throw Error('Proposta aceita não encontrada ou sem permissão de acesso.');
    await openChat(proposal);
  }catch(e){toast(e.message)}
}
async function openChat(proposal){
  try{
    if(!proposal||proposal.status!=='accepted')throw Error('O chat só fica disponível depois que a proposta é aceita.');
    activeConversation=proposal;
    const otherId=proposal.owner_id===user.id?proposal.proposer_id:proposal.owner_id;
    const [profiles,listingsForChat]=await Promise.all([
      api(`profiles?select=id,display_name&id=eq.${encodeURIComponent(otherId)}&limit=1`,{auth:false}),
      api(`swap_listings?select=id,title&id=eq.${encodeURIComponent(proposal.listing_id)}&limit=1`,{auth:false})
    ]);
    const person=profiles[0]?.display_name||'Pessoa do Trocaí';
    const title=listingsForChat[0]?.title||`Anúncio #${proposal.listing_id}`;
    showModal(`<div class="chat-thread"><div class="chat-thread-header"><button type="button" class="chat-back" id="chatBack">← Conversas</button><div><h2>${esc(person)}</h2><p>${esc(title)}</p></div></div><div id="chatMessages" class="chat-messages"><p class="proposal-loading">Carregando mensagens…</p></div><form id="chatSendForm" class="chat-send-form"><textarea name="message" rows="2" maxlength="3000" placeholder="Escreva sua mensagem…" required></textarea><button class="primary" type="submit" aria-label="Enviar mensagem">Enviar ➤</button></form><p class="chat-safety-note">Dica de segurança: combine encontros em locais públicos e movimentados.</p></div>`);
    $('#chatBack').onclick=openChats;
    $('#chatSendForm').onsubmit=sendChatMessage;
    await loadChatMessages();
  }catch(e){toast('Não foi possível abrir a conversa: '+e.message)}
}
async function loadChatMessages(){
  if(chatFetchBusy||!activeConversation||!$('#chatMessages'))return;
  chatFetchBusy=true;
  try{
    const rows=await api(`swap_messages?select=id,proposal_id,sender_id,content,created_at&proposal_id=eq.${encodeURIComponent(activeConversation.id)}&order=created_at.asc&limit=300`);
    const host=$('#chatMessages');
    if(!host)return;
    const nearBottom=host.scrollHeight-host.scrollTop-host.clientHeight<100;
    host.innerHTML=rows.length?rows.map(m=>`<div class="chat-message-row ${m.sender_id===user.id?'mine':'theirs'}"><div class="chat-bubble">${esc(m.content).replace(/\n/g,'<br>')}<time>${esc(new Date(m.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}))}</time></div></div>`).join(''):'<div class="chat-empty"><span>♡</span><p>Esta conversa está começando. Envie uma mensagem para combinar os detalhes da troca.</p></div>';
    if(nearBottom)host.scrollTop=host.scrollHeight;
  }catch(e){
    const host=$('#chatMessages');
    if(host)host.innerHTML=`<div class="empty"><p>Não foi possível carregar as mensagens: ${esc(e.message)}</p></div>`;
  }finally{chatFetchBusy=false}
}
async function sendChatMessage(e){
  e.preventDefault();
  if(!activeConversation||!user)return;
  const form=e.currentTarget;
  const field=form.elements.message;
  const content=field.value.trim();
  if(!content)return;
  const button=form.querySelector('button[type="submit"]');
  button.disabled=true;
  try{
    await api('swap_messages',{method:'POST',body:{proposal_id:activeConversation.id,sender_id:user.id,content},headers:{Prefer:'return=minimal'}});
    field.value='';
    await loadChatMessages();
  }catch(err){toast('Não foi possível enviar a mensagem: '+err.message)}
  finally{button.disabled=false;field.focus()}
}

async function loadNotificationCount(){
  if(!user||!token)return;
  try{
    const rows=await api(`swap_notifications?select=id&recipient_id=eq.${encodeURIComponent(user.id)}&is_read=eq.false&limit=100`);
    const badge=$('#notificationCount');
    if(!badge)return;
    badge.textContent=String(rows.length);
    badge.hidden=rows.length===0;
  }catch(e){
    console.warn('Não foi possível atualizar o contador de notificações:',e.message);
  }
}
async function openNotifications(){
  if(!user){authForm();return}
  showModal(`<div class="notification-heading"><h2>Notificações</h2><p>Acompanhe as novidades das suas trocas.</p></div><div id="notificationList" class="notification-list"><p class="proposal-loading">Carregando notificações…</p></div>`);
  await loadNotifications();
}
async function loadNotifications(){
  const host=$('#notificationList');
  if(!host||!user)return;
  try{
    const rows=await api(`swap_notifications?select=id,proposal_id,notification_type,message,is_read,created_at&recipient_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=50`);
    if(!rows.length){
      host.innerHTML='<div class="empty proposal-empty"><span>♧</span><h3>Nenhuma notificação ainda</h3><p>Quando alguém interagir com suas propostas, avisaremos por aqui.</p></div>';
      await loadNotificationCount();
      return;
    }
    const labels={proposal_received:'Nova proposta',proposal_accepted:'Proposta aceita',proposal_declined:'Proposta recusada'};
    host.innerHTML=rows.map(n=>`<article class="notification-card ${n.is_read?'is-read':'is-unread'}"><div class="notification-card-main"><div class="notification-card-top"><b>${esc(labels[n.notification_type]||'Atualização')}</b><small>${esc(new Date(n.created_at).toLocaleString('pt-BR'))}</small></div><p>${esc(n.message)}</p></div><div class="notification-actions">${!n.is_read?`<button class="notification-read" data-id="${n.id}">Marcar como lida</button>`:''}${n.proposal_id?`<button class="notification-open" data-id="${n.id}">Ver proposta</button>`:''}</div></article>`).join('');
    host.querySelectorAll('.notification-read').forEach(b=>b.addEventListener('click',()=>markNotificationRead(b.dataset.id,false)));
    host.querySelectorAll('.notification-open').forEach(b=>b.addEventListener('click',()=>markNotificationRead(b.dataset.id,true)));
    await loadNotificationCount();
  }catch(e){
    host.innerHTML=`<div class="empty"><h3>Não foi possível carregar as notificações</h3><p>${esc(e.message)}</p><p>Confira se a tabela swap_notifications e as políticas RLS estão configuradas.</p></div>`;
  }
}
async function markNotificationRead(id,openProposal){
  try{
    await api(`swap_notifications?id=eq.${encodeURIComponent(id)}&recipient_id=eq.${encodeURIComponent(user.id)}`,{
      method:'PATCH',body:{is_read:true},headers:{Prefer:'return=minimal'}
    });
    await loadNotificationCount();
    if(openProposal){
      const item=await api(`swap_notifications?select=notification_type&recipient_id=eq.${encodeURIComponent(user.id)}&id=eq.${encodeURIComponent(id)}&limit=1`);
      const type=item[0]?.notification_type;
      await openProposals(type==='proposal_received'?'received':'sent');
    }else{
      await loadNotifications();
    }
  }catch(e){toast('Não foi possível atualizar a notificação: '+e.message)}
}

const NO_PERMISSION_MSG='Nada foi alterado. Provavelmente falta a permissão (RLS) no Supabase — rode o arquivo supabase-editar-excluir.sql.';
function friendlyDbError(e){return /foreign key/i.test(e.message)?'Este item já tem conversas ou notificações vinculadas e não pode ser excluído.':e.message}
async function editProposal(id){
  const current=(window.trocaiProposalRows||[]).find(p=>String(p.id)===String(id));
  if(!current)return;
  const text=prompt('Edite o que você está oferecendo:',current.offered_item||'');
  if(text===null)return;
  if(!text.trim()){toast('Escreva uma mensagem antes de salvar.');return}
  if(text.trim()===(current.offered_item||'').trim())return;
  try{
    const rows=await api(`swap_proposals?id=eq.${encodeURIComponent(id)}&proposer_id=eq.${encodeURIComponent(user.id)}&status=eq.pending`,{method:'PATCH',body:{offered_item:text.trim(),updated_at:new Date().toISOString()},headers:{Prefer:'return=representation'}});
    if(!rows?.length){toast(NO_PERMISSION_MSG);return}
    toast('Proposta atualizada.');await loadProposals();
  }catch(e){toast('Não foi possível editar a proposta: '+friendlyDbError(e))}
}
async function deleteProposal(id){
  if(!confirm('Excluir esta proposta? Esta ação não pode ser desfeita.'))return;
  try{
    const rows=await api(`swap_proposals?id=eq.${encodeURIComponent(id)}&proposer_id=eq.${encodeURIComponent(user.id)}`,{method:'DELETE',headers:{Prefer:'return=representation'}});
    if(!rows?.length){toast(NO_PERMISSION_MSG);return}
    toast('Proposta excluída.');await loadProposals();
  }catch(e){toast('Não foi possível excluir a proposta: '+friendlyDbError(e))}
}
async function loadMyListings(){
  const host=$('#proposalList');if(!host)return;
  try{
    const rows=await api(`swap_listings?select=id,owner_id,title,category,description,condition,wants,location,image_url,status,created_at&owner_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=100`);
    window.trocaiMyListings=rows;
    if(!rows.length){host.innerHTML='<div class="empty proposal-empty"><span>✦</span><h3>Você ainda não publicou anúncios</h3><p>Use o botão “Anunciar” para publicar o primeiro.</p></div>';return}
    host.innerHTML=rows.map(l=>`<article class="proposal-card"><div class="proposal-card-top"><div><span class="tag">${esc(l.category)}</span><h3>${esc(l.title)}</h3></div><span class="proposal-status status-${esc(l.status||'active')}">${l.status==='active'||!l.status?'Publicado':esc(l.status)}</span></div><p class="proposal-person">⌖ ${esc(l.location)} · ${esc(l.condition)}</p><div class="offered-item"><small>O que você procura em troca</small><p>${esc(l.wants)}</p></div><div class="proposal-actions"><button class="edit-listing" data-id="${l.id}">Editar</button><button class="delete-listing" data-id="${l.id}">Excluir</button></div></article>`).join('');
    host.querySelectorAll('.edit-listing').forEach(b=>b.onclick=()=>editListingForm(b.dataset.id));
    host.querySelectorAll('.delete-listing').forEach(b=>b.onclick=()=>deleteListing(b.dataset.id));
  }catch(e){host.innerHTML=`<div class="empty"><h3>Não foi possível carregar seus anúncios</h3><p>${esc(e.message)}</p></div>`}
}
function editListingForm(id,origin='proposals'){
  const l=[...(window.trocaiMyListings||[]),...listings].find(x=>String(x.id)===String(id));if(!l)return;
  if(!user||l.owner_id!==user.id){toast('Somente quem criou o anúncio pode editá-lo.');return}
  const back=()=>origin==='explore'?closeModal():openProposals('listings');
  const cats=['Livros','Roupas','Calçados','Acessórios','Eletrônicos','Jogos','Material escolar','Colecionáveis','Outros'];
  const conds=['Novo','Quase novo','Usado, mas está bem','Usado, com algumas marcas','Precisa de alguns cuidados'];
  showModal(`<h2>Editar anúncio</h2><p>Atualize as informações do seu anúncio.</p><form id="editListingForm"><label class="field">Título<input name="title" required maxlength="120" value="${esc(l.title)}"></label><label class="field">Categoria<select name="category" required>${cats.map(x=>`<option${x===l.category?' selected':''}>${x}</option>`).join('')}</select></label><label class="field">Estado de conservação<select name="condition" required>${conds.map(x=>`<option${x===l.condition?' selected':''}>${x}</option>`).join('')}</select></label><label class="field">O que você procura em troca?<input name="wants" required maxlength="255" value="${esc(l.wants)}"></label><label class="field">Cidade / região<input name="location" required maxlength="120" value="${esc(l.location)}"></label><label class="field">Descrição<textarea name="description" rows="3" required maxlength="2000">${esc(l.description)}</textarea></label><button class="primary" type="submit">Salvar alterações</button><button class="secondary" type="button" id="cancelEditListing" style="width:100%;margin-top:8px">Cancelar</button></form>`);
  $('#cancelEditListing').onclick=back;
  $('#editListingForm').onsubmit=async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget);const btn=e.currentTarget.querySelector('.primary');btn.disabled=true;
    try{
      const body={title:f.get('title').trim(),category:f.get('category'),condition:f.get('condition'),wants:f.get('wants').trim(),location:f.get('location').trim(),description:f.get('description').trim()};
      const rows=await api(`swap_listings?id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(user.id)}`,{method:'PATCH',body,headers:{Prefer:'return=representation'}});
      if(!rows?.length){toast(NO_PERMISSION_MSG);btn.disabled=false;return}
      toast('Anúncio atualizado.');await loadListings();await back();
    }catch(err){toast('Não foi possível salvar: '+friendlyDbError(err));btn.disabled=false}
  };
}
async function deleteListing(id){
  if(!confirm('Excluir este anúncio? Esta ação não pode ser desfeita.'))return;
  try{
    const rows=await api(`swap_listings?id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(user.id)}`,{method:'DELETE',headers:{Prefer:'return=representation'}});
    if(!rows?.length){toast(NO_PERMISSION_MSG);return}
    toast('Anúncio excluído.');await loadListings();await loadProposals();
  }catch(e){toast('Não foi possível excluir o anúncio: '+friendlyDbError(e))}
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
$('#menuBtn').onclick=()=>{
  const header=$('#topbar');
  const button=$('#menuBtn');
  const opened=header.classList.toggle('mobile-open');
  button.setAttribute('aria-expanded',String(opened));
  button.setAttribute('aria-label',opened?'Fechar menu':'Abrir menu');
  button.textContent=opened?'×':'☰';
};
document.querySelectorAll('#mainNav a').forEach(link=>link.addEventListener('click',()=>{
  $('#topbar').classList.remove('mobile-open');
  $('#menuBtn').setAttribute('aria-expanded','false');
  $('#menuBtn').setAttribute('aria-label','Abrir menu');
  $('#menuBtn').textContent='☰';
}));
$('#headerActions').addEventListener('click',()=>{
  $('#topbar').classList.remove('mobile-open');
  $('#menuBtn').setAttribute('aria-expanded','false');
  $('#menuBtn').setAttribute('aria-label','Abrir menu');
  $('#menuBtn').textContent='☰';
});
document.addEventListener('click',e=>{
  if(e.target.id==='logoutBtn')logout();
  if(e.target.id==='openMyProposals')openProposals();
});
if(token&&user){
  updateAccount();
  refreshAdminRole();
  fetch(`${base}/auth/v1/user`,{headers:{apikey:key,Authorization:`Bearer ${token}`}})
    .then(r=>{if(!r.ok)logout()}).catch(()=>{});
}else updateAccount();
loadListings();
if(token&&user)loadNotificationCount();
setInterval(()=>{loadNotificationCount();loadChatUnreadCount();if(activeConversation&&$('#chatMessages'))loadChatMessages()},5000);
if(token&&user)loadNotificationCount();
setInterval(loadNotificationCount,30000);

// Banners publicitários: sorteio novo a cada carregamento da página.
loadPublicAds();
