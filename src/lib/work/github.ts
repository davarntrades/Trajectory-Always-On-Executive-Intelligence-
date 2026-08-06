import "server-only";

import { config, githubIngestionDiagnostics } from "@/lib/config";
import {
  normaliseGitHubIssue,
  normaliseGitHubPullRequest,
  type GitHubIssuePayload,
  type GitHubPullRequestPayload,
} from "./canonical";
import type { WorkItem } from "./types";

/**
 * GitHub ingestion for the Trajectory repository.
 *
 * Scope is deliberately one repository and two resources. The point of this
 * slice is a trustworthy current-state evidence layer, not connector breadth —
 * a second source would multiply the ways the open-work set can go stale
 * before the first one is proven.
 */

const API = "https://api.github.com";

export class GitHubIngestionError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly requestId?: string | null,
  ) {
    super(message);
    this.name = "GitHubIngestionError";
  }
}

/** Kept in step with the health diagnostics so both read the same settings. */
export function githubIngestionConfigured(): boolean {
  return githubIngestionDiagnostics().configured;
}

async function fetchPage<T>(path: string): Promise<T[]> {
  const response = await fetch(`${API}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${config.githubToken}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "trajectory-open-work-ingestion",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    // Rate limiting and permission failures are the two that will actually
    // happen in production, and both are silent unless surfaced with status.
    throw new GitHubIngestionError(
      `GitHub returned ${response.status} for ${path}`,
      response.status,
      response.headers.get("x-github-request-id"),
    );
  }

  const body = (await response.json()) as unknown;
  return Array.isArray(body) ? (body as T[]) : [];
}

/**
 * Pulls current issues and pull requests. Both are fetched with `state=all`:
 * closed and merged items are not noise, they are the evidence that stops
 * finished work being recommended again.
 */
export async function ingestGitHubWorkItems(limit = 50): Promise<WorkItem[]> {
  if (!githubIngestionConfigured()) {
    throw new GitHubIngestionError("GitHub ingestion is not configured");
  }
  const repository = config.githubRepository as string;
  const perPage = Math.min(100, Math.max(1, limit));

  const [issues, pulls] = await Promise.all([
    fetchPage<GitHubIssuePayload>(
      `/repos/${repository}/issues?state=all&per_page=${perPage}&sort=updated&direction=desc`,
    ),
    fetchPage<GitHubPullRequestPayload>(
      `/repos/${repository}/pulls?state=all&per_page=${perPage}&sort=updated&direction=desc`,
    ),
  ]);

  // The issues endpoint returns pull requests as well. Dropping them here
  // keeps a pull request from existing twice under two different ids.
  const issueItems = issues
    .filter((issue) => !issue.pull_request)
    .map((issue) => normaliseGitHubIssue(issue, repository));
  const pullItems = pulls.map((pull) => normaliseGitHubPullRequest(pull, repository));

  return [...issueItems, ...pullItems];
}
