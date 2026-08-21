-- ============================================================================
-- WBPILL patch - only the owner may remove records and levels
--
-- Run this ONCE in the SQL editor, the same way as the setup file.
--
-- THIS DELETES NOTHING. It only swaps two rules. Your account, the list, the
-- records and the queues are all left alone - which is why this is a small
-- patch instead of re-running supabase-setup.sql, which wipes and rebuilds.
--
-- (supabase-setup.sql has the same change baked in, so a rebuild from scratch
-- later will match. You do not need to run both.)
--
-- After this:
--   moderator  accept and deny records                    (cannot remove)
--   admin      the above, plus approve, place and reorder (cannot remove)
--   owner      everything, and the only one who can remove
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Records: moderators put them up, only the owner takes them down
--
-- records_write covered insert, update and delete in one rule. Splitting it
-- lets moderators keep doing their job while deletion moves to you.
-- ----------------------------------------------------------------------------
drop policy if exists records_write on public.records;

drop policy if exists records_insert on public.records;
create policy records_insert on public.records
    for insert with check (public.is_mod());

drop policy if exists records_update on public.records;
create policy records_update on public.records
    for update using (public.is_mod()) with check (public.is_mod());

drop policy if exists records_delete on public.records;
create policy records_delete on public.records
    for delete using (public.is_owner());


-- ----------------------------------------------------------------------------
-- 2. Levels: admins place and reorder, only the owner removes
--
-- Replacing the function in place. Nothing on the list is touched.
-- ----------------------------------------------------------------------------
create or replace function public.delete_level(p_level bigint)
returns void
language plpgsql security definer set search_path = public
as $$
declare
    v_pos integer;
begin
    -- Owner only. Removing a level destroys its records too, so that stays
    -- with you rather than with the admins who place and reorder.
    if not public.is_owner() then
        raise exception 'Only the owner can remove a level.';
    end if;

    select position into v_pos from public.levels where id = p_level;
    if not found then
        raise exception 'That level is not on the list.';
    end if;

    delete from public.levels where id = p_level;
    update public.levels set position = position - 1 where position > v_pos;
end;
$$;


-- ----------------------------------------------------------------------------
-- 3. Check it took
--
-- Should list records_delete as {owner} and records_insert/update as {mod}.
-- ----------------------------------------------------------------------------
select polname as rule,
       case polcmd when 'r' then 'select' when 'a' then 'insert'
                   when 'w' then 'update' when 'd' then 'delete'
                   else 'all' end as applies_to
  from pg_policy
 where polrelid = 'public.records'::regclass
 order by 1;
