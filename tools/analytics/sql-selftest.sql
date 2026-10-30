-- Self-test for supabase.sql. Run ONLY against a throwaway Postgres (never your
-- real project): it inserts fake rows and then deletes ALL events.
--   createdb netio_test && psql netio_test -c "create role anon nologin; create role authenticated nologin;"
--   psql -v ON_ERROR_STOP=1 netio_test -f tools/analytics/supabase.sql
--   psql -v ON_ERROR_STOP=1 netio_test -f tools/analytics/sql-selftest.sql
update public.private_cfg set v = 'selftest-secret-0123456789' where k = 'admin_secret';
delete from public.events;

set role anon;
-- good rows (as the extension would send them)
insert into public.events (install_id, event, props, ext_version, lang, chrome_major, platform) values
 ('11111111-1111-4111-8111-111111111111','install','{}','1.5.0','es',141,'win'),
 ('11111111-1111-4111-8111-111111111111','active_day','{"days_since_install":0,"trial_state":"trial","pro":true}','1.5.0','es',141,'win'),
 ('11111111-1111-4111-8111-111111111111','card_seen','{"page":"product"}','1.5.0','es',141,'win'),
 ('11111111-1111-4111-8111-111111111111','first_cost_entered','{}','1.5.0','es',141,'win'),
 ('11111111-1111-4111-8111-111111111111','paywall_seen','{"reason":"teaser","key":"target"}','1.5.0','es',141,'win'),
 ('11111111-1111-4111-8111-111111111111','checkout_click','{"plan":"pro-monthly","from":"upsell"}','1.5.0','es',141,'win'),
 ('11111111-1111-4111-8111-111111111111','checkout_failed','{"from":"upsell"}','1.5.0','es',141,'win'),
 ('11111111-1111-4111-8111-111111111111','daily_summary','{"cards":5,"products":3,"searches":1,"cost_entries":2,"calcs":9,"anchors_missing":1}','1.5.0','es',141,'win'),
 ('22222222-2222-4222-8222-222222222222','install','{}','1.5.0','en',139,'cros'),
 ('22222222-2222-4222-8222-222222222222','active_day','{"days_since_install":0,"trial_state":"trial","pro":true}','1.5.0','en',139,'cros'),
 ('22222222-2222-4222-8222-222222222222','error','{"code":"no_anchor"}','1.5.0','en',139,'cros'),
 ('33333333-3333-4333-8333-333333333333','install','{}','1.5.0','es',141,'mac'),
 ('33333333-3333-4333-8333-333333333333','active_day','{"days_since_install":9,"trial_state":"expired","pro":false}','1.5.0','es',141,'mac'),
 ('33333333-3333-4333-8333-333333333333','trial_expired_seen','{}','1.5.0','es',141,'mac'),
 (null,'uninstall_reason','{"reason":"no_card","note":"no vi nada","days_used":2,"cost_entered":0,"saw_paywall":0}','1.5.0','es',null,'other'),
 (null,'uninstall_reason','{"reason":"price","days_used":8}','1.5.0','es',null,'other'),
 (null,'uninstall_reason','{"reason":"other","note":"version 1.5.0 y 12345 piezas"}','1.5.0','es',null,'other');
reset role;

-- bad rows must ALL be rejected
create temp table bad(sql text);
insert into bad values
 ($$insert into public.events(install_id,event,props,ext_version,lang,platform) values ('11111111-1111-4111-8111-111111111111','page_view','{}','1.5.0','es','win')$$),
 ($$insert into public.events(install_id,event,props,ext_version,lang,platform) values ('11111111-1111-4111-8111-111111111111','card_seen','{"page":"https://www.mercadolibre.com.mx/x"}','1.5.0','es','win')$$),
 ($$insert into public.events(install_id,event,props,ext_version,lang,platform) values ('11111111-1111-4111-8111-111111111111','card_seen','{"page":"product","price":"$827.00"}','1.5.0','es','win')$$),
 ($$insert into public.events(install_id,event,props,ext_version,lang,platform) values ('11111111-1111-4111-8111-111111111111','error','{"code":"a@b.com"}','1.5.0','es','win')$$),
 ($$insert into public.events(install_id,event,props,ext_version,lang,platform) values (null,'card_seen','{}','1.5.0','es','win')$$),
 ($$insert into public.events(install_id,event,props,ext_version,lang,platform) values (null,'uninstall_reason','{"note":"visit https://x.com"}','1.5.0','es','other')$$),
 ($$insert into public.events(install_id,event,props,ext_version,lang,platform) values (null,'uninstall_reason','{"note":"escribeme a juan@gmail.com"}','1.5.0','es','other')$$),
 ($$insert into public.events(install_id,event,props,ext_version,lang,platform) values (null,'uninstall_reason',jsonb_build_object('note', repeat('a',141)),'1.5.0','es','other')$$),
 ($$insert into public.events(install_id,event,props,ext_version,lang,platform) values ('11111111-1111-4111-8111-111111111111','install','{}','1.5','es','win')$$),
 ($$insert into public.events(install_id,event,props,ext_version,lang,platform) values ('11111111-1111-4111-8111-111111111111','install','{}','1.5.0','español','win')$$),
 ($$insert into public.events(install_id,event,props,ext_version,lang,platform) values ('11111111-1111-4111-8111-111111111111','install','{}','1.5.0','es','amiga')$$),
 ($$insert into public.events(install_id,event,props,ext_version,lang,chrome_major,platform) values ('11111111-1111-4111-8111-111111111111','install','{}','1.5.0','es',0,'win')$$),
 ($$insert into public.events(install_id,event,props,ext_version,lang,platform) values ('11111111-1111-4111-8111-111111111111','install','[]','1.5.0','es','win')$$),
 ($$insert into public.events(ts,install_id,event,ext_version,lang,platform) values ('2001-01-01','11111111-1111-4111-8111-111111111111','install','1.5.0','es','win')$$),
 ($$insert into public.events(install_id,event,props,ext_version,lang,platform) values (null,'uninstall_reason','{"note":"llamame 555 123 4567"}','1.5.0','es','other')$$),
 ($$insert into public.events(install_id,event,props,ext_version,lang,platform) values (null,'uninstall_reason','{"note":"5551234567"}','1.5.0','es','other')$$),
 ($$insert into public.events(install_id,event,props,ext_version,lang,platform) values (null,'uninstall_reason','{"note":"tel 570-656-198"}','1.5.0','es','other')$$),
 ($$select * from public.events$$),
 ($$delete from public.events$$),
 ($$update public.events set event='install'$$),
 ($$select * from public.private_cfg$$);

do $$
declare r record; failed int := 0; ok int := 0;
begin
  for r in select sql from bad loop
    begin
      set local role anon;
      execute r.sql;
      reset role;
      raise notice 'NOT REJECTED: %', r.sql;
      failed := failed + 1;
    exception when others then
      reset role;
      ok := ok + 1;
    end;
  end loop;
  raise notice 'rejected % of % bad statements', ok, ok + failed;
  if failed > 0 then raise exception 'some bad statements were accepted'; end if;
end $$;

-- the report: wrong secret refused, right secret returns the numbers
set role anon;
do $$ begin
  begin perform public.netio_report('wrong'); raise exception 'wrong secret accepted';
  exception when insufficient_privilege then raise notice 'wrong secret refused'; end;
end $$;
select jsonb_pretty(public.netio_report('selftest-secret-0123456789', '30 days'));
reset role;
select public.netio_cleanup();
delete from public.events;
