function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Authorization'
  }});
}

export async function onRequestGet({ request, env }) {
  const authorization = request.headers.get('Authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return json({ error: 'Autenticação necessária.' }, 401);

  const supabaseUrl = (env.SUPABASE_URL || '').replace(/\/$/, '');
  const anonKey = env.SUPABASE_ANON_KEY || '';
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: 'A função administrativa ainda não foi configurada no Cloudflare.' }, 503);
  }

  const accessToken = match[1];
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` }
  });
  if (!userResponse.ok) return json({ error: 'Sessão inválida ou expirada. Entre novamente.' }, 401);
  const authUser = await userResponse.json();
  if (!authUser?.id) return json({ error: 'Não foi possível validar a conta.' }, 401);

  // A chave sb_secret_ é uma API key opaca, não um JWT.
  // Envie-a somente no cabeçalho apikey; o Bearer continua reservado
  // ao access token do usuário, já validado acima.
  const adminHeaders = { apikey: serviceKey, 'Content-Type': 'application/json' };
  const roleResponse = await fetch(`${supabaseUrl}/rest/v1/user_roles?select=role&user_id=eq.${encodeURIComponent(authUser.id)}&limit=1`, { headers: adminHeaders });
  if (!roleResponse.ok) return json({ error: 'Não foi possível validar a permissão administrativa.' }, 502);
  const roles = await roleResponse.json();
  if (!roles.some(item => item.role === 'admin')) return json({ error: 'Acesso administrativo não autorizado.' }, 403);

  const profilesResponse = await fetch(`${supabaseUrl}/rest/v1/profiles?select=id,display_name,city,created_at&order=created_at.desc&limit=2000`, { headers: adminHeaders });
  if (!profilesResponse.ok) return json({ error: 'Não foi possível consultar os perfis.' }, 502);
  const profiles = await profilesResponse.json();

  const authUsers = [];
  for (let page = 1; page <= 20; page += 1) {
    const response = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=100`, { headers: adminHeaders });
    if (!response.ok) return json({ error: 'Não foi possível consultar os e-mails das contas.' }, 502);
    const payload = await response.json();
    const batch = Array.isArray(payload.users) ? payload.users : [];
    authUsers.push(...batch);
    if (batch.length < 100) break;
  }

  const profileById = new Map(profiles.map(item => [item.id, item]));
  const ids = authUsers.map(item => item.id);
  const rolesResponse = ids.length
    ? await fetch(`${supabaseUrl}/rest/v1/user_roles?select=user_id,role&user_id=in.(${ids.map(encodeURIComponent).join(',')})&limit=2000`, { headers: adminHeaders })
    : null;
  if (rolesResponse && !rolesResponse.ok) return json({ error: 'Não foi possível consultar as funções das contas.' }, 502);
  const allRoles = rolesResponse ? await rolesResponse.json() : [];
  const roleById = new Map(allRoles.map(item => [item.user_id, item.role]));

  const users = authUsers.map(account => {
    const profile = profileById.get(account.id) || {};
    return {
      id: account.id,
      name: profile.display_name || account.user_metadata?.name || 'Nome não informado',
      email: account.email || '',
      city: profile.city || '',
      created_at: profile.created_at || account.created_at || null,
      role: roleById.get(account.id) === 'admin' ? 'admin' : 'user'
    };
  }).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return json({ users, total: users.length, admins: users.filter(item => item.role === 'admin').length });
}
