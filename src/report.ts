import { AnalysisResult, RepoReport } from './analyzer';

function scoreBar(score: number, color: string): string {
  const width = Math.max(2, score);
  return `<div style="background:#e5e7eb;border-radius:6px;height:10px;width:100%;">
    <div style="background:${color};border-radius:6px;height:10px;width:${width}%;"></div>
  </div>`;
}

function difficultyBadge(d: string): string {
  const colors: Record<string, string> = {
    Beginner:     'background:#d1fae5;color:#065f46;border:1px solid #6ee7b7;',
    Intermediate: 'background:#fef3c7;color:#92400e;border:1px solid #fcd34d;',
    Advanced:     'background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;',
  };
  const style = colors[d] || 'background:#e5e7eb;color:#374151;';
  return `<span style="${style}font-weight:700;padding:4px 14px;border-radius:9999px;font-size:14px;">${d}</span>`;
}

function healthRow(signals: RepoReport['metrics']['healthSignals']): string {
  const checks = [
    { label: 'CONTRIBUTING.md', ok: signals.hasContributing },
    { label: 'CI/CD Workflows', ok: signals.hasCICD },
    { label: 'Issue Templates', ok: signals.hasIssueTemplates },
    { label: 'Code of Conduct', ok: signals.hasCodeOfConduct },
    { label: 'Security Policy', ok: signals.hasSecurityPolicy },
    { label: 'Changelog', ok: signals.hasChangelog },
  ];
  return checks.map((c) => `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;
         background:${c.ok ? '#f0fdf4' : '#fafafa'};border:1px solid ${c.ok ? '#bbf7d0' : '#e5e7eb'};">
      <span style="font-size:16px;">${c.ok ? '✅' : '❌'}</span>
      <span style="font-size:14px;color:${c.ok ? '#166534' : '#6b7280'};font-weight:${c.ok ? '600' : '400'};">${c.label}</span>
    </div>`).join('');
}

function scoreSection(label: string, score: number, color: string, description: string): string {
  return `
  <div style="margin-bottom:16px;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">
      <span style="font-size:15px;font-weight:600;color:#374151;">${label}</span>
      <span style="font-size:22px;font-weight:800;color:${color};">${score}<span style="font-size:14px;color:#9ca3af;">/100</span></span>
    </div>
    ${scoreBar(score, color)}
    <p style="font-size:13px;color:#6b7280;margin:6px 0 0;">${description}</p>
  </div>`;
}

