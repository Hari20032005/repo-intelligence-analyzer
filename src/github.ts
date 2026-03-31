import axios, { AxiosInstance } from 'axios';

export interface RepoDetails {
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  size: number;
  default_branch: string;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  language: string | null;
  topics: string[];
  license: { name: string } | null;
  archived: boolean;
  has_issues: boolean;
  has_wiki: boolean;
}

export interface Contributor {
  login: string;
  contributions: number;
}

export interface CommitActivity {
  week: number;
  total: number;
  days: number[];
}

export interface TreeItem {
  type: string;
  path: string;
}

export interface HealthSignals {
  hasContributing: boolean;
  hasCodeOfConduct: boolean;
  hasIssueTemplates: boolean;
  hasCICD: boolean;
  hasSecurityPolicy: boolean;
  hasChangelog: boolean;
}

// ─── In-memory cache ────────────────────────────────────────────────────────
const cache = new Map<string, { data: unknown; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.data as T;
}

function setCached<T>(key: string, data: T): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL });
}

// ─── URL parser ─────────────────────────────────────────────────────────────
export function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  try {
    const clean = url.trim().replace(/\.git$/, '');
    const match = clean.match(/github\.com[/:]([\w.-]+)\/([\w.-]+)/);
    if (!match) return null;
    return { owner: match[1], repo: match[2] };
  } catch {
    return null;
  }
}

// ─── Retry helper with exponential back-off ──────────────────────────────────
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const status = (err as { response?: { status?: number } })?.response?.status;

      // Don't retry 404 or 409 (not found / empty repo)
      if (status === 404 || status === 409 || status === 422) throw err;

      // Respect Retry-After header on 403/429
      if (status === 403 || status === 429) {
        const retryAfter =
          (err as { response?: { headers?: { 'retry-after'?: string } } })
            ?.response?.headers?.['retry-after'];
        const wait = retryAfter ? parseInt(retryAfter, 10) * 1000 : (2 ** attempt) * 500;
        await delay(Math.min(wait, 10000));
        continue;
      }

      if (attempt < maxAttempts - 1) {
        await delay((2 ** attempt) * 300);
      }
    }
  }
  throw lastError;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── GitHub client ───────────────────────────────────────────────────────────
export class GithubClient {
  private http: AxiosInstance;

