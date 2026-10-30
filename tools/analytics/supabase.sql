-- Netio anonymous analytics: Supabase schema, security and report function.
-- Run the WHOLE file once in the Supabase SQL editor (safe to re-run).
-- Then set your admin secret (README step 3).
--
-- Security model:
--   * The extension and the uninstall page hold the ANON key. It can INSERT
--     rows into public.events and nothing else: no select, update or delete.
--   * Reading goes only through public.netio_report(secret), which returns
--     aggregates (no raw rows) and refuses unless the secret matches.
--   * CHECK constraints reject anything outside the event allowlist, so a
--     tampered client cannot store URLs, emails or free text (except the
--     140-character uninstall note, which is also screened).

-- ---------------------------------------------------------------- helpers ---
create or replace function public.netio_int(t text)
returns int language sql immutable as
$$ select case when t ~ '^[0-9]{1,6}$' then t::int end $$;

-- Every prop is a short enum-like token or a number/boolean. Only the
-- uninstall note may be free text (<= 140 chars, no URL or email).
create or replace function public.netio_props_ok(ev text, p jsonb)
returns boolean language plpgsql immutable as
$$
declare
  kv record;
  s text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(p)) > 8 then return false; end if;
  for kv in select key, value from jsonb_each(p) loop
    if length(kv.key) > 24 or kv.key !~ '^[a-z0-9_]+$' then return false; end if;
    if jsonb_typeof(kv.value) = 'string' then
      s := kv.value #>> '{}';
      if ev = 'uninstall_reason' and kv.key = 'note' then
        if length(s) > 140 or s ~* '(https?:|www\.|@|[a-z0-9-]+\.(com|mx|net|org|io|app|co)\M)' then
          return false;
        end if;
      elsif s !~ '^[a-z0-9._:+-]{1,24}$' then
        return false;
      end if;
    elsif jsonb_typeof(kv.value) not in ('number', 'boolean') then
      return false;
    end if;
  end loop;
  return true;
end
$$;

