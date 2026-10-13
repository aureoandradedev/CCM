-- Anonimiza a conta do próprio usuário autenticado (LGPD art. 18).
-- SECURITY DEFINER: roda com privilégios do owner para poder atualizar
-- orders (sem UPDATE policy para customer), deletar leads e remover auth.users.
create or replace function public.anonymize_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  p_email text;
begin
  if uid is null then
    raise exception 'Não autenticado.';
  end if;

  select email into p_email
  from public.profiles where id = uid;

  -- 1. Anonimizar pedidos: remover PII dos snapshots, desvincular perfil
  update public.orders
  set
    customer     = jsonb_build_object('name', 'Conta excluída'),
    address      = null,
    delivery_cep = null,
    notes        = null,
    profile_id   = null
  where profile_id = uid;

  -- 2. Endereços
  delete from public.addresses where profile_id = uid;

  -- 3. Leads vinculados ao e-mail exato (não por telefone: risco de atingir outro titular)
  if p_email is not null and p_email <> '' then
    delete from public.leads where email = p_email;
  end if;

  -- 4. Desvincular FKs sem cascade (campaigns e site_settings são de admin,
  --    mas protege contra erro se um admin usar esta função)
  update public.campaigns set created_by = null where created_by = uid;
  update public.site_settings set updated_by = null where updated_by = uid;

  -- 5. Excluir conta de autenticação (cascade remove o perfil)
  delete from auth.users where id = uid;
end;
$$;

-- Apenas usuários autenticados podem solicitar a própria anonimização.
revoke all on function public.anonymize_my_account() from public;
revoke all on function public.anonymize_my_account() from anon;
grant execute on function public.anonymize_my_account() to authenticated;
