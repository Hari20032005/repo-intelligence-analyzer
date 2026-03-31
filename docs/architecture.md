# Task 1 — Scalable GitHub Data Aggregation System

## Objective

Design a production-grade architecture that aggregates repository data from **300+ GitHub repositories**, serves it to a website with sub-200 ms response times, and scales gracefully to **10 000 repositories** — all while staying within GitHub's API rate limits.

---

## Architecture Diagram

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                          CLIENTS / CONSUMERS                                ║
║   Angular SPA   │   Mobile App   │   CI Dashboards   │   Third-party APIs   ║
╚══════════════════════════════════════════════════════════════════════════════╝
          │  HTTPS / REST / GraphQL
╔═════════▼════════════════════════════════════════════════════════════════════╗
║                           CDN EDGE LAYER                                    ║
║  Cloudflare / CloudFront  ──  Cache-Control: max-age=300 (public pages)     ║
║  Stale-while-revalidate for org repository lists                            ║
╚═════════▼════════════════════════════════════════════════════════════════════╝
          │  cache miss
╔═════════▼════════════════════════════════════════════════════════════════════╗
║                         API GATEWAY (NestJS)                                ║
║  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────────────────┐ ║
║  │  REST endpoints │  │  GraphQL (Apollo)│  │  Webhook receiver          │ ║
║  │  /api/projects  │  │  flexible queries│  │  POST /webhooks/github     │ ║
║  │  /api/issues    │  │  depth-limited   │  │  Validates X-Hub-Signature │ ║
║  │  /api/insights  │  │                  │  │                            │ ║
║  └────────┬────────┘  └────────┬─────────┘  └──────────────┬─────────────┘ ║
║           │                   │                            │               ║
║  ┌────────▼───────────────────▼────────────────────────────▼─────────────┐ ║
║  │              CACHE SERVICE (two-tier read-through)                    │ ║
║  │  L1: In-process Map   TTL 300s   (hot keys, ~50 MB ceiling)           │ ║
║  │  L2: Redis Cluster    TTL 900s   (shared across instances)            │ ║
║  │  Cache keys:  org:c2siorg:repos · repo:c2siorg:Webiu · rate_limit     │ ║
║  └────────────────────────────┬──────────────────────────────────────────┘ ║
╚════════════════════════════════╪═════════════════════════════════════════════╝
                                 │  cache miss → enqueue background refresh
╔════════════════════════════════▼═════════════════════════════════════════════╗
║                       DATA INGESTION LAYER                                  ║
║                                                                             ║
║  ┌──────────────────────────────────────────────────────────────────────┐  ║
║  │               SYNC SCHEDULER  (Bull + Redis)                        │  ║
║  │                                                                      │  ║
║  │  ┌──────────────────┐   ┌─────────────────────┐                     │  ║
║  │  │ Full Sync        │   │ Incremental Sync     │                     │  ║
║  │  │ cron: 0 2 * * *  │   │ cron: */15 * * * *  │                     │  ║
║  │  │ (nightly 2 AM)   │   │ (every 15 min)       │                     │  ║
║  │  │ All repos, all   │   │ Only repos where     │                     │  ║
║  │  │ fields           │   │ pushed_at > last sync│                     │  ║
║  │  └────────┬─────────┘   └──────────┬──────────┘                     │  ║
║  │           └───────────────┬─────────┘                                │  ║
║  │                           │                                          │  ║
║  │  ┌────────────────────────▼──────────────────────────────────────┐  │  ║
║  │  │              GITHUB SERVICE  (NestJS Injectable)              │  │  ║
║  │  │  - REST v3 + GraphQL v4 (batches 20 repos per GQL request)    │  │  ║
║  │  │  - Token bucket: pause at <200 req remaining                  │  │  ║
║  │  │  - Retry: exponential back-off, max 3 attempts                │  │  ║
║  │  │  - Conditional GET: If-None-Match (ETag) → 304 = free         │  │  ║
║  │  └───────────────────────────────────────────────────────────────┘  │  ║
║  └──────────────────────────────────────────────────────────────────────┘  ║
║                                                                             ║
║  ┌──────────────────────────────────────────────────────────────────────┐  ║
║  │             WEBHOOK EVENT PROCESSOR  (Bull queue)                   │  ║
║  │  push / pull_request / release / repository events                  │  ║
║  │  → invalidate specific Redis key → enqueue targeted re-fetch        │  ║
║  └──────────────────────────────────────────────────────────────────────┘  ║
╚══════════════════════════════════════════════════════════════════════════════╝
                                 │
