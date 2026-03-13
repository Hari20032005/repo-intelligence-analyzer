# Scoring Methodology

## Activity Score (0–100)

Measures how actively a repository is maintained and used.

### Formula

```
activityScore = (recentCommitScore × 0.40)
              + (starScore         × 0.20)
              + (forkScore         × 0.15)
              + (issueScore        × 0.15)
              + (contribScore      × 0.10)
```

### Sub-scores

| Sub-score | Source | Normalisation | Cap (→ 100) |
|---|---|---|---|
| `recentCommitScore` | Total commits in last 4 weeks | linear | 200 commits |
| `starScore` | `stargazers_count` | log₁₀ | 10 000 stars |
| `forkScore` | `forks_count` | log₁₀ | 1 000 forks |
| `issueScore` | `open_issues_count` | log₁₀ | 500 issues |
| `contribScore` | contributors via API | log₁₀ | 200 contributors |

**Why logarithmic scaling?**
Popular repositories like `linux/linux` (150k+ stars) would otherwise completely dwarf everything else. Log scaling compresses the tail and keeps scores meaningful across the full spectrum.

**Why 4-week commit window?**
GitHub's `/stats/commit_activity` returns 52 weeks of weekly totals. The last 4 weeks gives a rolling 28-day view that reflects current maintenance activity without being misled by historical burst work.

---

## Complexity Score (0–100)

Estimates the structural complexity and cognitive load of a repository.

### Formula

```
complexityScore = (fileScore × 0.40)
                + (langScore × 0.30)
                + (depScore  × 0.30)
```

### Sub-scores

| Sub-score | Source | Normalisation | Cap (→ 100) |
|---|---|---|---|
| `fileScore` | File count from git tree (blobs only) | log₁₀ | 5 000 files |
| `langScore` | Number of distinct languages | linear | 10 languages |
| `depScore` | Count of dependency manifest files | linear | 5 files |

**Dependency file patterns recognised:**
`package.json`, `requirements.txt`, `Gemfile`, `pom.xml`, `build.gradle`,
`Cargo.toml`, `go.mod`, `composer.json`, `pyproject.toml`, `setup.py`,
`CMakeLists.txt`, `Makefile`

**Why file count over lines of code?**
GitHub's tree API is accessible without special permissions and file count is a reasonable proxy for codebase breadth. Lines of code require fetching every file's content, which exhausts rate limits quickly.

---

## Difficulty Classification

```
combinedScore = activityScore × 0.4 + complexityScore × 0.6
```

| Combined Score | Classification |
|---|---|
| 0 – 29 | **Beginner** |
| 30 – 59 | **Intermediate** |
| 60 – 100 | **Advanced** |

Complexity is weighted higher (0.6) because it better reflects the cognitive effort needed to contribute to a repository. A highly active but simple repo is still approachable; a complex but quiet repo is harder to navigate.

---

## Limitations

1. **Commit stats may be empty on first request** — GitHub computes `/stats/commit_activity` asynchronously and returns HTTP 202 on the first call. The tool treats this as zero recent commits. Rerunning after a few seconds yields full data.
2. **Monorepos** — A monorepo with many top-level `package.json` files will score higher on `depScore` than a true multi-dependency project with a single manifest.
3. **Private repositories** — All metrics require a GitHub token with `repo` scope. Without a token, only public repositories can be analysed and requests are rate-limited to 60/hour per IP.
4. **Archived repositories** — The tool analyses archived repos the same as active ones. The `archived` field in the report can be used to filter these out downstream.
5. **Organisation-level activity** — The tool analyses per-repository. It does not account for activity distributed across multiple related repos (e.g. microservice monorepos split across repos).
