import { AnalysisResult, RepoReport } from './analyzer';

function scoreBar(score: number, color: string): string {
  const width = Math.max(2, score);
  return `<div style="background:#e5e7eb;border-radius:4px;height:8px;width:100%;">
    <div style="background:${color};border-radius:4px;height:8px;width:${width}%;transition:width .3s;"></div>
  </div>`;
}

function difficultyBadge(d: string): string {
  const colors: Record<string, string> = {
    Beginner:     'background:#d1fae5;color:#065f46;',
    Intermediate: 'background:#fef3c7;color:#92400e;',
    Advanced:     'background:#fee2e2;color:#991b1b;',
  };
  const style = colors[d] || 'background:#e5e7eb;color:#374151;';
  return `<span style="${style}font-weight:600;padding:2px 10px;border-radius:9999px;font-size:12px;">${d}</span>`;
}

function healthSignalDots(s: RepoReport['metrics']['healthSignals']): string {
  const checks = [
    { label: 'CONTRIBUTING', ok: s.hasContributing },
    { label: 'CI/CD', ok: s.hasCICD },
    { label: 'Issue Templates', ok: s.hasIssueTemplates },
    { label: 'Code of Conduct', ok: s.hasCodeOfConduct },
    { label: 'Security Policy', ok: s.hasSecurityPolicy },
    { label: 'Changelog', ok: s.hasChangelog },
  ];
  return checks.map((c) =>
    `<span style="margin-right:6px;font-size:11px;color:${c.ok ? '#059669' : '#9ca3af'};">
      ${c.ok ? '✓' : '✗'} ${c.label}
    </span>`,
  ).join('');
}

function repoCard(r: RepoReport): string {
  return `
  <div style="border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin-bottom:20px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.06);">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
      <div>
        <a href="${r.url}" target="_blank" rel="noopener"
           style="font-size:17px;font-weight:700;color:#1d4ed8;text-decoration:none;">
          ${r.owner}/${r.repo}
        </a>
        ${r.archived ? '<span style="margin-left:8px;background:#f3f4f6;color:#6b7280;font-size:11px;padding:2px 7px;border-radius:9999px;">Archived</span>' : ''}
        ${r.language ? `<span style="margin-left:8px;background:#eff6ff;color:#3b82f6;font-size:11px;padding:2px 7px;border-radius:9999px;">${r.language}</span>` : ''}
        <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">${r.description ?? 'No description.'}</p>
      </div>
      <div style="text-align:right;flex-shrink:0;margin-left:16px;">
        ${difficultyBadge(r.difficulty)}
        <div style="font-size:11px;color:#9ca3af;margin-top:4px;">Combined: <b>${r.scores.combinedScore}</b>/100</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px;">
      <div style="text-align:center;padding:8px;background:#f9fafb;border-radius:8px;">
        <div style="font-size:20px;font-weight:700;color:#1f2937;">${r.metrics.stars.toLocaleString()}</div>
        <div style="font-size:11px;color:#9ca3af;">Stars</div>
      </div>
      <div style="text-align:center;padding:8px;background:#f9fafb;border-radius:8px;">
        <div style="font-size:20px;font-weight:700;color:#1f2937;">${r.metrics.forks.toLocaleString()}</div>
        <div style="font-size:11px;color:#9ca3af;">Forks</div>
      </div>
      <div style="text-align:center;padding:8px;background:#f9fafb;border-radius:8px;">
        <div style="font-size:20px;font-weight:700;color:#1f2937;">${r.metrics.contributors.toLocaleString()}</div>
        <div style="font-size:11px;color:#9ca3af;">Contributors</div>
      </div>
      <div style="text-align:center;padding:8px;background:#f9fafb;border-radius:8px;">
        <div style="font-size:20px;font-weight:700;color:#1f2937;">${r.metrics.recentCommits}</div>
        <div style="font-size:11px;color:#9ca3af;">Commits (4w)</div>
      </div>
    </div>

    <div style="margin-bottom:12px;">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;">
        ${scoreRow('Activity', r.scores.activityScore, '#3b82f6')}
        ${scoreRow('Complexity', r.scores.complexityScore, '#f59e0b')}
        ${scoreRow('Health', r.scores.healthScore, '#10b981')}
        ${scoreRow('Bus Factor', r.scores.busFactorScore, '#8b5cf6')}
      </div>
    </div>

    <div style="font-size:12px;color:#6b7280;border-top:1px solid #f3f4f6;padding-top:10px;">
      <b style="color:#374151;">Health signals:</b>
      ${healthSignalDots(r.metrics.healthSignals)}
      <span style="float:right;color:#9ca3af;">Top contributor: ${r.metrics.topContributorPct}% of commits &nbsp;·&nbsp; ${r.metrics.fileCount} files &nbsp;·&nbsp; ${r.metrics.languageCount} languages</span>
    </div>
  </div>`;
}