╔════════════════════════════════▼═════════════════════════════════════════════╗
║                         STORAGE LAYER                                       ║
║                                                                             ║
║  ┌──────────────────────────────┐   ┌────────────────────────────────────┐ ║
║  │  MongoDB  (persistent)       │   │  Redis  (ephemeral)                │ ║
║  │  - repo_snapshots collection │   │  - L2 cache (key-value)            │ ║
║  │  - commit_timeseries (1 yr)  │   │  - Bull job queues                 │ ║
║  │  - language_breakdowns       │   │  - Rate-limit token bucket         │ ║
║  │  - intelligence_reports      │   │  - Pub/Sub for cache invalidation  │ ║
║  │  - org_members               │   │  - Session / rate-limit guards     │ ║
║  └──────────────────────────────┘   └────────────────────────────────────┘ ║
╚══════════════════════════════════════════════════════════════════════════════╝
                                 │
╔════════════════════════════════▼═════════════════════════════════════════════╗
║                      OBSERVABILITY LAYER                                    ║
║  Prometheus metrics → Grafana dashboards                                    ║
║  Key metrics: api_calls_remaining, cache_hit_ratio, sync_lag_seconds        ║
║  Alerts: api_remaining < 500, sync_lag > 1800s, error_rate > 1%            ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

## API Flow: Frontend → Backend → GitHub

### Normal request (cache hit)

```
Browser  →  CDN  →  NestJS  →  L1 Cache (hit)  →  200 OK  →  Browser
          ~5 ms    ~10 ms       ~0.1 ms
```

### Cache miss flow

```
Browser  →  NestJS  →  L1 miss  →  L2 Redis (miss)  →  MongoDB read
         →  return stale + enqueue background refresh
         →  200 OK with stale data  (never block on GitHub API)

Background worker:
  →  GitHub API  →  upsert MongoDB  →  write Redis L2  →  write L1
```

### Webhook-driven cache invalidation

```
GitHub  →  POST /webhooks/github  →  validate HMAC-SHA256 signature
        →  parse event (push to c2siorg/Webiu)
        →  Redis.del("repo:c2siorg:Webiu")
        →  Bull.add("refresh-repo", { owner: "c2siorg", repo: "Webiu" })

Background worker (within 2 seconds):
        →  GitHub API: GET /repos/c2siorg/Webiu
        →  Upsert MongoDB  →  Set Redis L2  →  Set L1
```

### GraphQL batching (efficiency critical path)

Instead of N×6 REST calls, fetch core metadata for up to 20 repos in **one** GraphQL request:

```graphql
{
  r0: repository(owner: "c2siorg", name: "Webiu") {
    stargazerCount forkCount openIssues: issues(states: OPEN) { totalCount }
    defaultBranchRef { name } licenseInfo { name } repositoryTopics(first: 10) { nodes { topic { name } } }
  }
  r1: repository(owner: "c2siorg", name: "SCoRE") { ... }
  # up to r19
}
```

**Impact:** 300 repos = 15 GraphQL requests for core fields vs. 1 800 REST calls. **10× reduction.**

---

## Core Components

### 1. Data Ingestion

