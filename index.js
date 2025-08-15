require("dotenv").config();
const Mustache = require("mustache");
const fs = require("fs").promises;
const path = require("path");
const { Octokit } = require("@octokit/rest");

const octokit = new Octokit({
  auth: process.env.GH_ACCESS_TOKEN,
  userAgent: "readme-upgrader v2.0.0",
});

const CACHE_FILE = path.resolve(__dirname, "repo_cache.json");

// Fetch all repositories with pagination
async function grabAllRepositories() {
  let page = 1;
  let repos = [];
  while (true) {
    const response = await octokit.rest.repos.listForAuthenticatedUser({
      per_page: 100,
      page,
    });
    repos = repos.concat(response.data);
    if (response.data.length < 100) break; // no more pages
    page++;
  }
  console.log(`Fetched ${repos.length} repositories`);
  return repos;
}

// Calculate total stars
function calculateTotalStars(data) {
  return data.reduce((sum, repo) => sum + repo.stargazers_count, 0);
}

// Fetch contributor stats with retry for 202 Accepted
async function getContributorStats(owner, repo) {
  for (let i = 0; i < 5; i++) { // retry up to 5 times
    const stats = await octokit.rest.repos.getContributorsStats({ owner, repo });
    if (stats.status === 202) {
      console.log(`Stats for ${repo} not ready. Retrying...`);
      await new Promise((r) => setTimeout(r, 1000));
    } else {
      return stats.data;
    }
  }
  return [];
}

// Calculate total commits optionally filtered by cutoffDate
async function calculateTotalCommits(repos, cutoffDate) {
  const githubUsername = process.env.GH_USERNAME;
  let totalCommits = 0;

  for (const repo of repos) {
    const lastRepoUpdate = new Date(repo.updated_at);
    if (cutoffDate && lastRepoUpdate <= cutoffDate) continue;

    console.log(`Processing commits for ${repo.name}...`);
    const contributorData = await getContributorStats(githubUsername, repo.name);

    const userStats = contributorData.find((item) => item.author?.login === githubUsername);
    if (!userStats) continue;

    if (!cutoffDate) {
      totalCommits += userStats.total;
    } else {
      totalCommits += userStats.weeks
        .filter((week) => new Date(week.w * 1000) > cutoffDate)
        .reduce((sum, week) => sum + week.c, 0);
    }
  }

  return totalCommits;
}

// Update README using Mustache template
async function updateReadme(userData) {
  const template = await fs.readFile("./main.mustache", "utf-8");
  const output = Mustache.render(template, userData);
  await fs.writeFile("README.md", output, "utf-8");
  console.log("README.md updated successfully!");
}

// Cache helpers
async function loadCache() {
  try {
    const data = await fs.readFile(CACHE_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveCache(data) {
  await fs.writeFile(CACHE_FILE, JSON.stringify(data, null, 2), "utf-8");
}

// Main
async function main() {
  let repoData = await loadCache();
  if (!repoData) {
    repoData = await grabAllRepositories();
    await saveCache(repoData);
  }

  const totalStars = calculateTotalStars(repoData);

  const lastYear = new Date();
  lastYear.setFullYear(lastYear.getFullYear() - 1);

  const totalCommitsInPastYear = await calculateTotalCommits(repoData, lastYear);

  const colors = ["474342", "fbedf6", "c9594d", "f8b9b2", "ae9c9d"];

  await updateReadme({ totalStars, totalCommitsInPastYear, colors });
}

main();