function scoreRow(label: string, score: number, color: string): string {
  return `<div>
    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px;">
      <span style="color:#6b7280;">${label}</span>
      <span style="font-weight:600;color:#1f2937;">${score}</span>
    </div>
    ${scoreBar(score, color)}
  </div>`;
}

export function generateHtmlReport(result: AnalysisResult, title = 'Repository Intelligence Report'): string {
  const successful = result.reports.filter((r): r is RepoReport => !('error' in r));
  const failed = result.reports.filter((r): r is { url: string; error: string } => 'error' in r);

  const diffDist = [
    { label: 'Beginner', count: result.summary.beginner, color: '#10b981' },
    { label: 'Intermediate', count: result.summary.intermediate, color: '#f59e0b' },
    { label: 'Advanced', count: result.summary.advanced, color: '#ef4444' },
  ];

  const distBars = diffDist.map((d) => {
    const pct = result.summary.successful > 0
      ? Math.round((d.count / result.summary.successful) * 100)
      : 0;
    return `
    <div style="margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px;">
        <span style="color:#374151;">${d.label}</span>
        <span style="font-weight:600;">${d.count} (${pct}%)</span>
      </div>
      ${scoreBar(pct, d.color)}
    </div>`;
  }).join('');

  const failedRows = failed.map((f) =>
    `<tr><td style="padding:8px;font-size:13px;color:#1d4ed8;">${f.url}</td>
     <td style="padding:8px;font-size:13px;color:#ef4444;">${f.error}</td></tr>`,
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #f3f4f6; margin: 0; padding: 20px; color: #1f2937; }
    .container { max-width: 960px; margin: 0 auto; }
    h1 { font-size: 24px; font-weight: 800; color: #111827; margin: 0 0 4px; }
    .subtitle { font-size: 14px; color: #6b7280; margin: 0 0 24px; }
    .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; }
    .card { background: #fff; border-radius: 12px; padding: 18px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
    .stat-num { font-size: 32px; font-weight: 800; color: #111827; }
    .stat-label { font-size: 13px; color: #9ca3af; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 12px; color: #6b7280; padding: 8px; border-bottom: 2px solid #e5e7eb; }
    @media (max-width: 600px) {
      .summary-grid { grid-template-columns: 1fr 1fr; }
    }
  </style>
</head>
<body>
<div class="container">
  <h1>🔍 ${title}</h1>
  <p class="subtitle">Generated at ${new Date().toUTCString()} &nbsp;·&nbsp;
    ${result.rateLimit ? `GitHub API: ${result.rateLimit.remaining}/${result.rateLimit.limit} requests remaining` : ''}
  </p>

  <div class="summary-grid">
    <div class="card">
      <div class="stat-num">${result.summary.total}</div>
      <div class="stat-label">Repositories analysed</div>
      ${result.summary.failed > 0
        ? `<div style="font-size:12px;color:#ef4444;margin-top:4px;">${result.summary.failed} failed</div>`
        : ''}
    </div>
    <div class="card">
      <div class="stat-num">${result.summary.averageActivity}</div>
      <div class="stat-label">Avg activity score</div>
    </div>
    <div class="card">
      <div class="stat-num">${result.summary.averageHealth}</div>
      <div class="stat-label">Avg health score</div>
    </div>
  </div>

  <div class="card" style="margin-bottom:24px;">
    <h2 style="font-size:15px;font-weight:700;margin:0 0 14px;">Difficulty Distribution</h2>
    ${distBars}
  </div>

  ${successful.map(repoCard).join('')}

  ${failed.length > 0 ? `
  <div class="card" style="margin-top:20px;">
    <h2 style="font-size:15px;font-weight:700;margin:0 0 12px;color:#ef4444;">Failed Analyses</h2>
    <table>
      <thead><tr><th>URL</th><th>Error</th></tr></thead>
      <tbody>${failedRows}</tbody>
    </table>
  </div>` : ''}

  <div style="text-align:center;margin-top:32px;font-size:12px;color:#9ca3af;">
    Generated by <a href="https://github.com/Hari20032005/repo-intelligence-analyzer"
      style="color:#3b82f6;text-decoration:none;">repo-intelligence-analyzer</a>
    &nbsp;·&nbsp; Pre-GSoC 2026 Task 2
  </div>
</div>
</body>
</html>`;
}
