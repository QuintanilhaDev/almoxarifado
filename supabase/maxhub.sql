-- =====================================================================
--  MAX HUB · login global, setores e permissões
--  Cole TODO este arquivo no SQL Editor do Supabase e clique em "Run".
--  Pode rodar mais de uma vez sem problema (é idempotente).
--  Rode DEPOIS do schema.sql. Não apaga nem altera dados do almoxarifado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) A tabela "admins" passa a ser o cadastro de usuários do Max Hub.
--    (o nome da tabela foi mantido para não mexer no que já funciona)
-- ---------------------------------------------------------------------
alter table public.admins add column if not exists is_master     boolean     not null default false;
alter table public.admins add column if not exists sector        text;
alter table public.admins add column if not exists sector_role   text        not null default 'member';
alter table public.admins add column if not exists permissions   jsonb       not null default '{}'::jsonb;
alter table public.admins add column if not exists active        boolean     not null default true;
alter table public.admins add column if not exists created_by    text;
alter table public.admins add column if not exists last_login_at timestamptz;

comment on column public.admins.is_master   is 'Master geral: administra todos os setores e os usuários';
comment on column public.admins.sector      is 'Setor em que a pessoa está alocada (slug de lib/sectors.ts)';
comment on column public.admins.sector_role is 'master = master do setor · member = membro';
comment on column public.admins.permissions is 'Nível por módulo do setor: none | view | edit';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'admins_sector_role_check') then
    alter table public.admins
      add constraint admins_sector_role_check check (sector_role in ('master', 'member'));
  end if;
end $$;

create index if not exists admins_sector_idx on public.admins (sector);

-- ---------------------------------------------------------------------
-- 2) Marcador de migrações (para os passos abaixo rodarem UMA vez só)
-- ---------------------------------------------------------------------
create table if not exists public.hub_meta (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.hub_meta enable row level security;

-- ---------------------------------------------------------------------
-- 3) Primeira execução: quem já usava o painel do almoxarifado continua
--    com o mesmo acesso de antes (setor Almoxarifado, tudo liberado).
--    Depois o master ajusta setor e permissões pela tela.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public.hub_meta where key = 'maxhub_v1') then
    update public.admins
       set sector      = 'almoxarifado',
           sector_role = 'member',
           permissions = jsonb_build_object(
             'solicitacoes', 'edit',
             'estoque',      'edit',
             'postos',       'edit',
             'metricas',     'edit',
             'formulario',   'edit',
             'emails',       'edit')
     where is_master = false
       and sector is null;

    insert into public.hub_meta (key, value) values ('maxhub_v1', jsonb_build_object('at', now()));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4) Master geral: o usuário @mateus. (Se ele não existir, nada acontece.)
--    Master geral não fica preso a um setor.
-- ---------------------------------------------------------------------
update public.admins
   set is_master = true, sector = null, sector_role = 'member', permissions = '{}'::jsonb, active = true
 where username = 'mateus'
   and (is_master = false or sector is not null or active = false);

update public.admins
   set sector = null, sector_role = 'member', permissions = '{}'::jsonb
 where is_master = true
   and sector is not null;

-- ---------------------------------------------------------------------
-- 5) Segurança: só o servidor (service_role) usa as tabelas
-- ---------------------------------------------------------------------
grant all on public.hub_meta to service_role;
grant all on public.admins   to service_role;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Conferência (opcional): rode esta linha para ver como ficou.
--   select username, display_name, is_master, sector, sector_role, active from public.admins order by is_master desc, username;
--
-- Nenhum master geral? Promova alguém (troque o usuário):
--   update public.admins set is_master = true, sector = null where username = 'seu_usuario';
-- ---------------------------------------------------------------------