  constructor(token?: string) {
    this.http = axios.create({
      baseURL: 'https://api.github.com',
      headers: {
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `token ${token}` } : {}),
      },
      timeout: 20000,
    });
  }

  async getRepoDetails(owner: string, repo: string): Promise<RepoDetails> {
    const key = `repo:${owner}/${repo}`;
    const cached = getCached<RepoDetails>(key);
    if (cached) return cached;

    const { data } = await withRetry(() =>
      this.http.get<RepoDetails>(`/repos/${owner}/${repo}`),
    );
    setCached(key, data);
    return data;
  }

  async getLanguages(owner: string, repo: string): Promise<Record<string, number>> {
    const key = `langs:${owner}/${repo}`;
    const cached = getCached<Record<string, number>>(key);
    if (cached) return cached;

    const { data } = await withRetry(() =>
      this.http.get<Record<string, number>>(`/repos/${owner}/${repo}/languages`),
    );
    setCached(key, data);
    return data;
  }

  async getContributorCount(owner: string, repo: string): Promise<number> {
    const key = `contributor_count:${owner}/${repo}`;
    const cached = getCached<number>(key);
    if (cached !== null) return cached;

    try {
      const response = await withRetry(() =>
        this.http.get(`/repos/${owner}/${repo}/contributors`, {
          params: { per_page: 1, anon: false },
        }),
      );
      const link: string = response.headers['link'] || '';
      const match = link.match(/page=(\d+)>; rel="last"/);
      const count = match ? parseInt(match[1], 10) : (response.data as unknown[]).length;
      setCached(key, count);
      return count;
    } catch {
      return 0;
    }
  }

  /**
   * Returns the top contributors (up to 10) with their contribution counts.
   * Used to calculate the bus factor (contribution concentration).
   */
  async getTopContributors(owner: string, repo: string): Promise<Contributor[]> {
    const key = `top_contributors:${owner}/${repo}`;
    const cached = getCached<Contributor[]>(key);
    if (cached) return cached;

    try {
      const { data } = await withRetry(() =>
        this.http.get<Contributor[]>(`/repos/${owner}/${repo}/contributors`, {
          params: { per_page: 10, anon: false },
        }),
      );
      const result = Array.isArray(data) ? data : [];
      setCached(key, result);
      return result;
    } catch {
      return [];
    }
  }

  async getCommitActivity(owner: string, repo: string): Promise<CommitActivity[]> {
    const key = `commit_activity:${owner}/${repo}`;
    const cached = getCached<CommitActivity[]>(key);
    if (cached) return cached;

    try {
      const { data } = await withRetry(() =>
        this.http.get<CommitActivity[]>(
          `/repos/${owner}/${repo}/stats/commit_activity`,
        ),
      );
      // GitHub returns 202 while computing — data will be null/empty
      const result = Array.isArray(data) ? data : [];
      setCached(key, result);
      return result;
    } catch {
      return [];
    }
  }

  /**
   * Fetches the full repository tree once and caches it.
   * All tree-based metrics (file count, dependency files, health signals) reuse this.
   */
  async getRepoTree(owner: string, repo: string, branch: string): Promise<TreeItem[]> {
    const key = `tree:${owner}/${repo}`;
    const cached = getCached<TreeItem[]>(key);
    if (cached) return cached;

    try {
      const { data } = await withRetry(() =>
        this.http.get<{ tree: TreeItem[] }>(
          `/repos/${owner}/${repo}/git/trees/${branch}`,
          { params: { recursive: 1 } },
        ),
      );
      const result = data.tree || [];
      setCached(key, result);
      return result;
    } catch {
      return [];
    }
  }

  async getFileCount(owner: string, repo: string, branch: string): Promise<number> {
    const tree = await this.getRepoTree(owner, repo, branch);
    return tree.filter((i) => i.type === 'blob').length;
  }

  async getDependencyFiles(owner: string, repo: string, branch: string): Promise<string[]> {
    const depPatterns = [
      'package.json', 'requirements.txt', 'Gemfile', 'pom.xml',
      'build.gradle', 'Cargo.toml', 'go.mod', 'composer.json',
      'pyproject.toml', 'setup.py', 'CMakeLists.txt', 'Makefile',
    ];

    const tree = await this.getRepoTree(owner, repo, branch);
    return tree
      .filter((i) => i.type === 'blob')
      .map((i) => i.path)
      .filter((p) => depPatterns.some((d) => p.endsWith(d)));
  }

  /**
   * Detects project health signals from the repository tree.
   * These are key indicators of how contributor-friendly a repository is.
   *
   * Signals checked:
   *   - CONTRIBUTING.md     — onboarding guide for new contributors
   *   - CODE_OF_CONDUCT.md  — community standards
   *   - Issue templates     — .github/ISSUE_TEMPLATE/ directory
   *   - CI/CD workflows     — .github/workflows/ directory
   *   - SECURITY.md         — responsible disclosure policy
   *   - CHANGELOG.md        — history of changes
   */
  async getHealthSignals(owner: string, repo: string, branch: string): Promise<HealthSignals> {
    const tree = await this.getRepoTree(owner, repo, branch);
    const paths = tree.map((i) => i.path.toLowerCase());

    return {
      hasContributing:  paths.some((p) => p === 'contributing.md' || p === '.github/contributing.md'),
      hasCodeOfConduct: paths.some((p) => p === 'code_of_conduct.md' || p === '.github/code_of_conduct.md'),
      hasIssueTemplates: paths.some((p) => p.startsWith('.github/issue_template')),
      hasCICD:          paths.some((p) => p.startsWith('.github/workflows/') && p.endsWith('.yml')),
      hasSecurityPolicy: paths.some((p) => p === 'security.md' || p === '.github/security.md'),
      hasChangelog:     paths.some((p) => p === 'changelog.md' || p === 'changelog' || p === 'history.md'),
    };
  }

  async getRateLimitRemaining(): Promise<{ remaining: number; limit: number; resetAt: string } | null> {
    try {
      const { data } = await this.http.get<{
        rate: { remaining: number; limit: number; reset: number };
      }>('/rate_limit');
      return {
        remaining: data.rate.remaining,
        limit: data.rate.limit,
        resetAt: new Date(data.rate.reset * 1000).toISOString(),
      };
    } catch {
      return null;
    }
  }
}
