require("dotenv").config();
const Mustache = require("mustache");
const fs = require("fs").promises;
const { Octokit } = require("@octokit/rest");

const octokit = new Octokit({
  auth: process.env.GH_ACCESS_TOKEN,
  userAgent: "readme v1.0.0",
  baseUrl: "https://api.github.com",
  log: {
    warn: console.warn,
    error: console.error,
  },
});

// Grab all repositories for authenticated user
async function grabDataFromAllRepositories() {
  try {
    const response = await octokit.rest.repos.listForAuthenticatedUser({ per_page: 100 });
    return response.data;
  } catch (err) {
    console.error("Failed to fetch repositories:", err);
    return [];
  }
}

// Calculate total stars across all repos
function calculateTotalStars(data) {
  return data.reduce((sum, repo) => sum + repo.stargazers_count, 0);
}

// Calculate total commits with optional cutoffDate
async function calculateTotalCommits(data, cutoffDate) {
  const githubUsername = process.env.GH_USERNAME;
  const contributorsRequests = [];

  data.forEach((repo) => {
    const lastRepoUpdate = new Date(repo.updated_at);
    if (!cutoffDate || lastRepoUpdate > cutoffDate) {
      contributorsRequests.push(
        octokit.rest.repos.getContributorsStats({
          owner: githubUsername,
          repo: repo.name,
        })
      );
    }
  });

  return getTotalCommits(contributorsRequests, githubUsername, cutoffDate);
}

// Aggregate commits from multiple repos
async function getTotalCommits(requests, contributor, cutoffDate) {
  let totalCommits = 0;

  const repos = await Promise.all(requests.map((req) => req.catch(() => ({ data: [] }))));

  repos.forEach((repo) => {
    const index = repo.data.findIndex((item) => item.author?.login === contributor);
    if (index !== -1) {
      const contributorStats = repo.data[index];
      totalCommits += !cutoffDate
        ? contributorStats.total
        : computeCommitsBeforeCutoff(contributorStats, cutoffDate);
    }
  });

  return totalCommits;
}

// Count commits before a cutoff date
function computeCommitsBeforeCutoff(contributorData, cutoffDate) {
  const MILLISECONDS_IN_A_SECOND = 1000;

  return contributorData.weeks
    .filter((week) => new Date(week.w * MILLISECONDS_IN_A_SECOND) > cutoffDate)
    .reduce((sum, week) => sum + week.c, 0);
}

// Update README from Mustache template
async function updateReadme(userData) {
  try {
    const template = await fs.readFile("./main.mustache", "utf-8");
    const output = Mustache.render(template, userData);
    await fs.writeFile("README.md", output, "utf-8");
    console.log("README.md updated successfully!");
  } catch (err) {
    console.error("Failed to update README:", err);
  }
}

// Main entry point
async function main() {
  const repoData = await grabDataFromAllRepositories();

  const totalStars = calculateTotalStars(repoData);

  const lastYear = new Date();
  lastYear.setFullYear(lastYear.getFullYear() - 1);

  const totalCommitsInPastYear = await calculateTotalCommits(repoData, lastYear);

  const colors = ["474342", "fbedf6", "c9594d", "f8b9b2", "ae9c9d"];

  await updateReadme({ totalStars, totalCommitsInPastYear, colors });
}

main();
