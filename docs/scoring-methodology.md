# Scoring Methodology

## Overview

The analyzer computes **four independent scores** per repository, then combines them into a single `combinedScore` that drives the `difficulty` classification.

| Score | Range | What it measures |
|---|---|---|
| **Activity Score** | 0–100 | How actively the repository is used and maintained |
| **Complexity Score** | 0–100 | How structurally large and technically diverse the codebase is |
| **Health Score** | 0–100 | How contributor-friendly the repository is |
| **Bus Factor Score** | 0–100 | How distributed the contribution workload is |
| **Combined Score** | 0–100 | Weighted composite driving difficulty classification |

---

## Activity Score (0–100)

Measures vitality: is this project being actively developed and used?

```
activityScore = clamp(
  recentCommitScore × 0.40 +
  starScore         × 0.20 +
  forkScore         × 0.15 +
  issueScore        × 0.15 +
  contribScore      × 0.10
, 0, 100)
```

### Sub-scores

| Sub-score | Formula | 100-point cap | Rationale |
|---|---|---|---|
| `recentCommitScore` | `min(recentCommits / 200, 1) × 100` | 200 commits in 4 weeks | Linear; most repos plateau well below 200/month |
| `starScore` | `log₁₀(stars+1) / log₁₀(10001) × 100` | 10 000 stars | Log scale prevents mega-repos dominating |
| `forkScore` | `log₁₀(forks+1) / log₁₀(1001) × 100` | 1 000 forks | Log scale |
| `issueScore` | `log₁₀(openIssues+1) / log₁₀(501) × 100` | 500 open issues | Proxy for community engagement |
| `contribScore` | `log₁₀(contributors+1) / log₁₀(201) × 100` | 200 contributors | Proxy for contribution diversity |

**Weight rationale:**
- Recent commits (40%) — most direct signal of activity; stars/forks are historical accumulations
- Stars/forks (35% combined) — adoption and interest signals
- Issues/contributors (25% combined) — community engagement and diversity

---

## Complexity Score (0–100)

Measures how much cognitive load a new contributor must absorb.

```
complexityScore = clamp(
  fileScore × 0.40 +
  langScore × 0.30 +
  depScore  × 0.30
, 0, 100)
```

### Sub-scores

| Sub-score | Formula | 100-point cap | Rationale |
|---|---|---|---|
| `fileScore` | `log₁₀(fileCount+1) / log₁₀(5001) × 100` | 5 000 files | Log scale; 5k files is a very large codebase |
| `langScore` | `min(languageCount / 10, 1) × 100` | 10 languages | Each additional language = new toolchain to learn |
| `depScore` | `min(depFileCount / 5, 1) × 100` | 5 dependency manifests | Multiple manifests = polyglot/monorepo complexity |

**Recognised dependency manifests:**
`package.json`, `requirements.txt`, `Gemfile`, `pom.xml`, `build.gradle`, `Cargo.toml`, `go.mod`, `composer.json`, `pyproject.toml`, `setup.py`, `CMakeLists.txt`, `Makefile`

---

## Health Score (0–100) ★ New in v2

Measures how well the repository supports new contributors. A high health score indicates the maintainers have invested in documentation, automation, and community infrastructure — all of which directly reduce the learning barrier.

```
healthScore = sum of matched signals
```

| Signal | Points | Why it matters |
|---|---|---|
| `CONTRIBUTING.md` | +25 | Critical onboarding document; explains how to submit PRs, run tests |
| CI/CD (`.github/workflows/*.yml`) | +25 | Automated feedback loop; contributors know immediately if they broke something |
| Issue templates (`.github/ISSUE_TEMPLATE/`) | +20 | Structured contribution guidance; shows maintainers care about process |
| `CODE_OF_CONDUCT.md` | +15 | Safe community signal; predicts welcoming review culture |
| `SECURITY.md` | +10 | Responsible disclosure policy; sign of mature project governance |
| `CHANGELOG.md` | +5 | History visibility; helps new contributors understand project evolution |

**Maximum: 100 points.**

**Design note:** These signals directly map to GitHub's Community Standards checklist and the CHAOSS project's contributor experience metrics.

---

## Bus Factor Score (0–100) ★ New in v2

Measures how concentrated the contribution workload is. A repository where one person makes 90% of all commits is fragile for learners — the single author may have limited review bandwidth, code style may be implicit, and contribution expectations may be undocumented.

