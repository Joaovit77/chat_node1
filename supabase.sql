create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  session_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_session_id_created_at_idx
  on public.chat_messages (session_id, created_at);
