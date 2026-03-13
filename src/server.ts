import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { analyzeRepos } from './analyzer';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const GITHUB_TOKEN = process.env.GITHUB_ACCESS_TOKEN;

/* ─── Health check ─────────────────────────────────────────────── */
app.get('/', (_req: Request, res: Response) => {
  res.json({
    service: 'repo-intelligence-analyzer',
    version: '1.0.0',
    endpoints: {
      'POST /analyze': 'Analyze one or more GitHub repositories',
      'GET  /analyze':  'Analyze repos via ?urls= query param (comma-separated)',
    },
    docs: 'https://github.com/Hari20032005/repo-intelligence-analyzer',
  });
});

/* ─── POST /analyze ─────────────────────────────────────────────── */
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

/* ─── GET /analyze?urls=url1,url2 ────────────────────────────────── */
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

/* ─── Error handler ─────────────────────────────────────────────── */
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.listen(PORT, () => {
  console.log(`repo-intelligence-analyzer running on port ${PORT}`);
});

export default app;
