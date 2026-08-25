-- ============================================================================
-- Nosso Casório — schema do casamento
--
-- Já aplicado no projeto Supabase "lua de mel" (ccvlaywiyvrixduvbccj) através
-- das migrations wedding_core_schema, wedding_rls_and_triggers,
-- wedding_child_table_policies, wedding_summary_invite_and_realtime,
-- harden_wedding_function_grants e restore_execute_for_rls_helpers.
--
-- Este arquivo é a versão consolidada, para consulta e para recriar o banco
-- do zero se um dia for preciso. Ele assume que as tabelas de viagem
-- (trips, trip_members, ...) e os tipos member_role, invite_status e
-- trip_status já existem, porque o casamento convive com a lua de mel no
-- mesmo banco.
-- ============================================================================

create type public.guest_status as enum ('pending', 'confirmed', 'declined');
create type public.wedding_task_status as enum ('pending', 'in_progress', 'done');
create type public.ros_role as enum ('bride', 'groom', 'both');

-- ---------------------------------------------------------------- tabelas ---

create table public.weddings (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references auth.users (id) on delete cascade,
  partner1_name      text not null,
  partner2_name      text not null,
  wedding_date       date,
  ceremony_time      time,
  venue              text,
  city               text,
  cover_image_url    text,
  base_currency      char(3) not null default 'BRL',
  estimated_budget   numeric(12,2),
  timezone           text not null default 'America/Sao_Paulo',
  status             public.trip_status not null default 'planning',
  honeymoon_trip_id  uuid references public.trips (id) on delete set null,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index weddings_owner_id_idx on public.weddings (owner_id);

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

create table public.vendors (
  id             uuid primary key default gen_random_uuid(),
  wedding_id     uuid not null references public.weddings (id) on delete cascade,
  name           text not null,
  category       text not null default 'other',
  contact_name   text,
  phone          text,
  email          text,
  payment_method text,
  total_amount   numeric(12,2) not null default 0,
  notes          text,
  position       integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index vendors_wedding_id_idx on public.vendors (wedding_id);

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
  id          uuid primary key default gen_random_uuid(),
  wedding_id  uuid not null references public.weddings (id) on delete cascade,
  name        text not null,
  phone       text,
  group_name  text not null default 'Família',
  adults      smallint not null default 1,
  children    smallint not null default 0,
  status      public.guest_status not null default 'pending',
  beverages   jsonb not null default '{}'::jsonb,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
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

-- ------------------------------------------------- funções de permissão -----
-- Mesmo padrão de trip_role/is_trip_member: SECURITY DEFINER para poder ler
-- wedding_members sem cair na RLS da própria tabela.

create or replace function public.wedding_role(p_wedding_id uuid)
returns public.member_role
language sql stable security definer set search_path to 'public'
as $$
  select m.role
  from public.wedding_members m
  where m.wedding_id = p_wedding_id
    and m.user_id = auth.uid()
    and m.invite_status = 'accepted'
  order by case m.role when 'owner' then 0 when 'editor' then 1 else 2 end
  limit 1;
$$;

create or replace function public.is_wedding_member(p_wedding_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $$ select public.wedding_role(p_wedding_id) is not null; $$;

create or replace function public.can_edit_wedding(p_wedding_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $$ select public.wedding_role(p_wedding_id) in ('owner', 'editor'); $$;

create or replace function public.is_wedding_owner(p_wedding_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $$ select public.wedding_role(p_wedding_id) = 'owner'; $$;

-- As policies avaliam estas funções com os privilégios de quem consulta,
-- então authenticated precisa de EXECUTE. anon fica de fora.
revoke all on function public.wedding_role(uuid)      from anon, authenticated, public;
revoke all on function public.is_wedding_member(uuid) from anon, authenticated, public;
revoke all on function public.can_edit_wedding(uuid)  from anon, authenticated, public;
revoke all on function public.is_wedding_owner(uuid)  from anon, authenticated, public;
grant execute on function public.wedding_role(uuid)      to authenticated;
grant execute on function public.is_wedding_member(uuid) to authenticated;
grant execute on function public.can_edit_wedding(uuid)  to authenticated;
grant execute on function public.is_wedding_owner(uuid)  to authenticated;

-- ------------------------------------------------------------- triggers -----

create or replace function public.handle_new_wedding()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  insert into public.wedding_members (wedding_id, user_id, role, invite_status, accepted_at, invited_by)
  values (new.id, new.owner_id, 'owner', 'accepted', now(), new.owner_id)
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_wedding() from anon, authenticated, public;

create trigger weddings_after_insert after insert on public.weddings
  for each row execute function public.handle_new_wedding();

create trigger weddings_set_updated_at before update on public.weddings
  for each row execute function public.set_updated_at();
create trigger wedding_members_set_updated_at before update on public.wedding_members
  for each row execute function public.set_updated_at();
create trigger vendors_set_updated_at before update on public.vendors
  for each row execute function public.set_updated_at();
create trigger vendor_payments_set_updated_at before update on public.vendor_payments
  for each row execute function public.set_updated_at();
create trigger guests_set_updated_at before update on public.guests
  for each row execute function public.set_updated_at();
create trigger wedding_tasks_set_updated_at before update on public.wedding_tasks
  for each row execute function public.set_updated_at();
create trigger run_of_show_items_set_updated_at before update on public.run_of_show_items
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

-- ------------------------------------------------------------- convite ------

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

-- ------------------------------------------------------------------ RLS -----
-- Sem ser membro do casamento, nenhuma linha é visível. Testado: um usuário
-- autenticado qualquer enxerga 0 registros em todas estas tabelas.

alter table public.weddings          enable row level security;
alter table public.wedding_members   enable row level security;
alter table public.vendors           enable row level security;
alter table public.vendor_payments   enable row level security;
alter table public.guests            enable row level security;
alter table public.wedding_tasks     enable row level security;
alter table public.run_of_show_items enable row level security;

create policy weddings_select_members on public.weddings for select to authenticated
  using (owner_id = auth.uid() or public.is_wedding_member(id));
create policy weddings_insert_own on public.weddings for insert to authenticated
  with check (owner_id = auth.uid());
create policy weddings_update_editors on public.weddings for update to authenticated
  using (public.can_edit_wedding(id)) with check (public.can_edit_wedding(id));
create policy weddings_delete_owner on public.weddings for delete to authenticated
  using (owner_id = auth.uid());

create policy wedding_members_select on public.wedding_members for select to authenticated
  using (user_id = auth.uid() or public.is_wedding_member(wedding_id));
create policy wedding_members_insert_owner on public.wedding_members for insert to authenticated
  with check (public.is_wedding_owner(wedding_id));
create policy wedding_members_update on public.wedding_members for update to authenticated
  using (public.is_wedding_owner(wedding_id) or user_id = auth.uid())
  with check (public.is_wedding_owner(wedding_id) or user_id = auth.uid());
create policy wedding_members_delete on public.wedding_members for delete to authenticated
  using ((public.is_wedding_owner(wedding_id) and role <> 'owner')
      or (user_id = auth.uid() and role <> 'owner'));

create policy vendors_select_members on public.vendors for select to authenticated
  using (public.is_wedding_member(wedding_id));
create policy vendors_insert_editors on public.vendors for insert to authenticated
  with check (public.can_edit_wedding(wedding_id));
create policy vendors_update_editors on public.vendors for update to authenticated
  using (public.can_edit_wedding(wedding_id)) with check (public.can_edit_wedding(wedding_id));
create policy vendors_delete_editors on public.vendors for delete to authenticated
  using (public.can_edit_wedding(wedding_id));

-- vendor_payments não guarda wedding_id: a permissão vem do fornecedor pai,
-- igual ao que checklist_items faz com checklists.
create policy vendor_payments_select_members on public.vendor_payments for select to authenticated
  using (exists (select 1 from public.vendors v
                 where v.id = vendor_payments.vendor_id and public.is_wedding_member(v.wedding_id)));
create policy vendor_payments_insert_editors on public.vendor_payments for insert to authenticated
  with check (exists (select 1 from public.vendors v
                      where v.id = vendor_payments.vendor_id and public.can_edit_wedding(v.wedding_id)));
create policy vendor_payments_update_editors on public.vendor_payments for update to authenticated
  using (exists (select 1 from public.vendors v
                 where v.id = vendor_payments.vendor_id and public.can_edit_wedding(v.wedding_id)))
  with check (exists (select 1 from public.vendors v
                      where v.id = vendor_payments.vendor_id and public.can_edit_wedding(v.wedding_id)));
create policy vendor_payments_delete_editors on public.vendor_payments for delete to authenticated
  using (exists (select 1 from public.vendors v
                 where v.id = vendor_payments.vendor_id and public.can_edit_wedding(v.wedding_id)));

create policy guests_select_members on public.guests for select to authenticated
  using (public.is_wedding_member(wedding_id));
create policy guests_insert_editors on public.guests for insert to authenticated
  with check (public.can_edit_wedding(wedding_id));
create policy guests_update_editors on public.guests for update to authenticated
  using (public.can_edit_wedding(wedding_id)) with check (public.can_edit_wedding(wedding_id));
create policy guests_delete_editors on public.guests for delete to authenticated
  using (public.can_edit_wedding(wedding_id));

create policy wedding_tasks_select_members on public.wedding_tasks for select to authenticated
  using (public.is_wedding_member(wedding_id));
create policy wedding_tasks_insert_editors on public.wedding_tasks for insert to authenticated
  with check (public.can_edit_wedding(wedding_id));
create policy wedding_tasks_update_editors on public.wedding_tasks for update to authenticated
  using (public.can_edit_wedding(wedding_id)) with check (public.can_edit_wedding(wedding_id));
create policy wedding_tasks_delete_editors on public.wedding_tasks for delete to authenticated
  using (public.can_edit_wedding(wedding_id));

create policy run_of_show_select_members on public.run_of_show_items for select to authenticated
  using (public.is_wedding_member(wedding_id));
create policy run_of_show_insert_editors on public.run_of_show_items for insert to authenticated
  with check (public.can_edit_wedding(wedding_id));
create policy run_of_show_update_editors on public.run_of_show_items for update to authenticated
  using (public.can_edit_wedding(wedding_id)) with check (public.can_edit_wedding(wedding_id));
create policy run_of_show_delete_editors on public.run_of_show_items for delete to authenticated
  using (public.can_edit_wedding(wedding_id));

-- --------------------------------------------------------------- realtime ---
-- Para os dois celulares verem a mesma coisa na hora.

alter publication supabase_realtime add table public.weddings;
alter publication supabase_realtime add table public.vendors;
alter publication supabase_realtime add table public.vendor_payments;
alter publication supabase_realtime add table public.guests;
alter publication supabase_realtime add table public.wedding_tasks;
alter publication supabase_realtime add table public.run_of_show_items;
