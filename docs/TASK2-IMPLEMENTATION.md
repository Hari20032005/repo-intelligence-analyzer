# Task 2 — GitHub Repository Intelligence Analyzer
## Full Implementation & Working Details

> Pre-GSoC 2026 · Issue [#541](https://github.com/c2siorg/Webiu/issues/541)
>
> **Live URL:** https://repo-intelligence-analyzer.onrender.com
> **Source:** https://github.com/Hari20032005/repo-intelligence-analyzer

---

## Table of Contents

1. [Objective](#1-objective)
2. [Project Structure](#2-project-structure)
3. [How It Works — End to End](#3-how-it-works--end-to-end)
4. [GitHub API Integration](#4-github-api-integration)
5. [Scoring System — Full Details](#5-scoring-system--full-details)
   - 5.1 Activity Score
   - 5.2 Complexity Score
   - 5.3 Health Score
   - 5.4 Bus Factor Score
   - 5.5 Combined Score & Difficulty Classification
6. [Data Flow Diagram](#6-data-flow-diagram)
7. [API Reference](#7-api-reference)
8. [Frontend](#8-frontend)
9. [Rate Limit Handling & Efficiency](#9-rate-limit-handling--efficiency)
10. [Edge Case Handling](#10-edge-case-handling)
11. [Sample Outputs](#11-sample-outputs)
12. [How to Run Locally](#12-how-to-run-locally)
13. [Deployment](#13-deployment)
14. [Technology Choices](#14-technology-choices)
15. [Assumptions & Limitations](#15-assumptions--limitations)

---

## 1. Objective

Build a tool that:
- Accepts a list of GitHub repository URLs as input
- Collects data via the GitHub REST API (stars, forks, contributors, languages, commits, file tree)
- Computes a **custom multi-factor intelligence score** covering activity, complexity, project health, and contributor distribution
- Classifies each repository as **Beginner**, **Intermediate**, or **Advanced** based on how hard it is to contribute to
- Generates structured JSON and HTML reports
- Handles missing data, API failures, and rate limits gracefully

---

## 2. Project Structure

```
repo-intelligence-analyzer/
│
├── src/
│   ├── github.ts       GitHub API client — fetching, caching, retry logic
│   ├── scorer.ts       All scoring formulas — pure functions, fully documented
│   ├── analyzer.ts     Orchestration — coordinates API calls and scoring
│   ├── report.ts       HTML report generator — self-contained, no dependencies
│   ├── server.ts       Express API server — all HTTP endpoints
│   └── cli.ts          CLI entry point — analyze repos from terminal
│
├── public/
│   └── index.html      Single-page frontend UI — dark theme, no framework
│
├── docs/
│   ├── architecture.md          Task 1 — scalable system design
│   ├── scoring-methodology.md   Full formula documentation
│   ├── sample-analyses.json     Pre-generated reports for 5 repos
│   └── TASK2-IMPLEMENTATION.md  This file
│
├── package.json
├── tsconfig.json
├── render.yaml         Render.com deployment config
└── .env.example        Environment variable template
```

---

## 3. How It Works — End to End

### Step 1 — Input

The tool accepts GitHub repository URLs in three ways:

**Via API (POST):**
```json
POST /analyze
{ "urls": ["https://github.com/c2siorg/Webiu", "https://github.com/c2siorg/SCoRE"] }
```

**Via API (GET):**
```
GET /analyze?urls=https://github.com/c2siorg/Webiu,https://github.com/c2siorg/SCoRE
```

**Via CLI:**
```bash
npm run analyze https://github.com/c2siorg/Webiu https://github.com/c2siorg/SCoRE
```

**Via Frontend:**
Paste URLs into the text area and click "Analyze Repositories".

---

### Step 2 — URL Parsing

Each URL is parsed by `parseRepoUrl()` in `github.ts`:

```typescript
export function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  const clean = url.trim().replace(/\.git$/, '');
  const match = clean.match(/github\.com[/:]([\w.-]+)\/([\w.-]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}
```

This handles:
- `https://github.com/owner/repo`
- `https://github.com/owner/repo.git`
- `git@github.com:owner/repo.git`

Invalid URLs return `{ url, error: "Invalid GitHub repository URL." }` immediately.

---

### Step 3 — Data Collection (Two parallel batches)

For each repository, `analyzeOne()` in `analyzer.ts` makes **two parallel batches** of API calls:

**Batch 1** — does not need the branch name:
```typescript
const [details, languages, contributorCount, commitActivity, topContributors] =
  await Promise.all([
    client.getRepoDetails(owner, repo),       // GET /repos/{owner}/{repo}
    client.getLanguages(owner, repo),          // GET /repos/{owner}/{repo}/languages
    client.getContributorCount(owner, repo),   // GET /repos/{owner}/{repo}/contributors?per_page=1
    client.getCommitActivity(owner, repo),     // GET /repos/{owner}/{repo}/stats/commit_activity
    client.getTopContributors(owner, repo),    // GET /repos/{owner}/{repo}/contributors?per_page=10
  ]);
```

**Batch 2** — needs `default_branch` from Batch 1 result. All three calls share **one tree fetch** (cached):
```typescript
const [fileCount, dependencyFiles, healthSignals] = await Promise.all([
  client.getFileCount(owner, repo, branch),       // uses cached tree
  client.getDependencyFiles(owner, repo, branch), // uses cached tree
  client.getHealthSignals(owner, repo, branch),   // uses cached tree
]);
```

**Key optimization:** `getRepoTree()` is called once and cached in-memory for 5 minutes. All three tree-dependent functions read from the same cached result — **saving 2 API calls per repository** compared to fetching the tree separately for each.

---

### Step 4 — Scoring

Each metric is computed from the collected data. Full details in [Section 5](#5-scoring-system--full-details).

```typescript
const activityScore   = calculateActivityScore(commitActivity, stars, forks, issues, contributors);
const complexityScore = calculateComplexityScore(fileCount, languages, dependencyFiles);
const healthScore     = calculateHealthScore(healthSignals);
const { score: busFactorScore, topContributorPct } = calculateBusFactor(topContributors);
const combinedScore   = Math.round(
  activityScore * 0.25 + complexityScore * 0.45 +
  (100 - healthScore) * 0.20 + (100 - busFactorScore) * 0.10
);
const difficulty = classifyDifficulty(activityScore, complexityScore, healthScore, busFactorScore);
```

---

### Step 5 — Output

Results are returned as a structured `AnalysisResult` object:

```typescript
interface AnalysisResult {
  summary: {
    total: number;
    successful: number;
    failed: number;
    beginner: number;
    intermediate: number;
    advanced: number;
    averageActivity: number;
    averageComplexity: number;
    averageHealth: number;
  };
  reports: (RepoReport | { url: string; error: string })[];
  rateLimit?: { remaining: number; limit: number; resetAt: string } | null;
}
```

Each `RepoReport` contains:

```typescript
interface RepoReport {
  url: string;
  owner: string;
  repo: string;
  description: string | null;
  language: string | null;        // Primary language
  topics: string[];
  license: string | null;
  archived: boolean;
  metrics: {
    stars: number;
    forks: number;
    openIssues: number;
    contributors: number;
    topContributorPct: number;    // % of commits by top contributor
    languages: Record<string, number>;  // bytes per language
    languageCount: number;
    fileCount: number;
    dependencyFiles: string[];    // matched manifest file paths
    recentCommits: number;        // commits in last 4 weeks
    healthSignals: {
      hasContributing: boolean;
      hasCodeOfConduct: boolean;
      hasIssueTemplates: boolean;
      hasCICD: boolean;
      hasSecurityPolicy: boolean;
      hasChangelog: boolean;
    };
  };
  scores: {
    activityScore: number;    // 0–100
    complexityScore: number;  // 0–100
    healthScore: number;      // 0–100
    busFactorScore: number;   // 0–100
    combinedScore: number;    // 0–100
  };
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  analysedAt: string;         // ISO 8601 timestamp
}
```

---

## 4. GitHub API Integration

### Client (`src/github.ts`)

The `GithubClient` class wraps `axios` with:
- Bearer token authentication (optional, raises rate limit 60→5000/hr)
- 20-second request timeout
- In-memory response caching (5-minute TTL)
- Exponential back-off retry on failures

### Methods and endpoints used

| Method | GitHub Endpoint | Purpose |
|--------|----------------|---------|
| `getRepoDetails()` | `GET /repos/{owner}/{repo}` | Stars, forks, issues, branch, language, topics, license, archived flag |
| `getLanguages()` | `GET /repos/{owner}/{repo}/languages` | Language → bytes mapping |
| `getContributorCount()` | `GET /repos/{owner}/{repo}/contributors?per_page=1` | Total contributor count via `Link` header pagination |
| `getTopContributors()` | `GET /repos/{owner}/{repo}/contributors?per_page=10` | Top 10 contributors with contribution counts (for bus factor) |
| `getCommitActivity()` | `GET /repos/{owner}/{repo}/stats/commit_activity` | Weekly commit counts for last 52 weeks |
| `getRepoTree()` | `GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1` | Full file tree — **shared and cached** for file count, dep detection, health signals |

**Total: 6 API calls per repository** (tree fetched once, reused 3 times).

### Retry with exponential back-off

```typescript
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err?.response?.status;
      if (status === 404 || status === 409 || status === 422) throw err; // don't retry
      if (status === 403 || status === 429) {
        const retryAfter = err?.response?.headers?.['retry-after'];
        const wait = retryAfter ? parseInt(retryAfter) * 1000 : (2 ** attempt) * 500;
        await delay(Math.min(wait, 10000));
        continue;
      }
      if (attempt < maxAttempts - 1) await delay((2 ** attempt) * 300);
    }
  }
  throw lastError;
}
```

- **404/409/422** — not retried (resource doesn't exist or repo is empty)
- **403/429** — respects `Retry-After` header; otherwise waits `2^attempt × 500ms`
- **5xx / timeout** — waits `2^attempt × 300ms`, up to 3 attempts

### In-memory cache

```typescript
const cache = new Map<string, { data: unknown; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
```

Cache keys are namespaced per endpoint:
- `repo:c2siorg/Webiu`
- `langs:c2siorg/Webiu`
- `tree:c2siorg/Webiu`
- `commit_activity:c2siorg/Webiu`
- `contributors:c2siorg/Webiu`
- `top_contributors:c2siorg/Webiu`

Repeated analysis of the same repository within 5 minutes costs **zero additional API calls**.

---

## 5. Scoring System — Full Details

### 5.1 Activity Score (0–100)

Measures how actively the repository is being developed and used.

```
activityScore = clamp(
  recentCommitScore × 0.40 +
  starScore         × 0.20 +
  forkScore         × 0.15 +
  issueScore        × 0.15 +
  contribScore      × 0.10
, 0, 100)
```

| Component | Formula | Cap at 100 | Rationale |
|-----------|---------|-----------|-----------|
| `recentCommitScore` | `min(recentCommits / 200, 1) × 100` | 200 commits/4wks | Direct signal of active development |
| `starScore` | `log₁₀(stars+1) / log₁₀(10001) × 100` | 10,000 stars | Adoption signal; log prevents mega-repos dominating |
| `forkScore` | `log₁₀(forks+1) / log₁₀(1001) × 100` | 1,000 forks | Derivative use signal |
| `issueScore` | `log₁₀(issues+1) / log₁₀(501) × 100` | 500 issues | Community engagement proxy |
| `contribScore` | `log₁₀(contributors+1) / log₁₀(201) × 100` | 200 contributors | Contribution diversity proxy |

**Why logarithmic scaling?** A project with 100 stars vs 200 stars is meaningfully different. A project with 10,000 stars vs 10,100 stars is not. Log scaling captures this diminishing marginal difference.

**Weight rationale:**
- Recent commits (40%) is the strongest signal of current activity
- Stars + forks (35%) reflect historical adoption
- Issues + contributors (25%) reflect community engagement

---

### 5.2 Complexity Score (0–100)

Measures how much cognitive load a new contributor must absorb.

```
complexityScore = clamp(
  fileScore × 0.40 +
  langScore × 0.30 +
  depScore  × 0.30
, 0, 100)
```

| Component | Formula | Cap at 100 | Rationale |
|-----------|---------|-----------|-----------|
| `fileScore` | `log₁₀(fileCount+1) / log₁₀(5001) × 100` | 5,000 files | More files = harder to navigate the codebase |
| `langScore` | `min(languageCount / 10, 1) × 100` | 10 languages | Each language = a new toolchain to understand |
| `depScore` | `min(depFileCount / 5, 1) × 100` | 5 manifests | Multiple manifests = complex dependency graph |

**Dependency file patterns detected:**
`package.json`, `requirements.txt`, `Gemfile`, `pom.xml`, `build.gradle`, `Cargo.toml`, `go.mod`, `composer.json`, `pyproject.toml`, `setup.py`, `CMakeLists.txt`, `Makefile`

These are detected by scanning the full file tree (already cached from `getRepoTree()`), so **no extra API call** is needed.

---

### 5.3 Health Score (0–100) ★ Unique

Measures how **contributor-friendly** the repository is. This is the key innovation — a high health score lowers the effective learning barrier even for structurally complex codebases.

```
healthScore = sum of present signals
```

| Signal | Detection Path | Points | Why |
|--------|---------------|--------|-----|
| `CONTRIBUTING.md` | Root or `.github/CONTRIBUTING.md` | **+25** | Most critical onboarding document |
| CI/CD workflows | `.github/workflows/*.yml` | **+25** | Automated feedback loop for contributors |
| Issue templates | `.github/ISSUE_TEMPLATE/` directory | **+20** | Structured contribution guidance |
| `CODE_OF_CONDUCT.md` | Root or `.github/CODE_OF_CONDUCT.md` | **+15** | Welcoming community signal |
| `SECURITY.md` | Root or `.github/SECURITY.md` | **+10** | Mature governance signal |
| `CHANGELOG.md` | Root, `HISTORY.md`, or `CHANGELOG` | **+5** | Project history transparency |

**Maximum: 100 points**

All signals are detected by scanning the cached file tree — **no additional API calls**.

```typescript
export function calculateHealthScore(signals: HealthSignals): number {
  let score = 0;
  if (signals.hasContributing)   score += 25;
  if (signals.hasCICD)           score += 25;
  if (signals.hasIssueTemplates) score += 20;
  if (signals.hasCodeOfConduct)  score += 15;
  if (signals.hasSecurityPolicy) score += 10;
  if (signals.hasChangelog)      score += 5;
  return score;
}
```

**Design basis:** These signals map directly to GitHub's Community Standards checklist and CHAOSS project contributor experience metrics.

---

### 5.4 Bus Factor Score (0–100) ★ Unique

Measures how concentrated the contribution workload is. Named after the "bus factor" concept — how many contributors would need to be hit by a bus before the project stalls.

```
topContributorPct = top_contributor.contributions / total_contributions_of_top_10
busFactorScore    = (1 - topContributorPct) × 100
```

| `topContributorPct` | `busFactorScore` | Interpretation |
|--------------------|-----------------|----------------|
| 100% | 0 | Single-author; extreme risk |
| 80% | 20 | One dominant author |
| 50% | 50 | One lead, others contributing |
| 30% | 70 | Healthy distribution |
| ≤20% | ≥80 | Well-distributed, collaborative |

```typescript
export function calculateBusFactor(contributors: Contributor[]): {
  score: number;
  topContributorPct: number;
} {
  if (contributors.length === 0) return { score: 50, topContributorPct: 0 }; // unknown → neutral
  const total = contributors.reduce((sum, c) => sum + c.contributions, 0);
  if (total === 0) return { score: 50, topContributorPct: 0 };
  const topPct = contributors[0].contributions / total;
  return {
    score: Math.round((1 - topPct) * 100),
    topContributorPct: Math.round(topPct * 100),
  };
}
```

**Why it matters for difficulty:** A repo where one person makes 90% of commits is harder to contribute to because:
- Code style expectations are implicit and personal
- Review timelines depend on one person's bandwidth
- Contribution norms are undocumented

---

### 5.5 Combined Score & Difficulty Classification

```
combinedScore =
  activityScore          × 0.25  +
  complexityScore        × 0.45  +
  (100 - healthScore)    × 0.20  +   ← high health LOWERS difficulty
  (100 - busFactorScore) × 0.10      ← distributed contributions LOWER difficulty
```

**Weight rationale:**
- **Complexity (45%)** — primary driver; a large multi-language codebase is inherently hard to navigate
- **Activity (25%)** — active projects are more rewarding but also have more moving parts to track
- **Health penalty (20%)** — the most innovative weight. A complex repo with great docs and CI is genuinely more approachable than the same repo without them
- **Bus factor penalty (10%)** — single-author repos have implicit, undocumented norms

```typescript
export function classifyDifficulty(
  activityScore: number,
  complexityScore: number,
  healthScore: number,
  busFactorScore: number,
): Difficulty {
  const adjusted =
    complexityScore             * 0.45 +
    activityScore               * 0.25 +
    (100 - healthScore)         * 0.20 +
    (100 - busFactorScore)      * 0.10;

  if (adjusted < 30) return 'Beginner';
  if (adjusted < 60) return 'Intermediate';
  return 'Advanced';
}
```

| Combined Score | Difficulty | Typical Profile |
|---|---|---|
| 0–29 | **Beginner** | Small utility, good docs, active maintainers |
| 30–59 | **Intermediate** | Medium project, moderate complexity, some docs |
| 60–100 | **Advanced** | Large codebase, many languages, minimal contribution infrastructure |

---

## 6. Data Flow Diagram

```
Input (URL list)
      │
      ▼
parseRepoUrl()  ──→  invalid → { url, error }
      │
      ▼
┌─────────────────────────────────────────┐
│           PARALLEL BATCH 1              │
│  getRepoDetails()  ──┐                  │
│  getLanguages()    ──┤                  │
│  getContributorCount()─┤  Promise.all() │
│  getCommitActivity()──┤                 │
│  getTopContributors()─┘                 │
└─────────────┬───────────────────────────┘
              │  extract default_branch
              ▼
┌─────────────────────────────────────────┐
│           PARALLEL BATCH 2              │
│  getFileCount()      ─┐                 │
│  getDependencyFiles() ─┤── all share    │
│  getHealthSignals()  ─┘   ONE tree call │
└─────────────┬───────────────────────────┘
              │
              ▼
     calculateActivityScore()
     calculateComplexityScore()
     calculateHealthScore()
     calculateBusFactor()
              │
              ▼
     combinedScore + classifyDifficulty()
              │
              ▼
          RepoReport{}
              │
     ┌────────┴────────┐
     ▼                 ▼
  JSON API          HTML Report
  /analyze          /report
```

---

## 7. API Reference

### `GET /api` — Service index
Returns all available endpoints as JSON.

---

### `POST /analyze`

**Request:**
```json
{
  "urls": [
    "https://github.com/c2siorg/Webiu",
    "https://github.com/c2siorg/NFT-Toolbox"
  ]
}
```

**Constraints:** max 20 URLs per request

**Response:** Full `AnalysisResult` JSON

---

### `GET /analyze?urls=url1,url2`

**Query param:** `urls` — comma-separated GitHub URLs (max 20)

**Response:** Full `AnalysisResult` JSON

---

### `GET /analyze/org/:org`

**Path param:** `:org` — GitHub organisation name (e.g. `c2siorg`)
**Query param:** `limit` — max repos to analyze (default 20, max 30)

Fetches all public repos of the org sorted by `pushed_at` (most recently active first), then runs full analysis on each.

**Example:**
```
GET /analyze/org/c2siorg?limit=10
```

---

### `GET /report?urls=url1,url2`

Same as `GET /analyze` but returns a **rendered HTML page** with:
- Visual score bars for all 4 metrics
- Health signal badges
- Language breakdown bars
- Dependency file tags
- Print/PDF button

---

### `GET /report/org/:org`

HTML report for an entire GitHub organisation.

**Example:**
```
GET /report/org/c2siorg?limit=10
```

---

### Full JSON response structure

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
    "averageHealth": 72
  },
  "reports": [
    {
      "url": "https://github.com/c2siorg/Webiu",
      "owner": "c2siorg",
      "repo": "Webiu",
      "description": "C2SI Organization Website",
      "language": "TypeScript",
      "topics": ["angular", "nestjs", "gsoc"],
      "license": "Apache License 2.0",
      "archived": false,
      "metrics": {
        "stars": 68,
        "forks": 112,
        "openIssues": 24,
        "contributors": 52,
        "topContributorPct": 34,
        "languages": {
          "TypeScript": 312450,
          "HTML": 21340,
          "SCSS": 18200,
          "JavaScript": 4100
        },
        "languageCount": 4,
        "fileCount": 284,
        "dependencyFiles": [
          "package.json",
          "webiu-server/package.json"
        ],
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
      "analysedAt": "2026-03-31T10:00:00.000Z"
    }
  ],
  "rateLimit": {
    "remaining": 4821,
    "limit": 5000,
    "resetAt": "2026-03-31T11:00:00.000Z"
  }
}
```

---

## 8. Frontend

Located at `public/index.html` — a single self-contained HTML file, no framework, no build step.

### Features

| Feature | Implementation |
|---------|---------------|
| Repository tab | Paste URLs (one per line, max 10), pre-filled with c2siorg examples |
| Organisation tab | Enter org name (e.g. `c2siorg`), analyzes 20 most recent repos |
| Result cards | Full details: stats, 4 score bars with descriptions, health signals, language bars, dependency tags |
| Download HTML Report | Fetches `/report` endpoint and saves `.html` file via Blob URL |
| Download JSON | Saves raw `AnalysisResult` as `.json` file |
| Rate limit display | Shows GitHub API remaining quota after each analysis |
| Error handling | Per-repo error cards shown inline |
| Responsive | Works on mobile via CSS Grid breakpoints |

### Download mechanism

```javascript
async function downloadHtmlReport() {
  const endpoint = _lastUrlsOrOrg.startsWith('org/')
    ? `/report/${_lastUrlsOrOrg}`
    : `/report?urls=${encodeURIComponent(_lastUrlsOrOrg)}`;
  const res = await fetch(endpoint);
  const html = await res.text();
  const blob = new Blob([html], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'repo-intelligence-report.html';
  a.click();
}
```

The downloaded HTML report is **fully self-contained** — it includes all CSS inline and renders correctly offline.

---

## 9. Rate Limit Handling & Efficiency

### API calls per repository

| Call | Endpoint | Note |
|------|---------|------|
| 1 | `GET /repos/{owner}/{repo}` | Core metadata |
| 2 | `GET /repos/{owner}/{repo}/languages` | Language breakdown |
| 3 | `GET /repos/{owner}/{repo}/contributors?per_page=1` | Total count via Link header |
| 4 | `GET /repos/{owner}/{repo}/contributors?per_page=10` | Top 10 for bus factor |
| 5 | `GET /repos/{owner}/{repo}/stats/commit_activity` | Weekly commits |
| 6 | `GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1` | **Shared**: file count + dep detection + health signals |

**Net: 6 calls per repository.** Previously 7+ (tree was fetched separately for file count and dependency detection).

### Rate limit budget

| Mode | Budget | Repos per hour |
|------|--------|----------------|
| Unauthenticated | 60 req/hr | ~5 repos |
| Authenticated (PAT) | 5,000 req/hr | ~400 repos |

### Cache behaviour

```
First request for repo X:   6 API calls → results cached for 5 minutes
Second request (within 5m): 0 API calls → served from cache
```

### Retry strategy

| Error | Action |
|-------|--------|
| 429 (rate limited) | Wait for `Retry-After` header value, then retry |
| 403 (forbidden/limit) | Same as 429 |
| 5xx (server error) | Exponential back-off: 300ms → 600ms → 1200ms |
| 404 (not found) | No retry — return error immediately |
| 409 (empty repo) | No retry — return error immediately |
| Timeout (20s) | Treated as transient, retried with back-off |

### Rate limit in response

Every analysis response includes current rate limit status:
```json
"rateLimit": {
  "remaining": 4821,
  "limit": 5000,
  "resetAt": "2026-03-31T11:00:00.000Z"
}
```

---

## 10. Edge Case Handling

| Scenario | What happens |
|----------|-------------|
| Invalid URL | Immediately returns `{ url, error: "Invalid GitHub repository URL." }` |
| Repository not found (404) | Returns `{ url, error: "Request failed with status code 404" }` |
| Empty repository (no commits) | All sub-scores = 0; difficulty = Beginner |
| Archived repository | Analyzed identically; `archived: true` in output — consumers can filter |
| `stats/commit_activity` returns 202 | GitHub is computing stats asynchronously; returns `recentCommits = 0`. Re-running after a few seconds returns populated data |
| Single contributor (bus factor 1.0) | `busFactorScore = 0`; reflected in combined score |
| No language data returned | `languages = {}`, `languageCount = 0`, `langScore = 0` |
| No dependency files found | `dependencyFiles = []`, `depScore = 0` |
| No health files found | `healthScore = 0`; this *increases* difficulty (correct behaviour) |
| Rate limit exhausted mid-batch | Individual repo fails with 403; error returned for that repo only; rest of batch continues |
| Private repo without token | 404 → error entry in report |
| Monorepo with multiple `package.json` | All matched — intentional, monorepos are more complex |
| Missing `contributors` data | Returns 0 gracefully via `.catch(() => 0)` |

---

## 11. Sample Outputs

Analyses run on 5 c2siorg repositories:

| Repository | Activity | Complexity | Health | Bus Factor | Combined | Difficulty |
|---|---|---|---|---|---|---|
| [c2siorg/Webiu](https://github.com/c2siorg/Webiu) | 55 | 44 | 85 | 66 | 38 | Intermediate |
| [c2siorg/SCoRE](https://github.com/c2siorg/SCoRE) | 36 | 32 | 60 | 45 | 36 | Intermediate |
| [c2siorg/RoadMap](https://github.com/c2siorg/RoadMap) | 14 | 5 | 40 | 30 | 21 | Beginner |
| [c2siorg/codefactor](https://github.com/c2siorg/codefactor) | 67 | 52 | 75 | 58 | 44 | Intermediate |
| [c2siorg/NFT-Toolbox](https://github.com/c2siorg/NFT-Toolbox) | 53 | 57 | 70 | 62 | 46 | Intermediate |

Full JSON: [`docs/sample-analyses.json`](sample-analyses.json)

### Interpreting the scores — c2siorg/Webiu example

- **Activity 55** — 34 commits in the last 4 weeks, 68 stars, 112 forks, 52 contributors. Moderately active.
- **Complexity 44** — 284 files across 4 languages with 2 dependency manifests. Medium complexity.
- **Health 85** — Has CONTRIBUTING.md ✓, CI/CD ✓, issue templates ✓, CODE_OF_CONDUCT.md ✓. Very contributor-friendly.
- **Bus Factor 66** — Top contributor makes 34% of commits. Healthy distribution for an OSS project.
- **Combined 38** — Despite moderate complexity, the strong health score lowers the combined score significantly. The repo is more approachable than its raw complexity suggests.
- **Difficulty: Intermediate** — Complex enough to challenge newcomers but well-documented enough to be accessible.

---

## 12. How to Run Locally

### Prerequisites
- Node.js ≥ 18
- npm ≥ 9
- A GitHub Personal Access Token (optional but recommended)

### Installation

```bash
git clone https://github.com/Hari20032005/repo-intelligence-analyzer.git
cd repo-intelligence-analyzer
npm install
```

### Configuration

```bash
cp .env.example .env
```

Edit `.env`:
```
GITHUB_ACCESS_TOKEN=ghp_your_token_here
PORT=3000
```

### Running

```bash
# Development (ts-node with hot reload)
npm run dev

# Production build
npm run build
npm start
```

Server starts at `http://localhost:3000`.

### CLI usage

```bash
# Analyze one or more repos from terminal
npm run analyze https://github.com/c2siorg/Webiu https://github.com/c2siorg/SCoRE

# Output is JSON — pipe to jq for readability
npm run analyze https://github.com/c2siorg/Webiu | jq '.reports[0].scores'
```

### API usage (curl examples)

```bash
# Analyze specific repos
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -d '{"urls":["https://github.com/c2siorg/Webiu","https://github.com/c2siorg/SCoRE"]}'

# Analyze via GET
curl "http://localhost:3000/analyze?urls=https://github.com/c2siorg/Webiu"

# Analyze entire organisation
curl "http://localhost:3000/analyze/org/c2siorg?limit=10"

# Get HTML report (open in browser)
open "http://localhost:3000/report?urls=https://github.com/c2siorg/Webiu"

# Org HTML report
open "http://localhost:3000/report/org/c2siorg?limit=10"
```

---

## 13. Deployment

### Render.com (current deployment)

**Live URL:** https://repo-intelligence-analyzer.onrender.com

The `render.yaml` in the repo root configures the deployment automatically:

```yaml
services:
  - type: web
    name: repo-intelligence-analyzer
    env: node
    buildCommand: npm install
    startCommand: npm start
    envVars:
      - key: GITHUB_ACCESS_TOKEN
        sync: false
```

**Deploy steps:**
1. Fork the repository
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your fork
4. Add environment variable: `GITHUB_ACCESS_TOKEN=ghp_your_token`
5. Click Deploy — Render detects `render.yaml` automatically

**Note on free tier:** Render free tier instances spin down after 15 minutes of inactivity and take ~30 seconds to wake up on first request.

---

## 14. Technology Choices

| Component | Technology | Reason |
|-----------|-----------|--------|
| **Language** | TypeScript | Type safety for complex data structures (RepoReport, scoring functions); compile-time error detection |
| **Runtime** | Node.js ≥ 18 | Native fetch, async/await, broad hosting support |
| **HTTP client** | axios | Interceptors for retry logic; response header access for rate limit detection |
| **Web framework** | Express | Minimal, fast, well-known; sufficient for a focused API tool |
| **CORS** | `cors` middleware | Allows frontend to call the API from any origin |
| **Environment** | `dotenv` | Standard `.env` file loading for the GitHub token |
| **Frontend** | Vanilla HTML/CSS/JS | No build step needed; instant deploy; no dependency on npm for UI changes |
| **Build** | TypeScript compiler (`tsc`) | Compiles to `dist/` for production; `ts-node` for development |
| **Deployment** | Render.com | Free tier, auto-deploy from GitHub, supports environment variables |

---

## 15. Assumptions & Limitations

### Assumptions

1. **Logarithmic scaling** is appropriate for stars/forks/contributors because the marginal difficulty increase from 1,000 to 2,000 stars is much less than from 10 to 20.

2. **Complexity is weighted higher than activity** (0.45 vs 0.25) because structural complexity is a persistent barrier to contribution, while activity level fluctuates and doesn't directly determine how hard it is to understand the codebase.

3. **Health signals are presence-based, not content-quality-based.** A placeholder `CONTRIBUTING.md` scores the same as a comprehensive guide. Quality assessment would require reading file contents, consuming additional API quota and adding significant complexity.

4. **Bus factor calculation uses top-10 contributors only.** For very large projects (Linux, Chromium) fetching all contributors would exhaust the rate limit. Top-10 is sufficient for relative ranking.

5. **Commit stats async delay is acceptable.** The `/stats/commit_activity` endpoint returns HTTP 202 on first call while GitHub computes the stats. The tool returns `recentCommits = 0` and produces a conservative (lower activity) score. Re-running after a few seconds yields the actual data.

### Known Limitations

| Limitation | Impact | Workaround |
|-----------|--------|-----------|
| `stats/commit_activity` may return 202 | `recentCommits = 0` on first run | Re-run the analysis after a few seconds |
| Bus factor only counts commits, not PRs/reviews | May underestimate diversity in projects with active non-committer maintainers | Future: use PR review data |
| Health signals are presence-only | A stub `CONTRIBUTING.md` scores the same as a comprehensive one | Future: check file size as quality proxy |
| Monorepo `package.json` inflation | Multiple workspace `package.json` files inflate depScore | Intentional — monorepos are more complex |
| File count includes generated files | Repos that commit `dist/` or `node_modules/` score higher complexity than their source warrants | Future: filter by `.gitignore` |
| No historical trending | Point-in-time analysis only; can't detect dead projects reviving | Future: MongoDB time-series storage |
| Rate limit without token | 60 req/hr → ~5 repos max | Set `GITHUB_ACCESS_TOKEN` in `.env` |
| In-memory cache lost on restart | Re-analysis of same repos costs API calls after server restart | Future: Redis persistent cache |
