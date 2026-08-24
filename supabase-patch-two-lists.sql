-- ============================================================================
-- WBPLL patch - two lists instead of one
--
-- Run this ONCE in the SQL editor.
--
-- THIS DELETES NOTHING. It adds a column, backfills it, and rewrites three
-- functions. Every level you already have becomes part of the 'impossible'
-- list, exactly where it already sits. Records, accounts and both queues are
-- untouched.
--
-- What changes: a level now belongs to one of two lists, and rank 1 means the
-- top OF ITS OWN LIST. Both lists have their own #1. Every renumbering the
-- functions do is now scoped to one list, so shifting the possible list can
-- never disturb the impossible one.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Which list a level is on
--
-- Defaulting to 'impossible' means every row you already have is already
-- correct, and nothing needs backfilling by hand.
-- ----------------------------------------------------------------------------
alter table public.levels
    add column if not exists list text not null default 'impossible';

do $do$
begin
    alter table public.levels
        add constraint levels_list_check check (list in ('impossible', 'possible'));
exception when duplicate_object then
    null;   -- already added by an earlier run
end
$do$;

-- Rank is per list now, so the index that speeds up ordering should be too.
drop index if exists levels_position_idx;
create index if not exists levels_list_position_idx on public.levels (list, position);


-- ----------------------------------------------------------------------------
-- 2. Which list a submitter asked for
--
-- Nullable on purpose: submissions filed before this patch did not choose one,
-- and approve_level falls back to 'impossible' for those.
-- ----------------------------------------------------------------------------
alter table public.level_submissions
    add column if not exists list text;

do $do$
begin
    alter table public.level_submissions
        add constraint level_subs_list_check check (list is null or list in ('impossible', 'possible'));
exception when duplicate_object then
    null;
end
$do$;


-- ----------------------------------------------------------------------------
-- 3. Approving, now that "rank 3" means "rank 3 of a particular list"
--
-- The old signature is dropped rather than replaced, because the new one takes
-- an extra argument and leaving both would make the call ambiguous.
--
-- p_list lets you overrule the submitter: if someone files an easy level under
-- impossible, you can place it on the possible list without sending it back.
-- Left null, their choice stands.
-- ----------------------------------------------------------------------------
drop function if exists public.approve_level(bigint, integer, numeric, text, text, text);

create or replace function public.approve_level(
    p_submission bigint,
    p_position   integer,
    p_points     numeric default 250,
    p_verifier   text    default null,
    p_version    text    default null,
    p_added      text    default null,
    p_list       text    default null
) returns bigint
language plpgsql security definer set search_path = public
as $$
declare
    s       public.level_submissions;
    v_list  text;
    v_count integer;
    v_pos   integer;
    v_new   bigint;
begin
    if not public.is_admin() then
        raise exception 'Only an admin or the owner can approve levels.';
    end if;

    select * into s from public.level_submissions where id = p_submission for update;
    if not found then
        raise exception 'That submission no longer exists.';
    end if;
    if s.status <> 'pending' then
        raise exception 'That submission was already reviewed by %.', coalesce(s.reviewer_name, 'someone');
    end if;

    -- Your choice, else theirs, else the original list.
    v_list := coalesce(nullif(trim(p_list), ''), s.list, 'impossible');
    if v_list not in ('impossible', 'possible') then
        raise exception 'A level goes on the impossible list or the possible one.';
    end if;

    select count(*) into v_count from public.levels where list = v_list;
    v_pos := greatest(1, least(coalesce(p_position, v_count + 1), v_count + 1));

    -- Scoped to the one list, so the other keeps its numbering.
    update public.levels set position = position + 1
     where list = v_list and position >= v_pos;

    insert into public.levels (list, position, name, publisher, level_id, points, verifier, version, added, image)
    values (
        v_list, v_pos, s.name, s.publisher, s.level_id,
        coalesce(p_points, 250),
        coalesce(nullif(trim(p_verifier), ''), '...its impossible.'),
        coalesce(nullif(trim(p_version), ''), '2.2'),
        coalesce(nullif(trim(p_added), ''), to_char(now(), 'FMDD FMMonth YYYY')),
        s.showcase
    )
    returning id into v_new;

    update public.level_submissions
       set status = 'approved', reviewed_by = auth.uid(),
           reviewer_name = public.my_name(), reviewed_at = now()
     where id = p_submission;

    return v_new;
end;
$$;


-- ----------------------------------------------------------------------------
-- 4. Moving, within one list
--
-- Same signature as before - a level already knows which list it is on, so
-- there is nothing extra to pass in.
-- ----------------------------------------------------------------------------
create or replace function public.move_level(p_level bigint, p_position integer)
returns void
language plpgsql security definer set search_path = public
as $$
declare
    v_list  text;
    v_old   integer;
    v_count integer;
    v_new   integer;
begin
    if not public.is_admin() then
        raise exception 'Only an admin or the owner can reorder the list.';
    end if;

    select list, position into v_list, v_old from public.levels where id = p_level;
    if not found then
        raise exception 'That level is not on either list.';
    end if;

    select count(*) into v_count from public.levels where list = v_list;
    v_new := greatest(1, least(p_position, v_count));
    if v_new = v_old then
        return;
    end if;

    update public.levels set position = -1 where id = p_level;

    if v_new < v_old then
        update public.levels set position = position + 1
         where list = v_list and position >= v_new and position < v_old;
    else
        update public.levels set position = position - 1
         where list = v_list and position > v_old and position <= v_new;
    end if;

    update public.levels set position = v_new where id = p_level;
end;
$$;


-- ----------------------------------------------------------------------------
-- 5. Removing, closing the gap in that list only
-- ----------------------------------------------------------------------------
create or replace function public.delete_level(p_level bigint)
returns void
language plpgsql security definer set search_path = public
as $$
declare
    v_list text;
    v_pos  integer;
begin
    if not public.is_owner() then
        raise exception 'Only the owner can remove a level.';
    end if;

    select list, position into v_list, v_pos from public.levels where id = p_level;
    if not found then
        raise exception 'That level is not on either list.';
    end if;

    delete from public.levels where id = p_level;
    update public.levels set position = position - 1
     where list = v_list and position > v_pos;
end;
$$;

grant execute on function
    public.approve_level(bigint, integer, numeric, text, text, text, text),
    public.move_level(bigint, integer),
    public.delete_level(bigint)
to authenticated;


-- ----------------------------------------------------------------------------
-- 6. Check it took
--
-- Both lists should read 1, 2, 3... with no gaps and no repeats. The possible
-- list will be empty until you approve something onto it.
-- ----------------------------------------------------------------------------
select list, count(*) as levels, min(position) as first, max(position) as last
  from public.levels
 group by list
 order by list;
