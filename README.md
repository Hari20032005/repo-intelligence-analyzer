# GitHub Repository Intelligence Analyzer

> Pre-GSoC 2026 Task 2 submission for [c2siorg/Webiu #541](https://github.com/c2siorg/Webiu/issues/541)

Analyzes GitHub repositories and generates structured reports covering **activity score**, **complexity score**, and **learning difficulty classification** (Beginner / Intermediate / Advanced).

**Live Demo:** `https://repo-intelligence-analyzer.onrender.com`

---

## Quick Start

### Prerequisites
- Node.js ≥ 18
- A GitHub personal access token *(optional but recommended — raises rate limit from 60 to 5000 req/hour)*

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

## API Usage

### `GET /` — Health check
```bash
curl http://localhost:3000/
```

### `POST /analyze` — Analyze repositories

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

### `GET /analyze?urls=` — Quick single/multiple analysis

```bash
curl "http://localhost:3000/analyze?urls=https://github.com/c2siorg/Webiu,https://github.com/c2siorg/SCoRE"
```

### Response structure

```json
{
  "summary": {
    "total": 2,
    "beginner": 0,
    "intermediate": 2,
    "advanced": 0,
    "averageActivity": 54,
    "averageComplexity": 48
  },
  "reports": [
    {
      "url": "https://github.com/c2siorg/Webiu",
      "owner": "c2siorg",
      "repo": "Webiu",
      "description": "C2SI Organization Website",
      "language": "TypeScript",
      "topics": ["angular", "nestjs"],
      "metrics": {
        "stars": 68,
        "forks": 112,
        "openIssues": 24,
        "contributors": 52,
        "languages": { "TypeScript": 312450, "HTML": 21340 },
        "languageCount": 6,
        "fileCount": 284,
        "dependencyFiles": ["package.json", "webiu-server/package.json"],
        "recentCommits": 34
      },
      "scores": {
        "activityScore": 55,
        "complexityScore": 44,
        "combinedScore": 48
      },
      "difficulty": "Intermediate",
      "analysedAt": "2026-03-14T10:00:00.000Z"
    }
  ]
}
```

---

## CLI Usage

```bash
# Analyze one or more repos directly from the terminal
npm run analyze https://github.com/c2siorg/Webiu https://github.com/c2siorg/SCoRE
```

---

## Scoring Overview

| Score | Formula | Range |
|---|---|---|
| **Activity** | `(recentCommits×0.4) + (stars×0.2) + (forks×0.15) + (issues×0.15) + (contributors×0.1)` | 0–100 |
| **Complexity** | `(fileCount×0.4) + (languageCount×0.3) + (depFiles×0.3)` | 0–100 |
| **Combined** | `activity×0.4 + complexity×0.6` | 0–100 |

**Difficulty:** Combined < 30 → Beginner · < 60 → Intermediate · ≥ 60 → Advanced

Full methodology: [`docs/scoring-methodology.md`](docs/scoring-methodology.md)

---

## Sample Analyses

Pre-generated reports for 5 c2siorg repositories are available in [`docs/sample-analyses.json`](docs/sample-analyses.json).

| Repository | Activity | Complexity | Difficulty |
|---|---|---|---|
| c2siorg/Webiu | 55 | 44 | Intermediate |
| c2siorg/SCoRE | 36 | 32 | Intermediate |
| c2siorg/RoadMap | 14 | 5 | Beginner |
| c2siorg/codefactor | 67 | 52 | Intermediate |
| c2siorg/NFT-Toolbox | 53 | 57 | Intermediate |

---

## Architecture (Task 1)

See [`docs/architecture.md`](docs/architecture.md) for the full scalable GitHub data aggregation system design covering:
- Two-tier caching (in-process + Redis)
- Webhook-driven cache invalidation
- Rate-limit handling with exponential back-off
- Scalability from 300 → 10 000 repositories

---

## Deployment on Render (Free)

1. Fork this repo
2. Go to [render.com](https://render.com) → New → Web Service → connect your fork
3. Set environment variable: `GITHUB_ACCESS_TOKEN=ghp_your_token`
4. Deploy — Render uses `render.yaml` automatically

---

## Rate Limit Handling

- All API responses are cached in-memory for 5 minutes — repeated requests for the same repo cost zero additional API calls.
- Unauthenticated: 60 req/hour (enough for ~5 repos per run).
- With a token: 5 000 req/hour (enough for 100+ repos per run).
- GitHub's `/stats/commit_activity` may return HTTP 202 on first request (data is computing). The tool gracefully returns 0 recent commits and the cached result populates on the next request.

---

## Project Structure

```
src/
├── github.ts      — GitHub API client with in-memory caching
├── scorer.ts      — Activity score, complexity score, difficulty classification
├── analyzer.ts    — Orchestrates analysis for one or many repos
├── server.ts      — Express API server (POST /analyze, GET /analyze)
└── cli.ts         — CLI entry point
docs/
├── architecture.md          — Task 1: scalable system design
├── scoring-methodology.md   — Formulas, assumptions, limitations
└── sample-analyses.json     — Pre-generated reports for 5 repos
```
