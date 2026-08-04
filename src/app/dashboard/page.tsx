import Link from "next/link";
import { signOutAction } from "@/app/(auth)/actions";
import { getCurrentUser } from "@/lib/auth/session";
import { listConnectorAccounts } from "@/lib/connectors/accounts";
import { getWorkspaceRepository } from "@/lib/workspace/repository";
import { getStore } from "@/lib/store";
import { disconnectConnectorAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [user, repository, store] = await Promise.all([getCurrentUser(), getWorkspaceRepository(), getStore()]);
  const [conversations, goals, briefs, history, settings, connectors, memories, usage] = await Promise.all([
    repository.listConversations(12),
    repository.listGoals(),
    repository.listBriefs(8),
    repository.listHistory(12),
    repository.getSettings(),
    listConnectorAccounts(),
    store.memories(),
    repository.listProviderUsage(30),
  ]);

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div><p>Trajectory workspace</p><h1>{user?.displayName ?? "Executive intelligence"}</h1></div>
        <nav aria-label="Workspace navigation"><Link href="/">Return to orb</Link><form action={signOutAction}><button type="submit">Sign out</button></form></nav>
      </header>

      <section className="dashboard-grid" aria-label="Workspace overview">
        <article className="dashboard-panel dashboard-wide">
          <p className="dashboard-kicker">Continuous memory</p><h2>Recent conversations</h2>
          {conversations.length ? <ul>{conversations.map((item) => <li key={item.id}><span>{item.title}</span><time>{new Date(item.updatedAt).toLocaleDateString("en-GB")}</time></li>)}</ul> : <p className="dashboard-empty">Your first voice interaction will appear here.</p>}
        </article>

        <article className="dashboard-panel">
          <p className="dashboard-kicker">Direction</p><h2>Goals</h2>
          {goals.length ? <ul>{goals.map((goal) => <li key={goal.id}><span>{goal.title}</span><small>{goal.status}</small></li>)}</ul> : <p className="dashboard-empty">No goals have been defined yet.</p>}
        </article>

        <article className="dashboard-panel">
          <p className="dashboard-kicker">Profile &amp; settings</p><h2>{user?.email ?? user?.displayName}</h2>
          <p className="dashboard-empty">{settings.timezone} · Voice {settings.voiceEnabled ? "enabled" : "disabled"} · Background intelligence {settings.backgroundIntelligenceEnabled ? "enabled" : "disabled"}</p>
        </article>

        <article className="dashboard-panel">
          <p className="dashboard-kicker">Memory</p><h2>Active knowledge</h2>
          <p className="dashboard-value">{memories.length}</p><p className="dashboard-empty">User-owned decisions, preferences and remembered context.</p>
        </article>

        <article className="dashboard-panel">
          <p className="dashboard-kicker">Usage</p><h2>Provider calls</h2>
          <p className="dashboard-value">{usage.length}</p><p className="dashboard-empty">Recent recorded model invocations. Prompts and credentials are never shown here.</p>
        </article>

        <article className="dashboard-panel">
          <p className="dashboard-kicker">Intelligence</p><h2>Provider</h2>
          <p className="dashboard-value">{settings.provider}</p>
          <p className="dashboard-empty">Change this from the existing provider control beside the orb.</p>
        </article>

        <article className="dashboard-panel dashboard-wide">
          <p className="dashboard-kicker">Connected world</p><h2>Services</h2>
          <div className="connector-list">{connectors.map(({ id, name, configured, connection }) => {
            const connected = connection.status === "connected";
            return <div className="connector-row" key={id}><div><strong>{name}</strong><span>{connected ? `Connected · ${connection.sync_status}` : configured ? "Ready to connect" : "OAuth configuration required"}</span></div>{connected ? <form action={disconnectConnectorAction}><input type="hidden" name="connectorId" value={id} /><button type="submit">Disconnect</button></form> : configured ? <a href={`/api/connectors/${id}/connect`}>Connect</a> : <span className="connector-muted">Unavailable</span>}</div>;
          })}</div>
        </article>

        <article className="dashboard-panel">
          <p className="dashboard-kicker">Brief archive</p><h2>Daily briefs</h2>
          <p className="dashboard-value">{briefs.length}</p><p className="dashboard-empty">Stored briefs in this workspace.</p>
        </article>

        <article className="dashboard-panel">
          <p className="dashboard-kicker">Trajectory timeline</p><h2>Observations</h2>
          <p className="dashboard-value">{history.length}</p><p className="dashboard-empty">Recent direction changes retained.</p>
        </article>
      </section>
    </main>
  );
}