```
topContributorPct = top_contributor.contributions / total_contributions_top10
busFactorScore = (1 - topContributorPct) × 100
```

| `topContributorPct` | `busFactorScore` | Interpretation |
|---|---|---|
| 100% | 0 | Single-author project; very high bus-factor risk |
| 80% | 20 | One dominant author |
| 50% | 50 | One strong lead, others contributing |
| 30% | 70 | Healthy distribution |
| ≤20% | ≥80 | Well-distributed; collaborative codebase |

**Data source:** Top 10 contributors via `/repos/{owner}/{repo}/contributors?per_page=10`.

**Limitation:** Only commit-based contributions are counted. PR reviews, issue triage, and documentation contributions are not reflected. Projects with active non-committer maintainers may appear to have a higher bus-factor risk than they actually do.

---

## Combined Score & Difficulty Classification

```
combinedScore =
  activityScore          × 0.25 +
  complexityScore        × 0.45 +
  (100 - healthScore)    × 0.20 +   ← high health LOWERS difficulty
  (100 - busFactorScore) × 0.10     ← distributed contributions LOWER difficulty
```

**Thresholds:**

| Combined score | Difficulty | Typical profile |
|---|---|---|
| 0–29 | **Beginner** | Small utility, active maintainers, good docs |
| 30–59 | **Intermediate** | Medium project, some docs, moderate complexity |
| 60–100 | **Advanced** | Large codebase, many languages, minimal contribution infrastructure |

**Design rationale:**
- Complexity (45%) is the primary driver.
- Activity (25%) reflects that active projects have more review bandwidth but also more moving parts to track.
- Health penalty (20%) rewards repositories that invest in contributor experience — good docs and CI lower the effective learning barrier for even structurally complex codebases.
- Bus factor penalty (10%) slightly penalises single-author projects where contribution norms are informal.

---

## API Efficiency

### Calls per repository

| Call | Endpoint | Shared? |
|---|---|---|
| Repo details | `GET /repos/{owner}/{repo}` | — |
| Languages | `GET /repos/{owner}/{repo}/languages` | — |
| Contributor count | `GET /repos/{owner}/{repo}/contributors?per_page=1` | — |
| Top contributors | `GET /repos/{owner}/{repo}/contributors?per_page=10` | — |
| Commit activity | `GET /repos/{owner}/{repo}/stats/commit_activity` | — |
| Repo tree | `GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1` | **Shared: file count + dep detection + health signals** |

**Net: 6 API calls per repository.** The git tree is fetched once and cached in-memory, then reused for file count, dependency file detection, and health signal detection (previously 7+ calls with duplicate tree fetches).

### In-memory cache

All responses cached for **5 minutes** (in-process `Map`). Repeated requests for the same repository within that window cost **zero additional API calls**. Retry logic with exponential back-off handles transient GitHub API failures (429/5xx) transparently.

---

## Edge Case Handling

| Scenario | Handling |
|---|---|
| Empty repository | All sub-scores = 0; difficulty = Beginner |
| Commit stats computing (HTTP 202) | `recentCommits = 0`; re-run after a few seconds |
| Archived repository | Analyzed identically; `archived: true` flag in output |
| Single contributor | `busFactorScore = 0`; noted in output |
| No language data | `languageCount = 0`; `langScore = 0` |
| Rate limit exhausted | Exponential back-off + retry; returns partial results |
| Invalid URL | `{ url, error: "Invalid GitHub repository URL." }` |
| Private repo without token | HTTP 404 → error entry in report |
| Monorepo (multiple `package.json`) | Multiple files counted; intentional — monorepos are more complex |

---

## Assumptions

1. **Logarithmic scaling** prevents outliers (linux/linux: 150k stars; torvalds/linux: 1M+ commits) from making scores meaningless for mid-tier repositories.
2. **Complexity weighted above activity** in the combined score because structural complexity is a more persistent learning barrier than activity level.
3. **Health signals are presence-based**, not content-quality-based. A placeholder `CONTRIBUTING.md` scores the same as a comprehensive guide. This is a deliberate trade-off: quality assessment would require reading file content and consuming additional API quota.
4. **Bus factor uses top-10 contributors** only. For large projects (Linux, Chromium) the true distribution requires fetching all contributors, which is expensive. The top-10 approximation is sufficient for relative ranking.