| Mechanism | Frequency | API calls | Use case |
|---|---|---|---|
| **Full sync** | Nightly (02:00) | ~6 per repo | Catch anything webhooks missed |
| **Incremental sync** | Every 15 min | ~1–3 per changed repo | Updates only repos with new pushes |
| **Webhook** | Real-time | 0 (event-driven) | Sub-second cache invalidation |
| **On-demand** | Per API request | ~6 per repo | For repos not yet in DB |

Incremental sync algorithm:
1. `GET /orgs/c2siorg/repos?sort=pushed&per_page=100` — fetch `pushed_at` for all repos.
2. Compare each `pushed_at` against `last_synced_at` in MongoDB.
3. For repos where `pushed_at > last_synced_at` (typically <5% of repos on a quiet day): enqueue full re-fetch.
4. Result: **~15 API calls per 15-minute cycle** vs. 1 800 if polling all repos.

### 2. Processing Layer

```
GithubService
├── fetchOrgRepos(org, page)          — paginated REST
├── batchFetchCoreData(repos[])       — GitHub GraphQL, 20 repos/request
├── fetchRepoDetails(owner, repo)     — REST, ETag-conditional
├── fetchCommitActivity(owner, repo)  — REST stats (async compute)
└── retryWithBackoff(fn, maxAttempts) — 429/5xx retry, Retry-After header
```

### 3. Storage Layer

| Data | Store | TTL / Retention | Rationale |
|---|---|---|---|
| Repo metadata | MongoDB | Permanent | Enables historical trending |
| Commit timeseries | MongoDB | 1-year rolling window | Activity trend analysis |
| Language breakdown | MongoDB | Refreshed on sync | Rarely changes |
| Intelligence reports | MongoDB | Permanent | Audit trail |
| L2 cache (hot repos) | Redis | 15 min | Sub-millisecond reads |
| Rate-limit bucket | Redis | Runtime | Shared across instances |
| Job queues | Redis (Bull) | Per-job TTL | Reliable background processing |

### 4. Caching Strategy

**Two-tier read-through cache:**

```
Request
  → L1 (in-process Map, 5-min TTL, ~50 MB ceiling)
      Hit → return immediately (~0.1 ms)
      Miss ↓
  → L2 (Redis, 15-min TTL)
      Hit → populate L1, return (~1 ms)
      Miss ↓
  → MongoDB
      Hit → populate L2 + L1, return (~5 ms)
      Miss ↓
  → GitHub API (background job, serve stale while refreshing)
```

**Cache key strategy:**
```
org:repos:{org}              — org repo list (paginated)
repo:{owner}/{repo}          — full repo snapshot
repo:langs:{owner}/{repo}    — language breakdown
repo:commits:{owner}/{repo}  — weekly commit activity
repo:intel:{owner}/{repo}    — intelligence report
rate_limit:token:{hash}      — remaining quota for a token
```

**Conditional requests (ETag):**
- Store `ETag` header from previous GitHub response in Redis alongside cached data.
- On next request: send `If-None-Match: <etag>`.
- GitHub returns `304 Not Modified` (does **not** count against rate limit).
- **Estimated 40–60% reduction in rate-limit consumption** for stable repositories.

### 5. Rate Limit Handling

GitHub API budgets:
- **Unauthenticated:** 60 req/hour/IP
- **Authenticated (PAT):** 5 000 req/hour/token
- **GitHub App:** 15 000 req/hour/installation
- **GraphQL:** 5 000 points/hour (complex queries cost more)

Strategies (layered, applied in order):

| Strategy | Savings | Implementation |
|---|---|---|
| Two-tier cache | 90–99% on hot paths | L1 Map + Redis |
| Conditional GET (ETag) | 40–60% on stable repos | `If-None-Match` header |
| GraphQL batching | 10× for metadata fetches | 20 repos per query |
| Incremental sync | 95% vs full sync on quiet days | `pushed_at` comparison |
| Token rotation | N× rate limit | Distribute across token pool |
| Back-off on 429 | Avoids ban | `Retry-After` header |
| Pause at low budget | Prevents exhaustion | Redis token bucket |

