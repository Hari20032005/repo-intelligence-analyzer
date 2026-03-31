# GitHub Repository Intelligence Analyzer

> Pre-GSoC 2026 Task 2 submission for [c2siorg/Webiu #541](https://github.com/c2siorg/Webiu/issues/541)

Analyzes GitHub repositories and generates structured intelligence reports covering **activity**, **structural complexity**, **project health**, and **bus-factor distribution** — all combined into a learning-difficulty classification (Beginner / Intermediate / Advanced).

**Live Demo:** `https://repo-intelligence-analyzer.onrender.com`

**HTML Report Demo:** `https://repo-intelligence-analyzer.onrender.com/report?urls=https://github.com/c2siorg/Webiu,https://github.com/c2siorg/NFT-Toolbox`

**Org Report Demo:** `https://repo-intelligence-analyzer.onrender.com/report/org/c2siorg`

---

## What's new in v2

| Feature | v1 | v2 |
|---|---|---|
| Scores per repo | 2 (activity, complexity) | **4** (+ health, bus factor) |
| Difficulty formula | 2-factor | **4-factor** (health & bus factor lower difficulty) |
| API calls per repo | 7 (tree fetched twice) | **6** (tree cached and shared) |
| Retry logic | None | **Exponential back-off** on 429/5xx |
| HTML report | None | **`/report` and `/report/org/:org`** endpoints |
| Org analysis | None | **`/analyze/org/:org`** — analyze all repos in an org |
| Rate limit info | Not returned | **Included** in every response |
| Health signals | Not detected | **CONTRIBUTING, CI/CD, templates, CoC, Security, Changelog** |
| Bus factor | Not measured | **Top-contributor concentration score** |

---

## Quick Start

### Prerequisites
- Node.js ≥ 18
- A GitHub personal access token *(optional but recommended — raises rate limit from 60 to 5 000 req/hour)*

### Install & Run

```bash
git clone https://github.com/Hari20032005/repo-intelligence-analyzer.git
cd repo-intelligence-analyzer

npm install

# Copy env template and add your token
cp .env.example .env
# Edit .env → set GITHUB_ACCESS_TOKEN=ghp_...

# Start the API server
npm run dev          # development (ts-node, hot reload)
npm run build && npm start   # production
```

Server starts at `http://localhost:3000`.

---

## API Reference

### `GET /` — Service index
Returns available endpoints.

### `POST /analyze` — Analyze repositories (JSON)

```bash
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "urls": [
      "https://github.com/c2siorg/Webiu",
      "https://github.com/c2siorg/NFT-Toolbox"
    ]
  }'
```

### `GET /analyze?urls=` — Quick analysis (comma-separated)

```bash
curl "http://localhost:3000/analyze?urls=https://github.com/c2siorg/Webiu,https://github.com/c2siorg/SCoRE"
```

### `GET /analyze/org/:org` — Analyze all repos in a GitHub org

```bash
curl "http://localhost:3000/analyze/org/c2siorg?limit=10"
```

- Default `limit`: 20 repositories (max: 30, sorted by most recently pushed)

### `GET /report?urls=` — HTML intelligence report

```bash
# Open in browser:
http://localhost:3000/report?urls=https://github.com/c2siorg/Webiu,https://github.com/c2siorg/NFT-Toolbox
```

Returns a fully rendered HTML page with visual score bars, health signal badges, and difficulty distribution.

### `GET /report/org/:org` — HTML report for entire org

```bash
http://localhost:3000/report/org/c2siorg?limit=10
```

---

## Response Structure

```json
{
  "summary": {
    "total": 2,
    "successful": 2,
    "failed": 0,
    "beginner": 0,
    "intermediate": 2,
    "advanced": 0,
    "averageActivity": 54,
    "averageComplexity": 48,
    "averageHealth": 65
  },
  "reports": [
    {
      "url": "https://github.com/c2siorg/Webiu",
      "owner": "c2siorg",
      "repo": "Webiu",
      "description": "C2SI Organization Website",
      "language": "TypeScript",
      "topics": ["angular", "nestjs"],
      "license": "Apache License 2.0",
      "archived": false,
      "metrics": {
        "stars": 68,
        "forks": 112,
        "openIssues": 24,
        "contributors": 52,
        "topContributorPct": 34,
        "languages": { "TypeScript": 312450, "HTML": 21340 },
        "languageCount": 6,
        "fileCount": 284,
        "dependencyFiles": ["package.json", "webiu-server/package.json"],
        "recentCommits": 34,
        "healthSignals": {
          "hasContributing": true,
          "hasCodeOfConduct": true,
          "hasIssueTemplates": true,
          "hasCICD": true,
          "hasSecurityPolicy": false,
          "hasChangelog": false
        }
      },
      "scores": {
        "activityScore": 55,
        "complexityScore": 44,
        "healthScore": 85,
        "busFactorScore": 66,
        "combinedScore": 38
      },
      "difficulty": "Intermediate",
      "analysedAt": "2026-03-14T10:00:00.000Z"
    }
  ],
  "rateLimit": {
    "remaining": 4821,
    "limit": 5000,
    "resetAt": "2026-03-14T11:00:00.000Z"
  }
}
```

---

## CLI Usage

```bash
npm run analyze https://github.com/c2siorg/Webiu https://github.com/c2siorg/SCoRE
```

---

## Scoring Overview

### Four independent scores

| Score | Formula summary | Range |
|---|---|---|
| **Activity** | `commits(40%) + stars(20%) + forks(15%) + issues(15%) + contributors(10%)` | 0–100 |
| **Complexity** | `fileCount(40%) + languageCount(30%) + depFiles(30%)` | 0–100 |
| **Health** ★ | `CONTRIBUTING(25) + CI/CD(25) + templates(20) + CoC(15) + Security(10) + Changelog(5)` | 0–100 |
| **Bus Factor** ★ | `(1 - topContributorPct) × 100` | 0–100 |

### Combined score & difficulty

```
combinedScore = complexity×0.45 + activity×0.25 + (100−health)×0.20 + (100−busFactor)×0.10
```

High health and high bus-factor **lower** the combined score — a complex repo with great docs and distributed contributions is genuinely more approachable.

**Difficulty:** Combined < 30 → Beginner · < 60 → Intermediate · ≥ 60 → Advanced

Full methodology: [`docs/scoring-methodology.md`](docs/scoring-methodology.md)

---

## Sample Analyses

Pre-generated reports: [`docs/sample-analyses.json`](docs/sample-analyses.json)

| Repository | Activity | Complexity | Health | Bus Factor | Difficulty |
|---|---|---|---|---|---|
| c2siorg/Webiu | 55 | 44 | 85 | 66 | Intermediate |
| c2siorg/SCoRE | 36 | 32 | 60 | 45 | Intermediate |
| c2siorg/RoadMap | 14 | 5 | 40 | 30 | Beginner |
| c2siorg/codefactor | 67 | 52 | 75 | 58 | Intermediate |
| c2siorg/NFT-Toolbox | 53 | 57 | 70 | 62 | Intermediate |

---

## Architecture (Task 1)

See [`docs/architecture.md`](docs/architecture.md) for the full scalable design covering:
- Two-tier caching (L1 in-process Map + L2 Redis) with read-through strategy
- Webhook-driven real-time cache invalidation with HMAC verification
- GraphQL batching (20 repos per query → 10× API call reduction)
- Incremental sync (only changed repos → 95% call reduction vs. full poll)
- ETag conditional requests (~40–60% savings on stable repos)
- Scalability path: 300 → 1k → 5k → 10 000 repositories
- Failure handling with circuit breaker, DLQ, and Prometheus alerting

---

## Rate Limit Handling

| Strategy | Savings | Implementation |
|---|---|---|
| In-memory cache (5-min TTL) | 90–99% on hot paths | `Map<key, {data, expiresAt}>` |
| Shared tree fetch | 1 call saved per repo | `getRepoTree()` cached, shared by file count + deps + health |
| Exponential back-off | Survives bursts | Retry on 429/5xx: `2^attempt × 300ms`, max 3 attempts |
| Rate limit status in response | Visibility | `GET /rate_limit` appended to every analysis response |

- **Unauthenticated:** 60 req/hour → ~5 repos per run
- **With token:** 5 000 req/hour → 400+ repos per run

---

## Project Structure

```
src/
├── github.ts      — GitHub API client: caching, retry, health signals, bus factor
├── scorer.ts      — Activity, complexity, health, bus-factor scores + difficulty
├── analyzer.ts    — Orchestrates single/batch/org analysis
├── report.ts      — HTML report generator (self-contained, no external CSS)
└── server.ts      — Express API: /analyze, /analyze/org, /report, /report/org
docs/
├── architecture.md          — Task 1: scalable system design
├── scoring-methodology.md   — All formulas, weights, assumptions, edge cases
└── sample-analyses.json     — Pre-generated reports for 5 c2siorg repos
```

---

## Deployment on Render

1. Fork this repo
2. Go to [render.com](https://render.com) → New → Web Service → connect your fork
3. Set environment variable: `GITHUB_ACCESS_TOKEN=ghp_your_token`
4. Deploy — Render reads `render.yaml` automatically
