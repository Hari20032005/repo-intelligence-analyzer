import { CommitActivity, Contributor, HealthSignals } from './github';

/**
 * ACTIVITY SCORE (0–100)
 *
 * Formula:
 *   activityScore = clamp(
 *     (recentCommitScore × 0.40) +
 *     (starScore         × 0.20) +
 *     (forkScore         × 0.15) +
 *     (issueScore        × 0.15) +
 *     (contribScore      × 0.10)
 *   , 0, 100)
 *
 * Sub-score normalisation:
 *   recentCommitScore — linear cap at 200 commits/4-weeks = 100
 *   starScore         — log₁₀(stars+1) / log₁₀(10001) × 100
 *   forkScore         — log₁₀(forks+1) / log₁₀(1001)  × 100
 *   issueScore        — log₁₀(issues+1) / log₁₀(501)   × 100
 *   contribScore      — log₁₀(contributors+1) / log₁₀(201) × 100
 *
 * Logarithmic scaling prevents outliers (e.g. linux/linux with 150k stars)
 * from dominating scores for mid-tier repositories.
 */
export function calculateActivityScore(
  commitActivity: CommitActivity[],
  stars: number,
  forks: number,
  openIssues: number,
  contributors: number,
): number {
  const recentCommits = commitActivity
    .slice(-4)
    .reduce((sum, w) => sum + (w.total ?? 0), 0);

  const cap = (value: number, max: number): number =>
    Math.min(100, (value / max) * 100);

  const logScore = (value: number, softCap: number): number =>
    (Math.log10(value + 1) / Math.log10(softCap + 1)) * 100;

  const raw =
    cap(recentCommits, 200)  * 0.40 +
    logScore(stars, 10000)   * 0.20 +
    logScore(forks, 1000)    * 0.15 +
    logScore(openIssues, 500)* 0.15 +
    logScore(contributors, 200) * 0.10;

  return Math.round(Math.min(100, Math.max(0, raw)));
}

/**
 * COMPLEXITY SCORE (0–100)
 *
 * Formula:
 *   complexityScore = clamp(
 *     (fileScore × 0.40) +
 *     (langScore × 0.30) +
 *     (depScore  × 0.30)
 *   , 0, 100)
 *
 * Sub-score details:
 *   fileScore — log₁₀(fileCount+1) / log₁₀(5001) × 100  (5 000 files → 100)
 *   langScore — (languageCount / 10) × 100               (10+ languages → 100)
 *   depScore  — (depFileCount / 5) × 100                 (5+ manifest files → 100)
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
 * HEALTH SCORE (0–100)
 *
 * Measures how contributor-friendly and well-maintained a repository is.
 * A high health score lowers the effective learning barrier — even a
 * structurally complex repo becomes approachable with good documentation,
 * issue templates, and automated CI that gives instant feedback.
 *
 * Scoring breakdown:
 *   CONTRIBUTING.md     → +25 pts  (critical onboarding path for new contributors)
 *   CI/CD workflows     → +25 pts  (automated feedback loop crucial for contributors)
 *   Issue templates     → +20 pts  (structured contribution guidance)
 *   CODE_OF_CONDUCT.md  → +15 pts  (safe community signal)
 *   SECURITY.md         → +10 pts  (responsible disclosure policy)
 *   CHANGELOG.md        → + 5 pts  (history visibility)
 *
 * Total = 100 pts
 *
 * Assumption: these signals strongly correlate with OSS "contributor-friendliness"
 * as defined by the CHAOSS project and GitHub's own Community Standards checklist.
 */
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

/**
 * BUS FACTOR SCORE (0–100)
 *
 * Measures how distributed the contribution workload is.
 * Low concentration (many contributors sharing work) → high score.
 * High concentration (one person does 90%+ of commits) → low score.
 *
 * Formula:
 *   topPct = topContributor.contributions / totalContributions (0–1)
 *   busFactorScore = (1 - topPct) × 100
 *
 * Examples:
 *   1 contributor  → topPct = 1.00 → score = 0   (extreme bus-factor risk)
 *   Top person = 80% → topPct = 0.80 → score = 20
 *   Top person = 30% → topPct = 0.30 → score = 70 (healthy distribution)
 *
 * Why this matters for learning difficulty:
 *   A repo dominated by a single author is harder to contribute to — code style
 *   is less documented, PR review expectations are personal rather than codified,
 *   and the single maintainer may have limited bandwidth for new contributors.
 */
export function calculateBusFactor(contributors: Contributor[]): {
  score: number;
  topContributorPct: number;
} {
  if (contributors.length === 0) {
    return { score: 50, topContributorPct: 0 }; // unknown — neutral
  }

  const total = contributors.reduce((sum, c) => sum + c.contributions, 0);
  if (total === 0) return { score: 50, topContributorPct: 0 };

  const topPct = contributors[0].contributions / total;
  const score = Math.round((1 - topPct) * 100);

  return {
    score: Math.min(100, Math.max(0, score)),
    topContributorPct: Math.round(topPct * 100),
  };
}

/**
 * DIFFICULTY CLASSIFICATION
 *
 * Uses a three-factor composite:
 *
 *   adjustedScore = (complexityScore × 0.45)
 *                 + (activityScore   × 0.25)
 *                 + ((100 - healthScore) × 0.20)   ← high health LOWERS difficulty
 *                 + ((100 - busFactorScore) × 0.10) ← distributed contributions LOWER difficulty
 *
 * Thresholds:
 *   adjustedScore < 30  → Beginner
 *   adjustedScore < 60  → Intermediate
 *   adjustedScore ≥ 60  → Advanced
 *
 * Design rationale:
 *   - A structurally complex repo (high fileCount, many languages) is not
 *     necessarily hard to contribute to if it has great docs and CI.
 *   - A simple repo with zero documentation and a single bus-factor author
 *     is harder to contribute to than raw complexity suggests.
 *   - This model rewards repos that invest in contributor experience.
 */
export type Difficulty = 'Beginner' | 'Intermediate' | 'Advanced';

export function classifyDifficulty(
  activityScore: number,
  complexityScore: number,
  healthScore: number,
  busFactorScore: number,
): Difficulty {
  const adjusted =
    complexityScore                * 0.45 +
    activityScore                  * 0.25 +
    (100 - healthScore)            * 0.20 +
    (100 - busFactorScore)         * 0.10;

  if (adjusted < 30) return 'Beginner';
  if (adjusted < 60) return 'Intermediate';
  return 'Advanced';
}