**Token bucket implementation:**
```typescript
// Redis stores: rate_limit:token:{tokenHash} = remaining
// Before each batch:
const remaining = await redis.get(`rate_limit:token:${hash}`);
if (remaining !== null && parseInt(remaining) < 200) {
  const resetAt = await redis.get(`rate_limit:reset:${hash}`);
  await sleep(Math.max(0, parseInt(resetAt) - Date.now()));
}
// After each response: update from X-RateLimit-Remaining header
```

### 6. Update Mechanism

| Trigger | Latency | Coverage |
|---|---|---|
| Webhook (push/PR/release) | < 2 seconds | 100% of active repos |
| Incremental sync (15 min) | < 15 minutes | All repos (catch webhook misses) |
| Full sync (nightly) | < 24 hours | Safety net + historical snapshot |
| Cache TTL expiry | 5–15 minutes | Any repo not covered above |

**Webhook security:**
Every webhook payload is validated against its `X-Hub-Signature-256` HMAC header using the shared webhook secret before processing. Invalid signatures are rejected with `401`.

### 7. Failure Handling

| Failure scenario | Detection | Response |
|---|---|---|
| GitHub API rate limit (429) | `X-RateLimit-Remaining: 0` header | Pause ingestion; serve stale MongoDB data; UI banner |
| GitHub API outage (5xx) | 3 consecutive 5xx | Circuit breaker: stop retrying for 5 min; serve MongoDB |
| GitHub API timeout | `axios` 20s timeout | Retry 3× with backoff; fallback to stale cache |
| MongoDB down | Connection error | Serve Redis-only for up to 15-min TTL; alert on-call |
| Redis down | Connection error | Degrade to L1-only; disable background jobs temporarily |
| Repository not found (404) | HTTP 404 | Mark `status: not_found` in DB; skip gracefully |
| Webhook delivery failure | No event received | Incremental sync catches the miss within 15 minutes |
| Failed Bull job | `failed` event | Retry 3×; move to dead-letter queue; alert via email |

---

## Scalability Plan: 300 → 10 000 Repositories

| Scale | Bottleneck | Solution | API calls/hour |
|---|---|---|---|
| **300 repos** | None | Single instance, in-process cache | ~180 (incremental) |
| **1 000 repos** | In-process cache memory (>200 MB) | Add Redis L2 as primary cache | ~60 (incremental) |
| **3 000 repos** | GitHub rate limit per token | Token rotation pool (3 tokens) | ~180 with 3 tokens |
| **5 000 repos** | Single NestJS process CPU | Horizontal scaling (3 instances) + load balancer | ~300 with 5 tokens |
| **10 000 repos** | MongoDB write throughput | MongoDB sharding by org; dedicated ingestion microservice | ~600 with 10 tokens |

**Horizontal scaling design:**
- All NestJS instances share **Redis** (cache + Bull queues).
- Only **one** Bull worker runs `full-sync` and `incremental-sync` jobs (leader election via Bull).
- Multiple workers can process `refresh-repo` jobs in parallel.
- Load balancer routes API requests round-robin.

**GitHub App vs. PAT at scale:**
- At 10 000 repos across 100 orgs: use **GitHub App** (15 000 req/installation vs. 5 000/token).
- Each org installation gives a separate 15 000 req/hour budget.

---

## Performance Targets

| Metric | Target | Achieved by |
|---|---|---|
| P50 API response time | < 50 ms | L1 cache hit |
| P95 API response time | < 200 ms | L2 Redis hit |
| P99 API response time | < 1 000 ms | MongoDB read + L1 populate |
| Frontend initial load | < 500 ms | CDN + paginated API |
| Cache hit ratio | > 95% | Two-tier cache + TTL design |
| GitHub API utilisation | < 20% of budget | Caching + conditional GETs + GraphQL batching |

