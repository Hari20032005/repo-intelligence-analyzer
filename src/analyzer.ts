import { GithubClient, parseRepoUrl } from './github';
import { calculateActivityScore, calculateComplexityScore, classifyDifficulty, Difficulty } from './scorer';

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
    languages: Record<string, number>;
    languageCount: number;
    fileCount: number;
    dependencyFiles: string[];
    recentCommits: number;
  };
  scores: {
    activityScore: number;
    complexityScore: number;
    combinedScore: number;
  };
  difficulty: Difficulty;
  analysedAt: string;
}

export interface AnalysisResult {
  summary: {
    total: number;
    beginner: number;
    intermediate: number;
    advanced: number;
    averageActivity: number;
    averageComplexity: number;
  };
  reports: (RepoReport | { url: string; error: string })[];
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

  return {
    summary: {
      total: reports.length,
      beginner:      successful.filter((r) => r.difficulty === 'Beginner').length,
      intermediate:  successful.filter((r) => r.difficulty === 'Intermediate').length,
      advanced:      successful.filter((r) => r.difficulty === 'Advanced').length,
      averageActivity:   avg(successful.map((r) => r.scores.activityScore)),
      averageComplexity: avg(successful.map((r) => r.scores.complexityScore)),
    },
    reports,
  };
}

async function analyzeOne(
  url: string,
  client: GithubClient,
): Promise<RepoReport | { url: string; error: string }> {
  const parsed = parseRepoUrl(url);
  if (!parsed) return { url, error: 'Invalid GitHub repository URL.' };

  const { owner, repo } = parsed;

  try {
    const [details, languages, contributors, commitActivity] = await Promise.all([
      client.getRepoDetails(owner, repo),
      client.getLanguages(owner, repo).catch(() => ({} as Record<string, number>)),
      client.getContributorCount(owner, repo).catch(() => 0),
      client.getCommitActivity(owner, repo).catch(() => []),
    ]);

    const [fileCount, dependencyFiles] = await Promise.all([
      client.getFileCount(owner, repo, details.default_branch).catch(() => 0),
      client.getDependencyFiles(owner, repo, details.default_branch).catch(() => []),
    ]);

    const recentCommits = commitActivity
      .slice(-4)
      .reduce((s, w) => s + (w.total ?? 0), 0);

    const activityScore  = calculateActivityScore(commitActivity, details.stargazers_count, details.forks_count, details.open_issues_count, contributors);
    const complexityScore = calculateComplexityScore(fileCount, languages, dependencyFiles);
    const combinedScore  = Math.round(activityScore * 0.4 + complexityScore * 0.6);
    const difficulty      = classifyDifficulty(activityScore, complexityScore);

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
        contributors,
        languages,
        languageCount:   Object.keys(languages).length,
        fileCount,
        dependencyFiles,
        recentCommits,
      },
      scores: { activityScore, complexityScore, combinedScore },
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
