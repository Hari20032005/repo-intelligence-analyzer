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

export class GithubClient {
  private http: AxiosInstance;

  constructor(token?: string) {
    this.http = axios.create({
      baseURL: 'https://api.github.com',
      headers: {
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `token ${token}` } : {}),
      },
      timeout: 15000,
    });
  }

  async getRepoDetails(owner: string, repo: string): Promise<RepoDetails> {
    const key = `repo:${owner}/${repo}`;
    const cached = getCached<RepoDetails>(key);
    if (cached) return cached;

    const { data } = await this.http.get<RepoDetails>(`/repos/${owner}/${repo}`);
    setCached(key, data);
    return data;
  }

  async getLanguages(owner: string, repo: string): Promise<Record<string, number>> {
    const key = `langs:${owner}/${repo}`;
    const cached = getCached<Record<string, number>>(key);
    if (cached) return cached;

    const { data } = await this.http.get<Record<string, number>>(`/repos/${owner}/${repo}/languages`);
    setCached(key, data);
    return data;
  }

  async getContributorCount(owner: string, repo: string): Promise<number> {
    const key = `contributors:${owner}/${repo}`;
    const cached = getCached<number>(key);
    if (cached !== null) return cached;

    try {
      // Use the contributors endpoint with per_page=1 and check Link header for total
      const response = await this.http.get(`/repos/${owner}/${repo}/contributors`, {
        params: { per_page: 1, anon: false },
      });
      const link: string = response.headers['link'] || '';
      const match = link.match(/page=(\d+)>; rel="last"/);
      const count = match ? parseInt(match[1], 10) : (response.data as unknown[]).length;
      setCached(key, count);
      return count;
    } catch {
      return 0;
    }
  }

  async getCommitActivity(owner: string, repo: string): Promise<CommitActivity[]> {
    const key = `commit_activity:${owner}/${repo}`;
    const cached = getCached<CommitActivity[]>(key);
    if (cached) return cached;

    try {
      const { data } = await this.http.get<CommitActivity[]>(
        `/repos/${owner}/${repo}/stats/commit_activity`,
      );
      const result = Array.isArray(data) ? data : [];
      setCached(key, result);
      return result;
    } catch {
      return [];
    }
  }

  async getFileCount(owner: string, repo: string, branch: string): Promise<number> {
    const key = `file_count:${owner}/${repo}`;
    const cached = getCached<number>(key);
    if (cached !== null) return cached;

    try {
      const { data } = await this.http.get<{ tree: { type: string }[] }>(
        `/repos/${owner}/${repo}/git/trees/${branch}`,
        { params: { recursive: 1 } },
      );
      const count = (data.tree || []).filter((i) => i.type === 'blob').length;
      setCached(key, count);
      return count;
    } catch {
      return 0;
    }
  }

  async getDependencyFiles(owner: string, repo: string, branch: string): Promise<string[]> {
    const key = `dep_files:${owner}/${repo}`;
    const cached = getCached<string[]>(key);
    if (cached) return cached;

    const depPatterns = [
      'package.json', 'requirements.txt', 'Gemfile', 'pom.xml',
      'build.gradle', 'Cargo.toml', 'go.mod', 'composer.json',
      'pyproject.toml', 'setup.py', 'CMakeLists.txt', 'Makefile',
    ];

    try {
      const { data } = await this.http.get<{ tree: { type: string; path: string }[] }>(
        `/repos/${owner}/${repo}/git/trees/${branch}`,
        { params: { recursive: 1 } },
      );
      const found = (data.tree || [])
        .filter((i) => i.type === 'blob')
        .map((i) => i.path)
        .filter((p) => depPatterns.some((d) => p.endsWith(d)));
      setCached(key, found);
      return found;
    } catch {
      return [];
    }
  }
}
