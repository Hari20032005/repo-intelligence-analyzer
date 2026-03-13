#!/usr/bin/env ts-node
import 'dotenv/config';
import { analyzeRepos } from './analyzer';

const urls = process.argv.slice(2);

if (urls.length === 0) {
  console.error('Usage: npm run analyze <github-url> [github-url ...]');
  console.error('Example: npm run analyze https://github.com/c2siorg/Webiu');
  process.exit(1);
}

(async () => {
  console.log(`Analyzing ${urls.length} repository/repositories...\n`);
  const result = await analyzeRepos(urls, process.env.GITHUB_ACCESS_TOKEN);
  console.log(JSON.stringify(result, null, 2));
})();