---

## Technology Choices & Justification

| Component | Technology | Justification |
|---|---|---|
| **Backend framework** | NestJS (TypeScript) | Modular DI, native GraphQL (Apollo), matches existing Webiu stack |
| **HTTP client** | axios | Interceptors for retry/auth/ETag; familiar API |
| **Task queue** | Bull + Redis | Battle-tested; built-in retry, DLQ, cron; NestJS `@nestjs/bull` module |
| **L1 cache** | In-process `Map` | Zero dependencies; sufficient for single-instance; no serialisation |
| **L2 cache** | Redis | Sub-millisecond; Pub/Sub for invalidation; shared across instances |
| **Persistent store** | MongoDB | Flexible schema accommodates heterogeneous repo metadata; easy sharding |
| **GitHub data** | REST v3 + GraphQL v4 | GraphQL for batch metadata; REST for stats endpoints not on GraphQL |
| **Webhooks** | GitHub Webhooks | Native GitHub push events; no polling; HMAC-verified |
| **CDN** | Cloudflare | Free tier sufficient; automatic TLS; global edge caching |
| **Observability** | Prometheus + Grafana | Standard OSS stack; pre-built GitHub API dashboards available |
| **Containerisation** | Docker + docker-compose | Reproducible local dev; identical to prod |
| **Deployment** | Render / Railway | Zero-config Node.js + Redis services; auto-scaling on paid plans |

---

## Security Considerations

1. **Webhook verification** — Every inbound webhook validates `X-Hub-Signature-256` HMAC before processing.
2. **Token storage** — GitHub tokens stored as environment variables, never in code or logs.
3. **Rate-limit guard** — NestJS `ThrottlerModule`: 30 requests/IP/minute prevents abuse.
4. **Input validation** — All `/api` endpoints validate and sanitise `owner/repo` parameters (alphanumeric + `-_.` only) before using them in GitHub API paths.
5. **CORS** — Restrict `Access-Control-Allow-Origin` to known frontend domain in production.
6. **Dependency audit** — `npm audit` in CI pipeline; Dependabot for automated patch PRs.

---

## Monitoring & Observability

Key Prometheus metrics exported by the NestJS service:

```
github_api_calls_remaining{token="..."} 4823
github_api_calls_total{endpoint="/repos", status="200"} 1240
cache_hits_total{tier="l1"} 98230
cache_misses_total{tier="l1"} 1240
sync_lag_seconds{type="incremental"} 312
bull_queue_waiting{queue="refresh-repo"} 4
bull_queue_failed{queue="refresh-repo"} 0
```

Grafana alert rules:
- `github_api_calls_remaining < 500` → PagerDuty / Slack alert
- `sync_lag_seconds > 1800` → Warning (last sync > 30 min ago)
- `cache_hits_total / (cache_hits_total + cache_misses_total) < 0.90` → Cache health alert
- `bull_queue_failed > 10` → Dead-letter queue investigation

---

## Deliverable Summary

| Requirement | Solution |
|---|---|
| Architecture diagram | ASCII diagram above |
| Data ingestion | REST + GraphQL batch + Webhook |
| Processing layer | NestJS GithubService, Bull workers |
| Storage layer | MongoDB (persistent) + Redis (ephemeral) |
| API layer | REST + GraphQL + rate-limit guard |
| Caching mechanism | Two-tier (L1 Map + L2 Redis) + CDN + ETag |
| Rate limit handling | ETag, GraphQL batching, incremental sync, token rotation, back-off |
| Update mechanism | Webhooks (real-time) + incremental sync (15 min) + full sync (nightly) |
| Scalability 300→10k | Horizontal scaling + sharding + GitHub App tokens |
| Failure handling | Circuit breaker + stale cache + DLQ + on-call alerts |
| Technology justification | See table above |
