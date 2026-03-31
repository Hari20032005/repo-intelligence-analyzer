import { GithubClient, HealthSignals, parseRepoUrl } from './github';
import {
  calculateActivityScore,
  calculateComplexityScore,
  calculateHealthScore,
  calculateBusFactor,
  classifyDifficulty,
  Difficulty,
} from './scorer';

export interface RepoReport {
  url: string;
  owner: string;
  repo: string;
  description: string | null;
  language: string | null;
  topics: string[];
  license: string | null;
  archived: boolean;
  metrics: {
    stars: number;
    forks: number;
    openIssues: number;
    contributors: number;
    topContributorPct: number;
    languages: Record<string, number>;
    languageCount: number;
    fileCount: number;
    dependencyFiles: string[];
    recentCommits: number;
    healthSignals: HealthSignals;
  };
  scores: {
    activityScore: number;
    complexityScore: number;
    healthScore: number;
    busFactorScore: number;
    combinedScore: number;
  };
  difficulty: Difficulty;
  analysedAt: string;
}

export interface AnalysisResult {
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

export async function analyzeRepos(
  urls: string[],
  token?: string,
): Promise<AnalysisResult> {
  const client = new GithubClient(token);

  const reports = await Promise.all(
    urls.map((url) => analyzeOne(url, client)),
  );

  const successful = reports.filter((r): r is RepoReport => !('error' in r));
  const failed = reports.length - successful.length;

  const rateLimit = await client.getRateLimitRemaining().catch(() => null);

  return {
    summary: {
      total:       reports.length,
      successful:  successful.length,
      failed,
      beginner:    successful.filter((r) => r.difficulty === 'Beginner').length,
      intermediate: successful.filter((r) => r.difficulty === 'Intermediate').length,
      advanced:    successful.filter((r) => r.difficulty === 'Advanced').length,
      averageActivity:   avg(successful.map((r) => r.scores.activityScore)),
      averageComplexity: avg(successful.map((r) => r.scores.complexityScore)),
      averageHealth:     avg(successful.map((r) => r.scores.healthScore)),
    },
    reports,
    rateLimit,
  };
}

/**
 * Analyze all public repositories belonging to a GitHub organisation.
 * Fetches up to 100 repos (sorted by most recently pushed).
 */
export async function analyzeOrg(
  org: string,
  token?: string,
  limit = 30,
): Promise<AnalysisResult> {
  const urls = await fetchOrgRepoUrls(org, token, limit);
  return analyzeRepos(urls, token);
}

async function fetchOrgRepoUrls(org: string, token?: string, limit = 30): Promise<string[]> {
  const axios = (await import('axios')).default;
  const { data } = await axios.get<{ html_url: string }[]>(
    `https://api.github.com/orgs/${org}/repos`,
    {
      params: { per_page: Math.min(limit, 100), sort: 'pushed', type: 'public' },
      headers: {
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `token ${token}` } : {}),
      },
      timeout: 15000,
    },
  );
  return data.map((r) => r.html_url);
}

async function analyzeOne(
  url: string,
  client: GithubClient,
): Promise<RepoReport | { url: string; error: string }> {
  const parsed = parseRepoUrl(url);
  if (!parsed) return { url, error: 'Invalid GitHub repository URL.' };

  const { owner, repo } = parsed;

  try {
    // First parallel batch: metadata that doesn't need branch name
    const [details, languages, contributorCount, commitActivity, topContributors] =
      await Promise.all([
        client.getRepoDetails(owner, repo),
        client.getLanguages(owner, repo).catch(() => ({} as Record<string, number>)),
        client.getContributorCount(owner, repo).catch(() => 0),
        client.getCommitActivity(owner, repo).catch(() => []),
        client.getTopContributors(owner, repo).catch(() => []),
      ]);

    const branch = details.default_branch;

    // Second parallel batch: tree-based data (shares one tree fetch via cache)
    const [fileCount, dependencyFiles, healthSignals] = await Promise.all([
      client.getFileCount(owner, repo, branch).catch(() => 0),
      client.getDependencyFiles(owner, repo, branch).catch(() => []),
      client.getHealthSignals(owner, repo, branch).catch(() => ({
        hasContributing: false,
        hasCodeOfConduct: false,
        hasIssueTemplates: false,
        hasCICD: false,
        hasSecurityPolicy: false,
        hasChangelog: false,
      })),
    ]);

    const recentCommits = commitActivity
      .slice(-4)
      .reduce((s, w) => s + (w.total ?? 0), 0);

    const activityScore  = calculateActivityScore(
      commitActivity, details.stargazers_count, details.forks_count,
      details.open_issues_count, contributorCount,
    );
    const complexityScore = calculateComplexityScore(fileCount, languages, dependencyFiles);
    const healthScore     = calculateHealthScore(healthSignals);
    const { score: busFactorScore, topContributorPct } = calculateBusFactor(topContributors);
    const combinedScore   = Math.round(
      activityScore * 0.25 + complexityScore * 0.45 +
      (100 - healthScore) * 0.20 + (100 - busFactorScore) * 0.10,
    );
    const difficulty = classifyDifficulty(activityScore, complexityScore, healthScore, busFactorScore);

    return {
      url,
      owner,
      repo,
      description:  details.description,
      language:     details.language,
      topics:       details.topics ?? [],
      license:      details.license?.name ?? null,
      archived:     details.archived,
      metrics: {
        stars:           details.stargazers_count,
        forks:           details.forks_count,
        openIssues:      details.open_issues_count,
        contributors:    contributorCount,
        topContributorPct,
        languages,
        languageCount:   Object.keys(languages).length,
        fileCount,
        dependencyFiles,
        recentCommits,
        healthSignals,
      },
      scores: { activityScore, complexityScore, healthScore, busFactorScore, combinedScore },
      difficulty,
      analysedAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { url, error: message };
  }
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}
