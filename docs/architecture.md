# Task 1 — Scalable GitHub Data Aggregation System Design

## Objective

Design an architecture that collects repository data from 300+ GitHub repositories, serves it to a frontend website, minimises API usage, and scales gracefully to 10 000 repositories.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Angular)                           │
│                    GET /api/projects?page=1                         │
└─────────────────────────┬───────────────────────────────────────────┘
                          │ HTTP
┌─────────────────────────▼───────────────────────────────────────────┐
│                      API LAYER (NestJS)                             │
│   REST + GraphQL endpoints  │  Rate-limit guard (ThrottlerModule)   │
└───────┬─────────────────────┬───────────────────────────────────────┘
        │                     │
┌───────▼──────┐     ┌────────▼────────┐
│  In-Process  │     │  Redis Cache    │  ← L1 / L2 cache
│  Cache (Map) │     │  (optional)     │
└───────┬──────┘     └────────┬────────┘
        │                     │
        └──────────┬──────────┘
                   │ cache miss
┌──────────────────▼───────────────────────────────────────────────────┐
│                   DATA INGESTION LAYER                               │
│                                                                      │
│  ┌──────────────────┐   ┌────────────────────┐                      │
│  │  GitHub REST API │   │  GitHub Webhooks   │                      │
│  │  (paginated)     │   │  push / PR / release│                     │
│  └────────┬─────────┘   └─────────┬──────────┘                     │
│           │                       │ event-driven invalidation        │
│  ┌────────▼─────────────────────────▼──────────────────────────┐   │
│  │              GitHub Service (axios + retry + backoff)       │   │
│  └────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────────────────┐
│                   STORAGE LAYER (optional/future)                    │
│                                                                      │
│   MongoDB / PostgreSQL — persisted repo snapshots                   │
│   Updated via: scheduled jobs (nightly) + webhook triggers          │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Data Ingestion

- **GitHub REST API** — Paginated fetch of all org repositories (`GET /orgs/{org}/repos?per_page=100`).
- **GitHub Webhooks** — Receive `push`, `pull_request`, `release`, and `repository` events to trigger targeted cache invalidation instead of polling the entire org.

### 2. Processing Layer

The `GithubService` (NestJS injectable) orchestrates all API calls:
- `fetchAllPages()` — automatic pagination over GitHub's 100-item page limit.
- Parallel batch processing (batch size 10) for per-repo enrichment (PR counts, contributors).
- Retry with exponential back-off on transient failures (429, 5xx).

### 3. Storage Layer

| Data type | Storage | Rationale |
|---|---|---|
| Repo list + metadata | In-process cache (or Redis) | High read, low write — perfect for cache |
| Commit stats, languages | In-process cache (short TTL 5 min) | Computed by GitHub, rarely stale |
| User profiles | In-process cache (long TTL 30 min) | Very rarely changes |
| Persistent snapshots | MongoDB (future) | Enables historical trending, offline serving |

### 4. Caching Layer

Two-tier cache:

| Tier | Technology | TTL | Purpose |
|---|---|---|---|
| L1 | In-process `Map` (`CacheService`) | 5 min | Zero-latency cache for hot paths |
| L2 | Redis (optional, add when needed) | 15–30 min | Shared cache across multiple server instances |

Cache keys are namespaced: `org_repos_c2siorg`, `contributors_c2siorg_Webiu`, etc.

### 5. API Layer

- **REST** — `/api/projects`, `/api/issues`, `/api/contributors`
- **GraphQL** — Apollo server for flexible frontend queries
- **Rate-limit guard** — NestJS `ThrottlerModule`: 30 req/IP/min

---

## Rate Limit Handling

GitHub allows:
- **Unauthenticated:** 60 requests/hour/IP
- **Authenticated:** 5 000 requests/hour/token

Strategies:
1. **Cache aggressively** — most requests are served from cache, never hitting GitHub.
2. **Pagination batching** — fetch 100 items per page (maximum) to minimise requests.
3. **Parallel batching with concurrency limit** — batch size 10 prevents burst exhaustion.
4. **Exponential back-off** — on HTTP 429 or 5xx, wait `2^attempt × 100ms` before retry.
5. **Webhook-driven invalidation** — only invalidate the specific cache key affected by a push, not the entire cache.
6. **Multiple tokens** — rotate across a pool of tokens to multiply the effective rate limit.

---

## Update Mechanism

| Mechanism | Trigger | Latency |
|---|---|---|
| **Webhook** (primary) | GitHub sends event on code push, new PR, release | < 1 second |
| **Scheduled job** (fallback) | Nightly full refresh | Up to 24 hours |
| **TTL expiry** (safety net) | Cache expires after 5 minutes | Up to 5 minutes |

Webhook handler:
1. Receives event (e.g., `push` to `c2siorg/Webiu`).
2. Deletes only affected cache keys (e.g., `contributors_c2siorg_Webiu`).
3. Pre-warms cache in background.

---

## Scalability Plan: 300 → 10 000 Repositories

| Scale | Bottleneck | Solution |
|---|---|---|
| 300 repos | None — single instance handles comfortably | Current architecture |
| 1 000 repos | In-process cache memory | Add Redis as L2 cache |
| 3 000 repos | GitHub API rate limits | Token rotation pool (5 000 req/token/hour) |
| 5 000 repos | Single NestJS process | Horizontal scaling behind load balancer |
| 10 000 repos | Full org scan takes too long | Persistent DB + webhook-only incremental updates |

At 10 000 repositories with 5 tokens: **25 000 requests/hour** budget — sufficient for one full scan per hour with per-repo enrichment disabled and cached data serving most requests.

---

## Failure Handling

| Failure | Handling |
|---|---|
| GitHub API timeout | `axios` timeout 15s, retry up to 3× with back-off |
| Rate limit exhausted (429) | Retry after `Retry-After` header value; serve stale cache |
| Repository not found (404) | Return `null` / skip gracefully, log warning |
| Webhook delivery failure | Rely on TTL-based cache expiry as safety net |
| Cache service crash | Fall through to direct GitHub API calls |

---

## Technology Choices

| Component | Technology | Reason |
|---|---|---|
| Backend | NestJS (Node.js) | Already in the project; excellent DI, modular structure |
| HTTP client | axios | Promise-based, interceptors for retry/auth |
| Cache L1 | In-process `Map` | Zero dependency, sufficient for single instance |
| Cache L2 | Redis | Widely supported, sub-millisecond, Pub/Sub for invalidation |
| API style | REST + GraphQL (Apollo) | REST for simple consumers; GraphQL for flexible frontend queries |
| Webhooks | GitHub Webhooks → NestJS route | Native GitHub integration, no third-party service needed |
| Storage | MongoDB | Flexible schema for heterogeneous repo metadata |
| Deployment | Docker + Render / Railway | Container-based, easy horizontal scaling |