-- ----------------------------------------------------------------- events ---
create table if not exists public.events (
  id          bigint generated always as identity primary key,
  ts          timestamptz not null default now(),
  install_id  uuid,
  event       text not null,
  props       jsonb not null default '{}'::jsonb,
  ext_version text not null,
  lang        text not null,
  chrome_major int,
  platform    text not null,
  constraint ev_event_allowlist check (event in (
    'install','update','active_day','card_seen','first_cost_entered',
    'first_target_price_used','first_sweetspot_seen','radar_preview_seen',
    'paywall_seen','checkout_click','checkout_failed','login_click',
    'paid_detected','trial_expired_seen','share_click','review_ask',
    'welcome_seen','dashboard_open','csv_export','options_open',
    'reset_clicked','error','daily_summary','uninstall_reason')),
  constraint ev_install_id check (install_id is not null or event = 'uninstall_reason'),
  constraint ev_version check (ext_version ~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'),
  constraint ev_lang check (lang ~ '^[a-z]{2,3}$'),
  constraint ev_chrome check (chrome_major is null or chrome_major between 1 and 999),
  constraint ev_platform check (platform in ('cros','win','mac','linux','android','other')),
  constraint ev_props_size check (pg_column_size(props) < 1000),
  constraint ev_props_shape check (public.netio_props_ok(event, props))
);
create index if not exists events_ts_idx on public.events (ts);
create index if not exists events_install_idx on public.events (install_id, event);

alter table public.events enable row level security;
revoke all on public.events from anon, authenticated;
-- Column-level grant: the client cannot choose id or ts.
grant insert (install_id, event, props, ext_version, lang, chrome_major, platform)
  on public.events to anon;
drop policy if exists events_anon_insert on public.events;
create policy events_anon_insert on public.events
  for insert to anon with check (true);

-- ----------------------------------------------------------- private config ---
create table if not exists public.private_cfg (
  k text primary key,
  v text not null
);
alter table public.private_cfg enable row level security;   -- no policies: unreadable via the API
revoke all on public.private_cfg from anon, authenticated;
insert into public.private_cfg (k, v)
  values ('admin_secret', 'CHANGE_ME_TO_A_LONG_RANDOM_SECRET')
  on conflict (k) do nothing;

-- ----------------------------------------------------------------- report ---
-- One jsonb with everything the dashboard shows. "n" = distinct installs unless
-- noted. Retention is "active on or after day N" among NEW installs old enough.
create or replace function public.netio_report(secret text, since interval default '90 days')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  expected text;
  result jsonb;
begin
  select v into expected from public.private_cfg where k = 'admin_secret';
  if expected is null or expected = 'CHANGE_ME_TO_A_LONG_RANDOM_SECRET' or length(expected) < 16 then
    raise exception 'admin secret is not set (see README step 3)' using errcode = '42501';
  end if;
  if secret is null or secret is distinct from expected then
    perform pg_sleep(1);  -- slows guessing
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if since is null or since < interval '1 day' or since > interval '800 days' then
    since := interval '90 days';
  end if;

  with ev as (
    select * from public.events where ts >= now() - since
  ),
  per as (
    select install_id,
           min(ts) as first_ts,
           bool_or(event = 'install') as is_new,
           bool_or(event = 'active_day') as active,
           bool_or(event = 'card_seen') as card,
           bool_or(event = 'first_cost_entered') as cost,
           bool_or(event = 'first_target_price_used') as target,
           bool_or(event = 'paywall_seen') as paywall,
           bool_or(event = 'checkout_click') as checkout,
           bool_or(event = 'checkout_failed') as cfail,
           bool_or(event = 'paid_detected') as paid,
           bool_or(event = 'trial_expired_seen') as expired
    from ev
    where install_id is not null
    group by install_id
  ),
  latest as (
    select distinct on (install_id) install_id, ext_version, lang, platform, chrome_major
    from ev where install_id is not null
    order by install_id, ts desc
  ),
  latest_trial as (
    select distinct on (install_id) install_id, props->>'trial_state' as state
    from ev where event = 'active_day' and install_id is not null
    order by install_id, ts desc
  ),
  by_inst as (
    select event, props, install_id from ev where install_id is not null
  )
  select jsonb_build_object(
    'generated_at', now(),
    'since_days', extract(day from since)::int,

    'installs_per_day', (
      select coalesce(jsonb_agg(jsonb_build_object('d', d, 'n', n) order by d), '[]'::jsonb)
      from (select ts::date as d, count(distinct install_id) as n
            from ev where event = 'install' group by 1) x),

    'funnel', (
      select jsonb_build_object(
        'installed', count(*),
        'active', count(*) filter (where active),
        'card_seen', count(*) filter (where card),
        'cost_entered', count(*) filter (where cost),
        'target_price_used', count(*) filter (where target),
        'paywall_seen', count(*) filter (where paywall),
        'checkout_click', count(*) filter (where checkout),
        'paid_detected', count(*) filter (where paid)) from per),

    'funnel_new', (
      select jsonb_build_object(
        'installed', count(*),
        'active', count(*) filter (where active),
        'card_seen', count(*) filter (where card),
        'cost_entered', count(*) filter (where cost),
        'target_price_used', count(*) filter (where target),
        'paywall_seen', count(*) filter (where paywall),
        'checkout_click', count(*) filter (where checkout),
        'paid_detected', count(*) filter (where paid)) from per where is_new),

    'paywall_by_reason', (
      select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n, 'events', e) order by n desc, k), '[]'::jsonb)
      from (select props->>'reason' as k, count(distinct install_id) as n, count(*) as e
            from by_inst where event = 'paywall_seen' group by 1) x),
    'paywall_by_key', (
      select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n, 'events', e) order by n desc, k), '[]'::jsonb)
      from (select props->>'key' as k, count(distinct install_id) as n, count(*) as e
            from by_inst where event = 'paywall_seen' group by 1) x),
    'checkout_by_plan', (
      select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n, 'events', e) order by n desc, k), '[]'::jsonb)
      from (select props->>'plan' as k, count(distinct install_id) as n, count(*) as e
            from by_inst where event = 'checkout_click' group by 1) x),
    'checkout_by_from', (
      select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n, 'events', e) order by n desc, k), '[]'::jsonb)
      from (select props->>'from' as k, count(distinct install_id) as n, count(*) as e
            from by_inst where event = 'checkout_click' group by 1) x),

    'retention', (
      select jsonb_object_agg('d' || n, jsonb_build_object('eligible', r.eligible, 'retained', r.retained))
      from unnest(array[0, 1, 3, 7, 14, 30]) as n
      cross join lateral (
        select count(*) filter (where now() - p.first_ts >= make_interval(days => n)) as eligible,
               count(*) filter (
                 where now() - p.first_ts >= make_interval(days => n)
                   and exists (
                     select 1 from ev a
                     where a.install_id = p.install_id and a.event = 'active_day'
                       and coalesce(public.netio_int(a.props->>'days_since_install'), -1) >= n)
               ) as retained
        from per p where p.is_new) r),

    'trial_state', (
      select coalesce(jsonb_agg(jsonb_build_object('k', state, 'n', n) order by n desc, state), '[]'::jsonb)
      from (select state, count(*) as n from latest_trial group by 1) x),
    'platform', (
      select coalesce(jsonb_agg(jsonb_build_object('k', platform, 'n', n) order by n desc, platform), '[]'::jsonb)
      from (select platform, count(*) as n from latest group by 1) x),
    'lang', (
      select coalesce(jsonb_agg(jsonb_build_object('k', lang, 'n', n) order by n desc, lang), '[]'::jsonb)
      from (select lang, count(*) as n from latest group by 1) x),
    'ext_version', (
      select coalesce(jsonb_agg(jsonb_build_object('k', ext_version, 'n', n) order by n desc, ext_version), '[]'::jsonb)
      from (select ext_version, count(*) as n from latest group by 1) x),
    'chrome_major', (
      select coalesce(jsonb_agg(jsonb_build_object('k', chrome_major::text, 'n', n) order by n desc, chrome_major), '[]'::jsonb)
      from (select chrome_major, count(*) as n from latest where chrome_major is not null group by 1) x),

    'errors', (
      select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n, 'installs', i) order by n desc, k), '[]'::jsonb)
      from (select props->>'code' as k, count(*) as n, count(distinct install_id) as i
            from by_inst where event = 'error' group by 1) x),

    'diag', jsonb_build_object(
      'expired', (select count(*) from per where expired),
      'expired_no_cost', (select count(*) from per where expired and not cost),
      'cost_no_paywall', (select count(*) from per where cost and not paywall),
      'card_no_cost', (select count(*) from per where card and not cost),
      'paywall_no_checkout', (select count(*) from per where paywall and not checkout),
      'checkout_no_paid', (select count(*) from per where checkout and not paid),
      'checkout_failed_installs', (select count(*) from per where cfail),
      'checkout_failed_events', (select count(*) from ev where event = 'checkout_failed')),

    'summary', (
      select jsonb_build_object(
        'cards', coalesce(sum(public.netio_int(props->>'cards')), 0),
        'products', coalesce(sum(public.netio_int(props->>'products')), 0),
        'searches', coalesce(sum(public.netio_int(props->>'searches')), 0),
        'cost_entries', coalesce(sum(public.netio_int(props->>'cost_entries')), 0),
        'calcs', coalesce(sum(public.netio_int(props->>'calcs')), 0),
        'anchors_missing', coalesce(sum(public.netio_int(props->>'anchors_missing')), 0),
        'days', count(*))
      from ev where event = 'daily_summary'),

    'uninstall', jsonb_build_object(
      'n', (select count(*) from ev where event = 'uninstall_reason'),
      'median_days', (
        select percentile_cont(0.5) within group (order by public.netio_int(props->>'days_used'))
        from ev where event = 'uninstall_reason' and public.netio_int(props->>'days_used') is not null),
      'reasons', (
        select coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) order by n desc, k), '[]'::jsonb)
        from (select props->>'reason' as k, count(*) as n
              from ev where event = 'uninstall_reason' group by 1) x)),

    'shares', jsonb_build_object(
      'share_click', (select count(*) from ev where event = 'share_click'),
      'review_shown', (select count(*) from ev where event = 'review_ask' and props->>'state' = 'shown'),
      'review_clicked', (select count(*) from ev where event = 'review_ask' and props->>'state' = 'clicked'),
      'review_dismissed', (select count(*) from ev where event = 'review_ask' and props->>'state' = 'dismissed'))
  ) into result;

  return result;
end
$$;

revoke all on function public.netio_report(text, interval) from public;
grant execute on function public.netio_report(text, interval) to anon;

-- --------------------------------------------------------------- cleanup ---
-- Delete rows older than 400 days. Run by hand now and then, or schedule it
-- with pg_cron (commented example below). Not callable through the API.
create or replace function public.netio_cleanup()
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n bigint;
begin
  delete from public.events where ts < now() - interval '400 days';
  get diagnostics n = row_count;
  return n;
end
$$;
revoke all on function public.netio_cleanup() from public, anon, authenticated;
-- select cron.schedule('netio-cleanup', '17 3 * * 0', $$select public.netio_cleanup()$$);
