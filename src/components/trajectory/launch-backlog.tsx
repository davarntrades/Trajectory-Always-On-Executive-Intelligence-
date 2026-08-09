"use client";

import { useCallback, useEffect, useState } from "react";
import { TrajectoryMark } from "@/components/trajectory/celestial-motion";
import { evidenceLabel } from "@/lib/work/canonical";
import type { WorkBoard, WorkItem } from "@/lib/work/types";

/**
 * The work surface: what is active, what is next, what is blocked, and what
 * has recently been delivered.
 *
 * It sits below the Executive Signal rather than beside the orb, because the
 * orb remains the emotional centre and this is supporting evidence. It reuses
 * the existing card material and the shooting-star mark; no new visual
 * language is introduced.
 */

const emptyBoard: WorkBoard = { activePriority: null, nextOpen: [], blocked: [], recentlyCompleted: [] };

function ItemRow({ item, onActivate }: { item: WorkItem; onActivate?: (id: string) => void }) {
  const reference = evidenceLabel(item);
  const body = (
    <>
      <span className="work-item-title">{item.title}</span>
      <span className="work-item-reference">{reference}</span>
    </>
  );
  return (
    <li className={`work-item is-${item.status}`}>
      {item.externalRef?.url ? (
        <a href={item.externalRef.url} target="_blank" rel="noreferrer noopener">{body}</a>
      ) : (
        <span>{body}</span>
      )}
      {onActivate ? (
        <button type="button" className="work-item-activate" onClick={() => onActivate(item.id)}>
          Make active
        </button>
      ) : null}
    </li>
  );
}

export function LaunchBacklog({ initialBoard }: { initialBoard?: WorkBoard }) {
  const [board, setBoard] = useState<WorkBoard>(initialBoard ?? emptyBoard);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /**
   * Returns the board rather than setting it, so callers own the state write
   * and a read that resolves after unmount cannot land.
   */
  const fetchBoard = useCallback(async (): Promise<WorkBoard | null> => {
    try {
      const response = await fetch("/api/work-items", { cache: "no-store" });
      if (!response.ok) return null;
      const body = await response.json() as { board?: WorkBoard };
      return body.board ?? emptyBoard;
    } catch {
      // A failed read leaves the last known board in place rather than
      // blanking the surface, which would read as "no work" — the exact
      // wrong signal.
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await fetchBoard();
      if (!cancelled && next) setBoard(next);
    })();
    return () => { cancelled = true; };
  }, [fetchBoard]);

  const addTask = useCallback(async () => {
    const trimmed = title.trim();
    if (trimmed.length < 3 || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/work-items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!response.ok) throw new Error("rejected");
      setTitle("");
      const next = await fetchBoard();
      if (next) setBoard(next);
    } catch {
      setMessage("That launch task could not be saved.");
    } finally {
      setBusy(false);
    }
  }, [busy, fetchBoard, title]);

  const activate = useCallback(async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/work-items", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, activate: true }),
      });
      if (response.ok) {
        const body = await response.json() as { board: WorkBoard };
        setBoard(body.board ?? emptyBoard);
      }
    } catch {
      setMessage("The active priority could not be changed.");
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const sync = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/work-items/sync", { method: "POST" });
      const body = await response.json() as { board?: WorkBoard; ingested?: number; error?: string };
      if (!response.ok) { setMessage(body.error ?? "GitHub work could not be ingested."); return; }
      if (body.board) setBoard(body.board);
      setMessage(`Ingested ${body.ingested ?? 0} GitHub items.`);
    } catch {
      setMessage("GitHub work could not be ingested.");
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const nothingTracked =
    !board.activePriority && !board.nextOpen.length && !board.blocked.length && !board.recentlyCompleted.length;

  return (
    <section className="work-board" aria-label="Launch backlog">
      <div className="card-eyebrow">
        <span><TrajectoryMark className="mark-inline" /> Launch backlog</span>
        <button type="button" className="work-sync" onClick={sync} disabled={busy}>
          {busy ? "Working…" : "Sync GitHub"}
        </button>
      </div>

      <div className="work-columns">
        <div>
          <span>Active priority</span>
          {board.activePriority
            ? <ul><ItemRow item={board.activePriority} /></ul>
            : <p className="work-empty">No active priority is set.</p>}
        </div>
        <div>
          <span>Next open</span>
          {board.nextOpen.length
            ? <ul>{board.nextOpen.map((item) => <ItemRow key={item.id} item={item} onActivate={activate} />)}</ul>
            : <p className="work-empty">Nothing is tracked as open.</p>}
        </div>
        <div>
          <span>Blocked</span>
          {board.blocked.length
            ? <ul>{board.blocked.map((item) => <ItemRow key={item.id} item={item} />)}</ul>
            : <p className="work-empty">Nothing is blocked.</p>}
        </div>
        <div>
          <span>Recently completed</span>
          {board.recentlyCompleted.length
            ? <ul>{board.recentlyCompleted.map((item) => <ItemRow key={item.id} item={item} />)}</ul>
            : <p className="work-empty">Nothing completed yet.</p>}
        </div>
      </div>

      {nothingTracked ? (
        <p className="work-empty work-empty-wide">
          Trajectory has no tracked work to prioritise against. Add a launch task or sync GitHub.
        </p>
      ) : null}

      <div className="work-compose">
        <label className="sr-only" htmlFor="work-title">New launch task</label>
        <input
          id="work-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void addTask(); }}
          placeholder="Add a launch task…"
          maxLength={280}
        />
        <button type="button" onClick={addTask} disabled={busy || title.trim().length < 3}>Add</button>
      </div>
      {message ? <p className="work-message" role="status">{message}</p> : null}
    </section>
  );
}
