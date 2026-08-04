import { NextResponse } from "next/server";
import { runSimulation } from "@/lib/simulation";

export const dynamic = "force-dynamic";

/**
 * Price the available actions against a do-nothing baseline.
 *
 * `?n=` trajectories per arm, `?horizon=` days, `?k=` candidates to simulate.
 *
 * Every response carries a calibration block. Until predictions have been
 * resolved against outcomes, it reads `uncalibrated` — the magnitudes are a
 * relative ordering, not probabilities to bank on.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const n = Number(url.searchParams.get("n") ?? 200);
  const horizon = Number(url.searchParams.get("horizon") ?? 21);
  const topK = Number(url.searchParams.get("k") ?? 4);

  if (!Number.isFinite(n) || n < 1 || n > 5000) {
    return NextResponse.json({ error: "n must be between 1 and 5000" }, { status: 400 });
  }
  if (!Number.isFinite(horizon) || horizon < 1 || horizon > 365) {
    return NextResponse.json(
      { error: "horizon must be between 1 and 365 days" },
      { status: 400 },
    );
  }

  try {
    const report = await runSimulation({
      trajectories: n,
      horizonDays: horizon,
      topK,
    });
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "simulation failed" },
      { status: 500 },
    );
  }
}
