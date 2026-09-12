-- Run this in Supabase: Project -> SQL Editor -> New query

-- Profiles table, extends Supabase's built-in auth.users
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  age_group text not null check (age_group in ('18-24','25-34','35-44','45-54','55+')),
  bio text,
  created_at timestamptz default now()
);

-- Interests, many-to-one with profiles
create table public.interests (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tag text not null,
  category text check (category in ('hobby','ambition','goal')) default 'hobby',
  created_at timestamptz default now()
);
create index on public.interests (tag);
create index on public.interests (profile_id);

-- Linked accounts, for OAuth verification only (never for scraping)
create table public.linked_accounts (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null,
  provider_user_id text not null,
  created_at timestamptz default now(),
  unique (profile_id, provider)
);

-- Cached match scores between two opted-in users
create table public.matches (
  id bigint generated always as identity primary key,
  user_a_id uuid not null references public.profiles(id) on delete cascade,
  user_b_id uuid not null references public.profiles(id) on delete cascade,
  score numeric not null,
  status text check (status in ('suggested','user_liked','mutual','dismissed')) default 'suggested',
  updated_at timestamptz default now(),
  unique (user_a_id, user_b_id)
);

-- In-app messages, only meaningful once a match is mutual
create table public.messages (
  id bigint generated always as identity primary key,
  match_id bigint not null references public.matches(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz default now()
);

-- Pre-signup waitlist (separate from profiles/auth so people can join
-- before they create a full account)
create table public.waitlist_signups (
  id bigint generated always as identity primary key,
  name text not null,
  email text not null unique,
  age_group text not null check (age_group in ('18-24','25-34','35-44','45-54','55+')),
  interests text[] default '{}',
  created_at timestamptz default now()
);

alter table public.waitlist_signups enable row level security;
-- No select/insert policies for the anon/authenticated roles: this table is
-- only ever written to via the Flask backend using the service-role key,
-- which bypasses RLS. The browser never talks to Supabase directly for this.

-- Row Level Security: lock everything down by default, then open narrow gaps
alter table public.profiles enable row level security;
alter table public.interests enable row level security;
alter table public.linked_accounts enable row level security;
alter table public.matches enable row level security;
alter table public.messages enable row level security;

-- Anyone signed in can read basic profile/interest info (needed for matching)
create policy "Profiles are viewable by authenticated users"
  on public.profiles for select using (auth.role() = 'authenticated');

create policy "Users manage their own profile"
  on public.profiles for all using (auth.uid() = id);

create policy "Interests are viewable by authenticated users"
  on public.interests for select using (auth.role() = 'authenticated');

create policy "Users manage their own interests"
  on public.interests for all using (auth.uid() = profile_id);

create policy "Users manage their own linked accounts"
  on public.linked_accounts for all using (auth.uid() = profile_id);

-- Matches: only the two people involved can see their match row
create policy "Users see their own matches"
  on public.matches for select
  using (auth.uid() = user_a_id or auth.uid() = user_b_id);

create policy "Users update their own match status"
  on public.matches for update
  using (auth.uid() = user_a_id or auth.uid() = user_b_id);

-- Messages: only visible to the two people in the parent match
create policy "Users see messages in their own matches"
  on public.messages for select
  using (
    exists (
      select 1 from public.matches m
      where m.id = match_id
      and (m.user_a_id = auth.uid() or m.user_b_id = auth.uid())
    )
  );

create policy "Users send messages in their own matches"
  on public.messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.matches m
      where m.id = match_id
      and (m.user_a_id = auth.uid() or m.user_b_id = auth.uid())
      and m.status = 'mutual'
    )
  );
