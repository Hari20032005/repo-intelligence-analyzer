import { CommitActivity } from './github';

/**
 * ACTIVITY SCORE (0–100)
 *
 * Formula:
 *   activityScore = clamp(
 *     (recentCommits * 0.40) +
 *     (starScore     * 0.20) +
 *     (forkScore     * 0.15) +
 *     (issueScore    * 0.15) +
 *     (contribScore  * 0.10)
 *   , 0, 100)
 *
 * Each sub-score is normalised to [0, 100] using soft caps.
 *
 * Sub-score details:
 *   recentCommits  — total commits in the last 4 weeks (cap 200 → score 100)
 *   starScore      — log10(stars + 1) / log10(10001) * 100  (10 000 stars → 100)
 *   forkScore      — log10(forks + 1) / log10(1001) * 100   (1 000 forks → 100)
 *   issueScore     — log10(openIssues + 1) / log10(501) * 100 (500 issues → 100)
 *   contribScore   — log10(contributors + 1) / log10(201) * 100 (200 contributors → 100)
 *
 * Assumptions:
 *   - A project with 200+ commits/month, 10 000 stars, 1 000 forks,
 *     500 open issues, and 200 contributors is considered maximally active.
 *   - Logarithmic scaling prevents outliers from dominating.
 */
export function calculateActivityScore(
  commitActivity: CommitActivity[],
  stars: number,
  forks: number,
  openIssues: number,
  contributors: number,
): number {
  // Recent commits: sum of last 4 weeks
  const recentCommits = commitActivity
    .slice(-4)
    .reduce((sum, w) => sum + (w.total ?? 0), 0);

  const cap = (value: number, max: number): number =>
    Math.min(100, (value / max) * 100);

  const logScore = (value: number, softCap: number): number =>
    (Math.log10(value + 1) / Math.log10(softCap + 1)) * 100;

  const recentCommitScore = cap(recentCommits, 200);
  const starScore         = logScore(stars, 10000);
  const forkScore         = logScore(forks, 1000);
  const issueScore        = logScore(openIssues, 500);
  const contribScore      = logScore(contributors, 200);

  const raw =
    recentCommitScore * 0.40 +
    starScore         * 0.20 +
    forkScore         * 0.15 +
    issueScore        * 0.15 +
    contribScore      * 0.10;

  return Math.round(Math.min(100, Math.max(0, raw)));
}

/**
 * COMPLEXITY SCORE (0–100)
 *
 * Formula:
 *   complexityScore = clamp(
 *     (fileScore     * 0.40) +
 *     (langScore     * 0.30) +
 *     (depScore      * 0.30)
 *   , 0, 100)
 *
 * Sub-score details:
 *   fileScore  — log10(fileCount + 1) / log10(5001) * 100  (5 000 files → 100)
 *   langScore  — (languageCount / 10) * 100                (10+ languages → 100)
 *   depScore   — (depFileCount / 5) * 100                  (5+ dep files → 100)
 *
 * Assumptions:
 *   - Repositories with 5 000+ files are considered maximally complex.
 *   - Using 10+ programming languages signals high complexity.
 *   - Having 5+ distinct dependency manifest files indicates a complex
 *     dependency graph (e.g., monorepo with mixed tech stacks).
 */
export function calculateComplexityScore(
  fileCount: number,
  languages: Record<string, number>,
  dependencyFiles: string[],
): number {
  const languageCount = Object.keys(languages).length;
  const depFileCount  = dependencyFiles.length;

  const fileScore = (Math.log10(fileCount + 1) / Math.log10(5001)) * 100;
  const langScore = Math.min(100, (languageCount / 10) * 100);
  const depScore  = Math.min(100, (depFileCount / 5) * 100);

  const raw =
    fileScore * 0.40 +
    langScore * 0.30 +
    depScore  * 0.30;

  return Math.round(Math.min(100, Math.max(0, raw)));
}

/**
 * DIFFICULTY CLASSIFICATION
 *
 * Combined score = activityScore * 0.4 + complexityScore * 0.6
 * (Complexity weighted higher as it better reflects learning curve.)
 *
 *   combined < 30  → Beginner
 *   combined < 60  → Intermediate
 *   combined >= 60 → Advanced
 */
export type Difficulty = 'Beginner' | 'Intermediate' | 'Advanced';

export function classifyDifficulty(
  activityScore: number,
  complexityScore: number,
): Difficulty {
  const combined = activityScore * 0.4 + complexityScore * 0.6;
  if (combined < 30) return 'Beginner';
  if (combined < 60) return 'Intermediate';
  return 'Advanced';
}
