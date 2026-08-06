import { NextResponse } from "next/server";
import { AuthenticationRequiredError } from "@/lib/auth/session";
import { buildWorkBoard, rankOpenWork } from "@/lib/work/canonical";
import { GitHubIngestionError, githubIngestionConfigured, ingestGitHubWorkItems } from "@/lib/work/github";
import { listWorkItems, persistIngestedWorkItems } from "@/lib/work/repository";

export const dynamic = "force-dynamic";

/**
 * Pulls current GitHub issues and pull requests into the canonical work set.
 *
 * Failures are reported with the provider status rather than collapsed into a
 * generic error — the same lesson as the voice pipeline: an ingestion that
 * fails silently is worse than one that fails loudly, because the open-work
 * set then goes stale without anything saying so.
 */
export async function POST() {
  const startedAt = Date.now();
  try {
    if (!githubIngestionConfigured()) {
      return NextResponse.json(
        {
          error: "GitHub ingestion is not configured.",
          missing: ["GITHUB_INGESTION_TOKEN", "GITHUB_INGESTION_REPOSITORY"],
        },
        { status: 503 },
      );
    }

    const ingested = await ingestGitHubWorkItems();
    const written = await persistIngestedWorkItems(ingested);
    const items = await listWorkItems();
    const board = buildWorkBoard(items);

    console.info("[trajectory:work-sync]", {
      event: "ingestion_completed",
      at: new Date().toISOString(),
      ingested: ingested.length,
      written,
      openCount: rankOpenWork(items).length,
      completedCount: items.filter((item) => item.status === "completed").length,
      latencyMs: Date.now() - startedAt,
    });

    return NextResponse.json({ ingested: ingested.length, written, board });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    const status = error instanceof GitHubIngestionError ? error.status ?? null : null;
    console.error("[trajectory:work-sync]", {
      event: "ingestion_failed",
      at: new Date().toISOString(),
      githubStatus: status,
      githubRequestId: error instanceof GitHubIngestionError ? error.requestId ?? null : null,
      errorType: error instanceof Error ? error.name : "unknown",
      message: error instanceof Error ? error.message : "unknown",
      latencyMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      { error: "GitHub work could not be ingested.", githubStatus: status },
      { status: 502 },
    );
  }
}
