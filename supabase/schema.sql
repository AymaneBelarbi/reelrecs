-- Run once in the Supabase SQL editor. Safe to re-run.
-- If you applied an earlier draft of this schema, reset it first:
--   drop table if exists movies cascade;
create extension if not exists vector;

create table if not exists movies (
  id bigserial primary key,
  title text not null,
  year int not null, -- part of the (title, year) upsert key; NULLs would never conflict
  genres text[] not null default '{}',
  content text not null,
  embedding vector(1536), -- text-embedding-3-small / ada-002
  -- Keyword index: title weighted above body text.
  fts tsvector generated always as (
    setweight(to_tsvector('english', title), 'A') ||
    setweight(to_tsvector('english', content), 'C')
  ) stored,
  unique (title, year)
);

-- Approximate nearest-neighbour index (cosine) and full-text index.
create index if not exists movies_embedding_hnsw on movies using hnsw (embedding vector_cosine_ops);
create index if not exists movies_fts_gin on movies using gin (fts);

-- Hybrid search: dense (pgvector) + sparse (full-text), merged with Reciprocal Rank Fusion.
--   score = semantic_weight / (rrf_k + semantic_rank) + keyword_weight / (rrf_k + keyword_rank)
-- keyword_query is a tsquery string (e.g. 'dream | heist'); query_embedding may be null,
-- in which case the function degrades to keyword-only search.
create or replace function hybrid_search (
  keyword_query text,
  query_embedding vector(1536),
  match_count int default 20,
  semantic_weight float default 1.0,
  keyword_weight float default 1.0,
  rrf_k int default 50
)
returns table (
  id bigint, title text, year int, genres text[], content text,
  semantic_rank int, keyword_rank int, score float
)
language sql stable
as $$
  with keyword as (
    select m.id,
           row_number() over (order by ts_rank_cd(m.fts, to_tsquery('english', keyword_query)) desc)::int as rank_ix
    from movies m
    where keyword_query <> '' and m.fts @@ to_tsquery('english', keyword_query)
    order by rank_ix
    limit match_count * 2
  ),
  semantic as (
    select m.id,
           row_number() over (order by m.embedding <=> query_embedding)::int as rank_ix
    from movies m
    where query_embedding is not null and m.embedding is not null
    order by m.embedding <=> query_embedding
    limit match_count * 2
  )
  select m.id, m.title, m.year, m.genres, m.content,
         s.rank_ix, k.rank_ix,
         (coalesce(keyword_weight / (rrf_k + k.rank_ix), 0.0) +
          coalesce(semantic_weight / (rrf_k + s.rank_ix), 0.0))::float as score
  from keyword k
  full outer join semantic s on k.id = s.id
  join movies m on m.id = coalesce(k.id, s.id)
  order by score desc
  limit match_count;
$$;

-- Only the server (service-role key) may query; browsers can never hit the table directly.
alter table movies enable row level security;
revoke all on table movies from anon, authenticated;
revoke all on function hybrid_search from public, anon, authenticated;
