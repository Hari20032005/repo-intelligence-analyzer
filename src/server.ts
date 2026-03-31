import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { analyzeRepos, analyzeOrg } from './analyzer';
import { generateHtmlReport } from './report';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const GITHUB_TOKEN = process.env.GITHUB_ACCESS_TOKEN;

// ─── Health check / API index ────────────────────────────────────────────────
app.get('/', (_req: Request, res: Response) => {
  res.json({
    service: 'repo-intelligence-analyzer',
    version: '2.0.0',
    endpoints: {
      'POST /analyze':          'Analyze one or more GitHub repositories (JSON body: { urls: [...] })',
      'GET  /analyze':          'Analyze repos via ?urls= query param (comma-separated)',
      'GET  /analyze/org/:org': 'Analyze all public repositories of a GitHub organisation',
      'GET  /report':           'Same as GET /analyze but returns a rendered HTML report',
      'GET  /report/org/:org':  'HTML report for all repos in a GitHub organisation',
    },
    docs: 'https://github.com/Hari20032005/repo-intelligence-analyzer',
  });
});

// ─── POST /analyze ───────────────────────────────────────────────────────────
app.post('/analyze', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as { urls?: unknown };
    if (!body.urls || !Array.isArray(body.urls) || body.urls.length === 0) {
      res.status(400).json({ error: '`urls` must be a non-empty array of GitHub repository URLs.' });
      return;
    }
    if (body.urls.length > 20) {
      res.status(400).json({ error: 'Maximum 20 repositories per request.' });
      return;
    }
    const urls = body.urls.filter((u): u is string => typeof u === 'string');
    const result = await analyzeRepos(urls, GITHUB_TOKEN);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─── GET /analyze?urls=url1,url2 ─────────────────────────────────────────────
app.get('/analyze', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const raw = req.query.urls as string | undefined;
    if (!raw) {
      res.status(400).json({ error: 'Provide `urls` as a comma-separated query parameter.' });
      return;
    }
    const urls = raw.split(',').map((u) => u.trim()).filter(Boolean);
    if (urls.length > 20) {
      res.status(400).json({ error: 'Maximum 20 repositories per request.' });
      return;
    }
    const result = await analyzeRepos(urls, GITHUB_TOKEN);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─── GET /analyze/org/:org ───────────────────────────────────────────────────
app.get('/analyze/org/:org', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { org } = req.params;
    const limitParam = req.query.limit as string | undefined;
    const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 20, 30) : 20;

    const result = await analyzeOrg(org, GITHUB_TOKEN, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─── GET /report?urls= ── HTML report ─────────────────────────────────────────
app.get('/report', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const raw = req.query.urls as string | undefined;
    if (!raw) {
      res.status(400).send('<p>Provide <code>?urls=</code> comma-separated GitHub URLs.</p>');
      return;
    }
    const urls = raw.split(',').map((u) => u.trim()).filter(Boolean);
    if (urls.length > 20) {
      res.status(400).send('<p>Maximum 20 repositories per request.</p>');
      return;
    }
    const result = await analyzeRepos(urls, GITHUB_TOKEN);
    const html = generateHtmlReport(result);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    next(err);
  }
});

// ─── GET /report/org/:org ── HTML report for org ─────────────────────────────
app.get('/report/org/:org', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { org } = req.params;
    const limitParam = req.query.limit as string | undefined;
    const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 20, 30) : 20;

    const result = await analyzeOrg(org, GITHUB_TOKEN, limit);
    const html = generateHtmlReport(result, `${org} — Repository Intelligence Report`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    next(err);
  }
});

// ─── Error handler ───────────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.listen(PORT, () => {
  console.log(`repo-intelligence-analyzer v2.0 running on port ${PORT}`);
});

export default app;
