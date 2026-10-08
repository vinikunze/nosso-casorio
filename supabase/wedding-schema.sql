-- ============================================================================
-- Nosso Casório — schema completo
--
-- Aplicado no projeto Supabase "nosso-casorio" (sifoxqaxqzygqxonqwlw) pelas
-- migrations wedding_base_schema, wedding_rls_policies,
-- move_permission_helpers_to_private_schema e planner_views_without_amounts. Este arquivo junta todas, para
-- consulta e para recriar o banco do zero se um dia for preciso.
--
-- Quem é quem (wedding_members.role):
--   owner    quem criou o casamento — vê e edita tudo, convida pessoas
--   editor   o par — vê e edita tudo
--   planner  a cerimonialista — vê tudo, menos dinheiro: edita convidados,
--            fornecedores (contatos e situação), checklist e roteiro; vê o
--            andamento dos pagamentos e a lua de mel SEM valores (pelas
--            funções get_payment_status e get_honeymoon_overview).
--   viewer   só leitura de tudo (não aparece na tela, fica de reserva)
--
-- Por isso o que é dinheiro mora em tabelas separadas (vendor_contracts,
-- vendor_payments, wedding_private, honeymoon_items): a RLS esconde a linha
-- inteira, coisa que ela não consegue fazer com uma coluna só.
-- ============================================================================

-- ------------------------------------------------------------------ tipos ---

create type public.member_role         as enum ('owner', 'editor', 'planner', 'viewer');
create type public.invite_status       as enum ('pending', 'accepted', 'revoked');
create type public.guest_status        as enum ('pending', 'confirmed', 'declined');
create type public.wedding_task_status as enum ('pending', 'in_progress', 'done');
create type public.ros_role            as enum ('bride', 'groom', 'both');
-- Situação do fornecedor: tudo certo, falta acertar, ou precisa de atenção já.
create type public.vendor_status       as enum ('pending', 'urgent', 'ok');

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path to ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function public.set_updated_at() from anon, authenticated, public;

-- ---------------------------------------------------------------- tabelas ---