function langTable(languages: Record<string, number>): string {
  const total = Object.values(languages).reduce((a, b) => a + b, 0);
  if (total === 0) return '<p style="font-size:14px;color:#9ca3af;">No language data.</p>';
  const entries = Object.entries(languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const COLORS = ['#3b82f6','#f59e0b','#10b981','#8b5cf6','#ef4444','#06b6d4','#ec4899','#84cc16'];
  return `<div style="display:flex;flex-direction:column;gap:6px;">` +
    entries.map(([lang, bytes], i) => {
      const pct = Math.round((bytes / total) * 100);
      return `
      <div>
        <div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:3px;">
          <span style="color:#374151;font-weight:500;">${lang}</span>
          <span style="color:#6b7280;">${pct}%</span>
        </div>
        ${scoreBar(pct, COLORS[i % COLORS.length])}
      </div>`;
    }).join('') + '</div>';
}

function repoCard(r: RepoReport): string {
  const scoreDescriptions: Record<string, string> = {
    activity:   `Based on ${r.metrics.recentCommits} commits in last 4 weeks, ${r.metrics.stars.toLocaleString()} stars, ${r.metrics.forks.toLocaleString()} forks, ${r.metrics.openIssues} open issues, and ${r.metrics.contributors} contributors.`,
    complexity: `Derived from ${r.metrics.fileCount.toLocaleString()} files, ${r.metrics.languageCount} programming languages, and ${r.metrics.dependencyFiles.length} dependency manifest file(s).`,
    health:     `Evaluates presence of CONTRIBUTING.md (+25), CI/CD (+25), issue templates (+20), Code of Conduct (+15), Security Policy (+10), Changelog (+5).`,
    busFactor:  `Top contributor accounts for ${r.metrics.topContributorPct}% of all commits. Lower concentration = higher score = healthier contributor distribution.`,
  };

  const depList = r.metrics.dependencyFiles.length > 0
    ? r.metrics.dependencyFiles.slice(0, 10).map(f =>
        `<span style="display:inline-block;background:#eff6ff;color:#1e40af;font-size:12px;padding:2px 8px;border-radius:4px;margin:2px;font-family:monospace;">${f}</span>`
      ).join('')
    : '<span style="color:#9ca3af;font-size:14px;">None detected</span>';

  const topicsList = r.topics.length > 0
    ? r.topics.map(t =>
        `<span style="display:inline-block;background:#f0f9ff;color:#0369a1;font-size:12px;padding:2px 10px;border-radius:9999px;margin:2px;border:1px solid #bae6fd;">${t}</span>`
      ).join('')
    : '<span style="color:#9ca3af;font-size:14px;">No topics</span>';

  return `
  <div style="border:1px solid #e5e7eb;border-radius:16px;margin-bottom:28px;background:#fff;
       box-shadow:0 2px 8px rgba(0,0,0,.07);overflow:hidden;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#f8fafc 0%,#f1f5f9 100%);
         padding:24px 28px;border-bottom:1px solid #e5e7eb;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;">
        <div style="flex:1;">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;">
            <a href="${r.url}" target="_blank" rel="noopener"
               style="font-size:22px;font-weight:800;color:#1d4ed8;text-decoration:none;">
              ${r.owner}/${r.repo}
            </a>
            ${r.archived ? '<span style="background:#f3f4f6;color:#6b7280;font-size:12px;padding:2px 8px;border-radius:9999px;border:1px solid #d1d5db;">Archived</span>' : ''}
            ${r.language ? `<span style="background:#eff6ff;color:#3b82f6;font-size:13px;padding:2px 10px;border-radius:9999px;border:1px solid #bfdbfe;">${r.language}</span>` : ''}
          </div>
          <p style="font-size:15px;color:#4b5563;margin:0 0 10px;line-height:1.5;">${r.description ?? 'No description provided.'}</p>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">${topicsList}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          ${difficultyBadge(r.difficulty)}
          <div style="font-size:13px;color:#6b7280;margin-top:8px;">
            Combined Score: <b style="font-size:18px;color:#111827;">${r.scores.combinedScore}</b>/100
          </div>
          ${r.license ? `<div style="font-size:12px;color:#9ca3af;margin-top:4px;">📄 ${r.license}</div>` : ''}
        </div>
      </div>
    </div>

    <div style="padding:24px 28px;">

      <!-- Stats row -->
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:28px;">
        ${[
          ['⭐', r.metrics.stars.toLocaleString(), 'Stars'],
          ['🍴', r.metrics.forks.toLocaleString(), 'Forks'],
          ['🐛', r.metrics.openIssues.toLocaleString(), 'Open Issues'],
          ['👥', r.metrics.contributors.toLocaleString(), 'Contributors'],
          ['📝', r.metrics.recentCommits.toString(), 'Commits (4w)'],
        ].map(([icon, val, label]) => `
          <div style="text-align:center;padding:14px 8px;background:#f9fafb;border-radius:10px;border:1px solid #f3f4f6;">
            <div style="font-size:20px;margin-bottom:4px;">${icon}</div>
            <div style="font-size:22px;font-weight:800;color:#111827;">${val}</div>
            <div style="font-size:12px;color:#9ca3af;margin-top:2px;">${label}</div>
          </div>`).join('')}
      </div>

      <!-- Two column layout -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-bottom:28px;">

        <!-- Scores -->
        <div>
          <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 16px;
               padding-bottom:8px;border-bottom:2px solid #f3f4f6;">📊 Intelligence Scores</h3>
          ${scoreSection('Activity Score', r.scores.activityScore, '#3b82f6', scoreDescriptions.activity)}
          ${scoreSection('Complexity Score', r.scores.complexityScore, '#f59e0b', scoreDescriptions.complexity)}
          ${scoreSection('Health Score', r.scores.healthScore, '#10b981', scoreDescriptions.health)}
          ${scoreSection('Bus Factor Score', r.scores.busFactorScore, '#8b5cf6', scoreDescriptions.busFactor)}
        </div>

        <!-- Health signals + Languages -->
        <div>
          <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 16px;
               padding-bottom:8px;border-bottom:2px solid #f3f4f6;">🏥 Contributor Health Signals</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:24px;">
            ${healthRow(r.metrics.healthSignals)}
          </div>

          <h3 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 16px;
               padding-bottom:8px;border-bottom:2px solid #f3f4f6;">🔤 Language Breakdown</h3>
          ${langTable(r.metrics.languages)}
        </div>
      </div>

      <!-- Dependency files -->
      <div style="background:#f9fafb;border-radius:10px;padding:16px;margin-bottom:20px;border:1px solid #f3f4f6;">
        <h3 style="font-size:15px;font-weight:700;color:#374151;margin:0 0 10px;">
          📦 Dependency Manifests
          <span style="font-weight:400;color:#9ca3af;font-size:13px;">(${r.metrics.dependencyFiles.length} found)</span>
        </h3>
        <div>${depList}</div>
      </div>

      <!-- Additional info -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;font-size:13px;color:#6b7280;">
        <div style="background:#f9fafb;border-radius:8px;padding:12px;border:1px solid #f3f4f6;">
          <div style="font-weight:600;color:#374151;margin-bottom:4px;">📁 Codebase Size</div>
          <div>${r.metrics.fileCount.toLocaleString()} files across ${r.metrics.languageCount} language(s)</div>
        </div>
        <div style="background:#f9fafb;border-radius:8px;padding:12px;border:1px solid #f3f4f6;">
          <div style="font-weight:600;color:#374151;margin-bottom:4px;">👤 Top Contributor</div>
          <div>${r.metrics.topContributorPct}% of all commits by single author</div>
        </div>
        <div style="background:#f9fafb;border-radius:8px;padding:12px;border:1px solid #f3f4f6;">
          <div style="font-weight:600;color:#374151;margin-bottom:4px;">🕐 Last Analysed</div>
          <div>${new Date(r.analysedAt).toLocaleString()}</div>
        </div>
      </div>
    </div>
  </div>`;
}

export function generateHtmlReport(result: AnalysisResult, title = 'Repository Intelligence Report'): string {
  const successful = result.reports.filter((r): r is RepoReport => !('error' in r));
  const failed = result.reports.filter((r): r is { url: string; error: string } => 'error' in r);

  const diffDist = [
    { label: 'Beginner',     count: result.summary.beginner,     color: '#10b981' },
    { label: 'Intermediate', count: result.summary.intermediate, color: '#f59e0b' },
    { label: 'Advanced',     count: result.summary.advanced,     color: '#ef4444' },
  ];

  const distBars = diffDist.map((d) => {
    const pct = result.summary.successful > 0
      ? Math.round((d.count / result.summary.successful) * 100) : 0;
    return `
    <div style="margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;font-size:15px;margin-bottom:6px;">
        <span style="color:#374151;font-weight:600;">${d.label}</span>
        <span style="font-weight:700;color:#111827;">${d.count} repos &nbsp;(${pct}%)</span>
      </div>
      ${scoreBar(pct, d.color)}
    </div>`;
  }).join('');

  const summaryScores = [
    { label: 'Avg Activity',   val: result.summary.averageActivity,   color: '#3b82f6' },
    { label: 'Avg Complexity', val: result.summary.averageComplexity, color: '#f59e0b' },
    { label: 'Avg Health',     val: result.summary.averageHealth,     color: '#10b981' },
  ];

  const failedRows = failed.map((f) =>
    `<tr>
      <td style="padding:10px;font-size:14px;color:#1d4ed8;">${f.url}</td>
      <td style="padding:10px;font-size:14px;color:#ef4444;">${f.error}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f3f4f6;
      margin: 0;
      padding: 32px 20px;
      color: #1f2937;
      font-size: 15px;
      line-height: 1.6;
    }
    .container { max-width: 1040px; margin: 0 auto; }
    a { color: #1d4ed8; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 13px; color: #6b7280; padding: 10px;
         border-bottom: 2px solid #e5e7eb; }
    @media print {
      body { background: #fff; padding: 0; }
      .no-print { display: none !important; }
    }
    @media (max-width: 680px) {
      .stats-5col { grid-template-columns: repeat(3,1fr) !important; }
      .two-col    { grid-template-columns: 1fr !important; }
      .three-col  { grid-template-columns: 1fr 1fr !important; }
    }
  </style>
</head>
<body>
<div class="container">

  <!-- Title bar -->
  <div style="background:#fff;border-radius:16px;padding:28px 32px;margin-bottom:24px;
       box-shadow:0 2px 8px rgba(0,0,0,.07);border:1px solid #e5e7eb;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;">
      <div>
        <h1 style="font-size:28px;font-weight:800;color:#111827;margin:0 0 6px;">🔍 ${title}</h1>
        <p style="font-size:14px;color:#6b7280;margin:0;">
          Generated ${new Date().toUTCString()}
          ${result.rateLimit ? ` &nbsp;·&nbsp; GitHub API: <b>${result.rateLimit.remaining}</b>/${result.rateLimit.limit} requests remaining` : ''}
        </p>
      </div>
      <button onclick="window.print()" class="no-print"
        style="padding:10px 20px;background:#1d4ed8;color:#fff;border:none;border-radius:8px;
               font-size:14px;font-weight:600;cursor:pointer;">
        🖨 Print / Save PDF
      </button>
    </div>
  </div>

  <!-- Summary cards -->
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:24px;">
    <div style="background:#fff;border-radius:12px;padding:20px;text-align:center;
         box-shadow:0 1px 4px rgba(0,0,0,.06);border:1px solid #e5e7eb;">
      <div style="font-size:40px;font-weight:800;color:#111827;">${result.summary.total}</div>
      <div style="font-size:14px;color:#6b7280;margin-top:4px;">Repos Analysed</div>
      ${result.summary.failed > 0
        ? `<div style="font-size:13px;color:#ef4444;margin-top:4px;">${result.summary.failed} failed</div>` : ''}
    </div>
    ${summaryScores.map(s => `
    <div style="background:#fff;border-radius:12px;padding:20px;text-align:center;
         box-shadow:0 1px 4px rgba(0,0,0,.06);border:1px solid #e5e7eb;">
      <div style="font-size:40px;font-weight:800;color:${s.color};">${s.val}</div>
      <div style="font-size:14px;color:#6b7280;margin-top:4px;">${s.label}</div>
    </div>`).join('')}
  </div>

  <!-- Difficulty distribution -->
  <div style="background:#fff;border-radius:12px;padding:24px 28px;margin-bottom:28px;
       box-shadow:0 1px 4px rgba(0,0,0,.06);border:1px solid #e5e7eb;">
    <h2 style="font-size:18px;font-weight:700;color:#111827;margin:0 0 18px;">Difficulty Distribution</h2>
    ${distBars}
  </div>

  <!-- Repo cards -->
  ${successful.map(repoCard).join('')}

  ${failed.length > 0 ? `
  <div style="background:#fff;border-radius:12px;padding:24px;margin-top:24px;border:1px solid #fca5a5;">
    <h2 style="font-size:17px;font-weight:700;color:#ef4444;margin:0 0 14px;">Failed Analyses</h2>
    <table>
      <thead><tr><th>URL</th><th>Error</th></tr></thead>
      <tbody>${failedRows}</tbody>
    </table>
  </div>` : ''}

  <div style="text-align:center;margin-top:36px;font-size:13px;color:#9ca3af;padding-bottom:20px;">
    Generated by
    <a href="https://github.com/Hari20032005/repo-intelligence-analyzer" style="color:#3b82f6;">
      repo-intelligence-analyzer
    </a>
    &nbsp;·&nbsp; Pre-GSoC 2026 Task 2
  </div>
</div>
</body>
</html>`;
}