create table public.weddings (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references auth.users (id) on delete cascade,
  partner1_name    text not null,
  partner2_name    text not null,
  wedding_date     date,
  ceremony_time    time,
  venue            text,
  city             text,
  cover_image_url  text,
  timezone         text not null default 'America/Sao_Paulo',
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index weddings_owner_id_idx on public.weddings (owner_id);

-- Orçamento e lua de mel: só o casal enxerga.
create table public.wedding_private (
  wedding_id            uuid primary key references public.weddings (id) on delete cascade,
  estimated_budget      numeric(12,2),
  honeymoon_destination text,
  honeymoon_start       date,
  honeymoon_end         date,
  honeymoon_budget      numeric(12,2),
  honeymoon_notes       text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table public.wedding_members (
  id             uuid primary key default gen_random_uuid(),
  wedding_id     uuid not null references public.weddings (id) on delete cascade,
  user_id        uuid references auth.users (id) on delete cascade,
  role           public.member_role not null default 'viewer',
  display_name   text,
  invited_email  text,
  invite_status  public.invite_status not null default 'pending',
  invite_token   uuid not null default gen_random_uuid(),
  invited_by     uuid references auth.users (id) on delete set null,
  accepted_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index wedding_members_unique_user on public.wedding_members (wedding_id, user_id)
  where user_id is not null;
create unique index wedding_members_invite_token_idx on public.wedding_members (invite_token);
create index wedding_members_wedding_id_idx on public.wedding_members (wedding_id);
create index wedding_members_user_id_idx on public.wedding_members (user_id);
create index wedding_members_invited_by_idx on public.wedding_members (invited_by);
create index wedding_members_invited_email_idx on public.wedding_members (lower(invited_email));

-- Fornecedor = ficha de contato e situação. Nada de dinheiro aqui.
create table public.vendors (
  id            uuid primary key default gen_random_uuid(),
  wedding_id    uuid not null references public.weddings (id) on delete cascade,
  name          text not null,
  category      text not null default 'other',
  status        public.vendor_status not null default 'pending',
  contact_name  text,
  phone         text,
  email         text,
  next_step     text,
  arrival_time  time,
  notes         text,
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index vendors_wedding_id_idx on public.vendors (wedding_id);

-- O contrato (valor e forma de pagamento) fica à parte, 1:1 com o fornecedor.
create table public.vendor_contracts (
  vendor_id      uuid primary key references public.vendors (id) on delete cascade,
  total_amount   numeric(12,2) not null default 0,
  payment_method text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.vendor_payments (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid not null references public.vendors (id) on delete cascade,
  description text not null,
  amount      numeric(12,2) not null default 0,
  due_date    date,
  is_paid     boolean not null default false,
  paid_at     date,
  position    integer not null default 0,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index vendor_payments_vendor_id_idx on public.vendor_payments (vendor_id);
create index vendor_payments_due_date_idx on public.vendor_payments (due_date);

create table public.guests (
  id           uuid primary key default gen_random_uuid(),
  wedding_id   uuid not null references public.weddings (id) on delete cascade,
  name         text not null,
  phone        text,
  group_name   text not null default 'Família',
  adults       smallint not null default 1,
  children     smallint not null default 0,
  status       public.guest_status not null default 'pending',
  invite_sent  boolean not null default false,
  beverages    jsonb not null default '{}'::jsonb,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index guests_wedding_id_idx on public.guests (wedding_id);

create table public.wedding_tasks (
  id          uuid primary key default gen_random_uuid(),
  wedding_id  uuid not null references public.weddings (id) on delete cascade,
  title       text not null,
  status      public.wedding_task_status not null default 'pending',
  due_date    date,
  position    integer not null default 0,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index wedding_tasks_wedding_id_idx on public.wedding_tasks (wedding_id);

create table public.run_of_show_items (
  id          uuid primary key default gen_random_uuid(),
  wedding_id  uuid not null references public.weddings (id) on delete cascade,
  event_time  time not null,
  role        public.ros_role not null default 'both',
  title       text not null,
  description text,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index run_of_show_items_wedding_id_idx on public.run_of_show_items (wedding_id);

-- Lua de mel: gastos e pendências da viagem numa lista só.
create table public.honeymoon_items (
  id          uuid primary key default gen_random_uuid(),
  wedding_id  uuid not null references public.weddings (id) on delete cascade,
  title       text not null,
  category    text not null default 'other',
  amount      numeric(12,2),
  due_date    date,
  is_done     boolean not null default false,
  position    integer not null default 0,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index honeymoon_items_wedding_id_idx on public.honeymoon_items (wedding_id);

-- ------------------------------------------------- funções de permissão -----
-- SECURITY DEFINER para poder ler wedding_members sem cair na RLS dela mesma.
-- Ficam no schema "private", que a API do Supabase não expõe: as policies
-- usam, mas ninguém chama por /rest/v1/rpc.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.wedding_role(p_wedding_id uuid)
returns public.member_role
language sql stable security definer set search_path to 'public'
as $$
  select m.role
  from public.wedding_members m
  where m.wedding_id = p_wedding_id
    and m.user_id = auth.uid()
    and m.invite_status = 'accepted'
  order by case m.role when 'owner' then 0 when 'editor' then 1 when 'planner' then 2 else 3 end
  limit 1;
$$;

create or replace function private.is_wedding_member(p_wedding_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $$ select private.wedding_role(p_wedding_id) is not null; $$;

-- O casal: edita tudo, inclusive valores.
create or replace function private.can_edit_wedding(p_wedding_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $$ select private.wedding_role(p_wedding_id) in ('owner', 'editor'); $$;

-- Casal + cerimonialista: convidados, fornecedores, checklist, roteiro.
create or replace function private.can_plan_wedding(p_wedding_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $$ select private.wedding_role(p_wedding_id) in ('owner', 'editor', 'planner'); $$;

-- Quem enxerga dinheiro: todo mundo menos a cerimonialista.
create or replace function private.can_see_finance(p_wedding_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $$ select private.wedding_role(p_wedding_id) in ('owner', 'editor', 'viewer'); $$;

create or replace function private.is_wedding_owner(p_wedding_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $$ select private.wedding_role(p_wedding_id) = 'owner'; $$;

-- As policies chamam estas funções com os privilégios de quem consulta,
-- então authenticated precisa de EXECUTE. anon fica de fora.
revoke all on function private.wedding_role(uuid)      from anon, authenticated, public;
revoke all on function private.is_wedding_member(uuid) from anon, authenticated, public;
revoke all on function private.can_edit_wedding(uuid)  from anon, authenticated, public;
revoke all on function private.can_plan_wedding(uuid)  from anon, authenticated, public;
revoke all on function private.can_see_finance(uuid)   from anon, authenticated, public;
revoke all on function private.is_wedding_owner(uuid)  from anon, authenticated, public;
grant execute on function private.wedding_role(uuid)      to authenticated;
grant execute on function private.is_wedding_member(uuid) to authenticated;
grant execute on function private.can_edit_wedding(uuid)  to authenticated;
grant execute on function private.can_plan_wedding(uuid)  to authenticated;
grant execute on function private.can_see_finance(uuid)   to authenticated;
grant execute on function private.is_wedding_owner(uuid)  to authenticated;

-- ------------------------------------------------------------- triggers -----

create or replace function public.handle_new_wedding()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  insert into public.wedding_members (wedding_id, user_id, role, invite_status, accepted_at, invited_by)
  values (new.id, new.owner_id, 'owner', 'accepted', now(), new.owner_id)
  on conflict do nothing;

  insert into public.wedding_private (wedding_id) values (new.id)
  on conflict do nothing;

  return new;
end;
$$;
revoke all on function public.handle_new_wedding() from anon, authenticated, public;

create trigger weddings_after_insert after insert on public.weddings
  for each row execute function public.handle_new_wedding();

create trigger weddings_set_updated_at before update on public.weddings
  for each row execute function public.set_updated_at();
create trigger wedding_private_set_updated_at before update on public.wedding_private
  for each row execute function public.set_updated_at();
create trigger wedding_members_set_updated_at before update on public.wedding_members
  for each row execute function public.set_updated_at();
create trigger vendors_set_updated_at before update on public.vendors
  for each row execute function public.set_updated_at();
create trigger vendor_contracts_set_updated_at before update on public.vendor_contracts
  for each row execute function public.set_updated_at();
create trigger vendor_payments_set_updated_at before update on public.vendor_payments
  for each row execute function public.set_updated_at();
create trigger guests_set_updated_at before update on public.guests
  for each row execute function public.set_updated_at();
create trigger wedding_tasks_set_updated_at before update on public.wedding_tasks
  for each row execute function public.set_updated_at();
create trigger run_of_show_items_set_updated_at before update on public.run_of_show_items
  for each row execute function public.set_updated_at();
create trigger honeymoon_items_set_updated_at before update on public.honeymoon_items
  for each row execute function public.set_updated_at();

create or replace function public.sync_vendor_payment_paid_at()
returns trigger language plpgsql set search_path to ''
as $$
begin
  if new.is_paid and new.paid_at is null then
    new.paid_at = current_date;
  elsif not new.is_paid then
    new.paid_at = null;
  end if;
  return new;
end;
$$;
revoke all on function public.sync_vendor_payment_paid_at() from anon, authenticated, public;

create trigger vendor_payments_sync_paid_at before insert or update on public.vendor_payments
  for each row execute function public.sync_vendor_payment_paid_at();

-- ------------------------------------------------------------- convites -----

-- Aceite manual, pelo código.
create or replace function public.accept_wedding_invite(p_token uuid)
returns uuid language plpgsql security definer set search_path to 'public'
as $$
declare
  v_member public.wedding_members%rowtype;
  v_email  text;
  v_uid    uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'É necessário estar autenticado para aceitar o convite';
  end if;

  select email into v_email from auth.users where id = v_uid;
  select * into v_member from public.wedding_members where invite_token = p_token;

  if not found then raise exception 'Convite não encontrado'; end if;
  if v_member.invite_status = 'revoked' then raise exception 'Este convite foi cancelado'; end if;
  if v_member.user_id is not null and v_member.user_id <> v_uid then
    raise exception 'Este convite pertence a outra conta';
  end if;
  if v_member.invited_email is not null
     and lower(v_member.invited_email) <> lower(coalesce(v_email, '')) then
    raise exception 'Este convite foi enviado para outro e-mail';
  end if;

  if exists (
    select 1 from public.wedding_members
    where wedding_id = v_member.wedding_id and user_id = v_uid and id <> v_member.id
  ) then
    delete from public.wedding_members where id = v_member.id;
    return v_member.wedding_id;
  end if;

  update public.wedding_members
     set user_id = v_uid, invite_status = 'accepted', accepted_at = now()
   where id = v_member.id;

  return v_member.wedding_id;
end;
$$;
revoke all on function public.accept_wedding_invite(uuid) from anon, public;
grant execute on function public.accept_wedding_invite(uuid) to authenticated;

-- Aceite automático: quem entra com um e-mail CONFIRMADO que tem convite
-- pendente já cai direto no casamento, sem precisar colar código.
-- Exigir e-mail confirmado é o que impede alguém de criar conta com o e-mail
-- da cerimonialista e tomar o lugar dela.
create or replace function public.claim_my_invites()
returns integer language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid       uuid := auth.uid();
  v_email     text;
  v_confirmed timestamptz;
  v_count     integer := 0;
  r           public.wedding_members%rowtype;
begin
  if v_uid is null then return 0; end if;

  select email, email_confirmed_at into v_email, v_confirmed from auth.users where id = v_uid;
  if v_email is null or v_confirmed is null then return 0; end if;

  for r in
    select * from public.wedding_members
    where user_id is null
      and invite_status = 'pending'
      and lower(invited_email) = lower(v_email)
  loop
    if exists (select 1 from public.wedding_members where wedding_id = r.wedding_id and user_id = v_uid) then
      delete from public.wedding_members where id = r.id;
    else
      update public.wedding_members
         set user_id = v_uid, invite_status = 'accepted', accepted_at = now()
       where id = r.id;
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;
revoke all on function public.claim_my_invites() from anon, public;
grant execute on function public.claim_my_invites() to authenticated;

-- ------------------------------------- andamento sem valores (cerimonialista)
-- Ela não lê vendor_payments nem honeymoon_items/wedding_private (RLS). Estas
-- funções devolvem o andamento SEM nenhum valor em dinheiro, para qualquer
-- membro do casamento.

create or replace function public.get_payment_status(p_wedding_id uuid)
returns table (
  payment_id     uuid,
  vendor_id      uuid,
  description    text,
  due_date       date,
  is_paid        boolean,
  "position"     integer,
  vendor_settled boolean
)
language sql stable security definer set search_path to 'public'
as $$
  with totals as (
    select v.id as vendor_id,
           coalesce(c.total_amount, 0) as contracted,
           coalesce(sum(p.amount) filter (where p.is_paid), 0) as paid
    from public.vendors v
    left join public.vendor_contracts c on c.vendor_id = v.id
    left join public.vendor_payments p on p.vendor_id = v.id
    where v.wedding_id = p_wedding_id
    group by v.id, c.total_amount
  )
  select p.id, p.vendor_id, p.description, p.due_date, p.is_paid, p.position,
         (t.contracted > 0 and t.paid >= t.contracted - 0.005)
  from public.vendor_payments p
  join public.vendors v on v.id = p.vendor_id
  join totals t on t.vendor_id = p.vendor_id
  where v.wedding_id = p_wedding_id
    and private.is_wedding_member(p_wedding_id)
  order by p.due_date nulls last, p.position;
$$;

create or replace function public.get_honeymoon_overview(p_wedding_id uuid)
returns jsonb
language sql stable security definer set search_path to 'public'
as $$
  select case when private.is_wedding_member(p_wedding_id) then
    jsonb_build_object(
      'destination', w.honeymoon_destination,
      'start', w.honeymoon_start,
      'end', w.honeymoon_end,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', h.id, 'title', h.title, 'category', h.category,
                 'due_date', h.due_date, 'is_done', h.is_done)
               order by h.position, h.created_at)
        from public.honeymoon_items h
        where h.wedding_id = p_wedding_id), '[]'::jsonb)
    )
  end
  from public.wedding_private w
  where w.wedding_id = p_wedding_id;
$$;

revoke all on function public.get_payment_status(uuid)     from anon, public;
revoke all on function public.get_honeymoon_overview(uuid) from anon, public;
grant execute on function public.get_payment_status(uuid)     to authenticated;
grant execute on function public.get_honeymoon_overview(uuid) to authenticated;

-- ------------------------------------------------------------------ RLS -----
-- Sem ser membro do casamento, nenhuma linha é visível.

alter table public.weddings          enable row level security;
alter table public.wedding_private   enable row level security;
alter table public.wedding_members   enable row level security;
alter table public.vendors           enable row level security;
alter table public.vendor_contracts  enable row level security;
alter table public.vendor_payments   enable row level security;
alter table public.guests            enable row level security;
alter table public.wedding_tasks     enable row level security;
alter table public.run_of_show_items enable row level security;
alter table public.honeymoon_items   enable row level security;

-- Nada é público: só usuário logado chega nas tabelas, e a RLS filtra o resto.
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- casamento
create policy weddings_select_members on public.weddings for select to authenticated
  using (owner_id = (select auth.uid()) or private.is_wedding_member(id));
create policy weddings_insert_own on public.weddings for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy weddings_update_couple on public.weddings for update to authenticated
  using (private.can_edit_wedding(id)) with check (private.can_edit_wedding(id));
create policy weddings_delete_owner on public.weddings for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy wedding_private_select on public.wedding_private for select to authenticated
  using (private.can_see_finance(wedding_id));
create policy wedding_private_insert on public.wedding_private for insert to authenticated
  with check (private.can_edit_wedding(wedding_id));
create policy wedding_private_update on public.wedding_private for update to authenticated
  using (private.can_edit_wedding(wedding_id)) with check (private.can_edit_wedding(wedding_id));

-- membros: só o dono convida, troca papel ou remove. Ninguém mexe na própria
-- linha (senão daria para se promover a dono); aceitar convite é via função.
create policy wedding_members_select on public.wedding_members for select to authenticated
  using (user_id = (select auth.uid()) or private.is_wedding_member(wedding_id));
create policy wedding_members_insert_owner on public.wedding_members for insert to authenticated
  with check (private.is_wedding_owner(wedding_id) and role <> 'owner');
create policy wedding_members_update_owner on public.wedding_members for update to authenticated
  using (private.is_wedding_owner(wedding_id) and role <> 'owner')
  with check (private.is_wedding_owner(wedding_id) and role <> 'owner');
create policy wedding_members_delete on public.wedding_members for delete to authenticated
  using (role <> 'owner'
         and (private.is_wedding_owner(wedding_id) or user_id = (select auth.uid())));

-- fornecedores (ficha): cerimonialista vê e edita; excluir só o casal, porque
-- apagar o fornecedor leva junto contrato e parcelas que ela nem enxerga.
create policy vendors_select_members on public.vendors for select to authenticated
  using (private.is_wedding_member(wedding_id));
create policy vendors_insert_planners on public.vendors for insert to authenticated
  with check (private.can_plan_wedding(wedding_id));
create policy vendors_update_planners on public.vendors for update to authenticated
  using (private.can_plan_wedding(wedding_id)) with check (private.can_plan_wedding(wedding_id));
create policy vendors_delete_couple on public.vendors for delete to authenticated
  using (private.can_edit_wedding(wedding_id));

-- contrato e parcelas: a permissão vem do fornecedor pai.
create policy vendor_contracts_select on public.vendor_contracts for select to authenticated
  using (exists (select 1 from public.vendors v
                 where v.id = vendor_contracts.vendor_id and private.can_see_finance(v.wedding_id)));
create policy vendor_contracts_insert on public.vendor_contracts for insert to authenticated
  with check (exists (select 1 from public.vendors v
                      where v.id = vendor_contracts.vendor_id and private.can_edit_wedding(v.wedding_id)));
create policy vendor_contracts_update on public.vendor_contracts for update to authenticated
  using (exists (select 1 from public.vendors v
                 where v.id = vendor_contracts.vendor_id and private.can_edit_wedding(v.wedding_id)))
  with check (exists (select 1 from public.vendors v
                      where v.id = vendor_contracts.vendor_id and private.can_edit_wedding(v.wedding_id)));
create policy vendor_contracts_delete on public.vendor_contracts for delete to authenticated
  using (exists (select 1 from public.vendors v
                 where v.id = vendor_contracts.vendor_id and private.can_edit_wedding(v.wedding_id)));

create policy vendor_payments_select on public.vendor_payments for select to authenticated
  using (exists (select 1 from public.vendors v
                 where v.id = vendor_payments.vendor_id and private.can_see_finance(v.wedding_id)));
create policy vendor_payments_insert on public.vendor_payments for insert to authenticated
  with check (exists (select 1 from public.vendors v
                      where v.id = vendor_payments.vendor_id and private.can_edit_wedding(v.wedding_id)));
create policy vendor_payments_update on public.vendor_payments for update to authenticated
  using (exists (select 1 from public.vendors v
                 where v.id = vendor_payments.vendor_id and private.can_edit_wedding(v.wedding_id)))
  with check (exists (select 1 from public.vendors v
                      where v.id = vendor_payments.vendor_id and private.can_edit_wedding(v.wedding_id)));
create policy vendor_payments_delete on public.vendor_payments for delete to authenticated
  using (exists (select 1 from public.vendors v
                 where v.id = vendor_payments.vendor_id and private.can_edit_wedding(v.wedding_id)));

-- convidados, checklist e roteiro: casal + cerimonialista.
create policy guests_select_members on public.guests for select to authenticated
  using (private.is_wedding_member(wedding_id));
create policy guests_insert_planners on public.guests for insert to authenticated
  with check (private.can_plan_wedding(wedding_id));
create policy guests_update_planners on public.guests for update to authenticated
  using (private.can_plan_wedding(wedding_id)) with check (private.can_plan_wedding(wedding_id));
create policy guests_delete_planners on public.guests for delete to authenticated
  using (private.can_plan_wedding(wedding_id));

create policy wedding_tasks_select_members on public.wedding_tasks for select to authenticated
  using (private.is_wedding_member(wedding_id));
create policy wedding_tasks_insert_planners on public.wedding_tasks for insert to authenticated
  with check (private.can_plan_wedding(wedding_id));
create policy wedding_tasks_update_planners on public.wedding_tasks for update to authenticated
  using (private.can_plan_wedding(wedding_id)) with check (private.can_plan_wedding(wedding_id));
create policy wedding_tasks_delete_planners on public.wedding_tasks for delete to authenticated
  using (private.can_plan_wedding(wedding_id));

create policy run_of_show_select_members on public.run_of_show_items for select to authenticated
  using (private.is_wedding_member(wedding_id));
create policy run_of_show_insert_planners on public.run_of_show_items for insert to authenticated
  with check (private.can_plan_wedding(wedding_id));
create policy run_of_show_update_planners on public.run_of_show_items for update to authenticated
  using (private.can_plan_wedding(wedding_id)) with check (private.can_plan_wedding(wedding_id));
create policy run_of_show_delete_planners on public.run_of_show_items for delete to authenticated
  using (private.can_plan_wedding(wedding_id));

-- lua de mel: só o casal.
create policy honeymoon_items_select on public.honeymoon_items for select to authenticated
  using (private.can_see_finance(wedding_id));
create policy honeymoon_items_insert on public.honeymoon_items for insert to authenticated
  with check (private.can_edit_wedding(wedding_id));
create policy honeymoon_items_update on public.honeymoon_items for update to authenticated
  using (private.can_edit_wedding(wedding_id)) with check (private.can_edit_wedding(wedding_id));
create policy honeymoon_items_delete on public.honeymoon_items for delete to authenticated
  using (private.can_edit_wedding(wedding_id));

-- --------------------------------------------------------------- realtime ---
-- Para todo mundo ver a mesma coisa na hora. O Realtime respeita a RLS:
-- a cerimonialista não recebe eventos das tabelas de valores.

alter publication supabase_realtime add table
  public.weddings, public.wedding_private, public.wedding_members,
  public.vendors, public.vendor_contracts, public.vendor_payments,
  public.guests, public.wedding_tasks, public.run_of_show_items,
  public.honeymoon_items;
