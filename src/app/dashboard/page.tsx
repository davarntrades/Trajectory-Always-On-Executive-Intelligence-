import Link from "next/link";
import { signOutAction } from "@/app/(auth)/actions";
import { trajectoryLanguage as language } from "@/content/trajectory-language";
import { getCurrentUser } from "@/lib/auth/session";
import { listConnectorAccounts } from "@/lib/connectors/accounts";
import { getWorkspaceRepository } from "@/lib/workspace/repository";
import { getStore } from "@/lib/store";
import { disconnectConnectorAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [user, repository, store] = await Promise.all([getCurrentUser(), getWorkspaceRepository(), getStore()]);
  const [interactions, goals, briefs, history, settings, connectors, memories, usage] = await Promise.all([
    repository.listConversations(12), repository.listGoals(), repository.listBriefs(8), repository.listHistory(12),
    repository.getSettings(), listConnectorAccounts(), store.memories(), repository.listProviderUsage(30),
  ]);

  return <main className="dashboard-shell">
    <header className="dashboard-header"><div><p>{language.dashboard.workspace}</p><h1>{user?.displayName ?? language.dashboard.fallbackIdentity}</h1></div>
      <nav aria-label={language.dashboard.navigation}><Link href="/">{language.dashboard.returnToOrb}</Link><form action={signOutAction}><button type="submit">{language.auth.signOut}</button></form></nav></header>

    <section className="dashboard-grid" aria-label={language.dashboard.overview}>
      <article className="dashboard-panel dashboard-wide"><p className="dashboard-kicker">{language.dashboard.continuousMemory}</p><h2>{language.dashboard.recentInteractions}</h2>
        {interactions.length ? <ul>{interactions.map((item) => <li key={item.id}><span>{item.title}</span><time>{new Date(item.updatedAt).toLocaleDateString("en-GB")}</time></li>)}</ul> : <p className="dashboard-empty">{language.voice.firstInteraction}</p>}</article>

      <article className="dashboard-panel"><p className="dashboard-kicker">{language.dashboard.direction}</p><h2>{language.dashboard.goals}</h2>
        {goals.length ? <ul>{goals.map((goal) => <li key={goal.id}><span>{goal.title}</span><small>{goal.status}</small></li>)}</ul> : <p className="dashboard-empty">{language.dashboard.noGoals}</p>}</article>

      <article className="dashboard-panel"><p className="dashboard-kicker">{language.dashboard.profileSettings}</p><h2>{user?.email ?? user?.displayName}</h2>
        <p className="dashboard-empty">{settings.timezone} · {language.headings.voice} {settings.voiceEnabled ? language.status.enabled : language.status.disabled} · {language.dashboard.backgroundIntelligence} {settings.backgroundIntelligenceEnabled ? language.status.enabled : language.status.disabled}</p></article>

      <article className="dashboard-panel"><p className="dashboard-kicker">{language.dashboard.memory}</p><h2>{language.dashboard.activeKnowledge}</h2>
        <p className="dashboard-value">{memories.length}</p><p className="dashboard-empty">{language.dashboard.activeKnowledgeCopy}</p></article>

      <article className="dashboard-panel"><p className="dashboard-kicker">{language.dashboard.usage}</p><h2>{language.dashboard.providerCalls}</h2>
        <p className="dashboard-value">{usage.length}</p><p className="dashboard-empty">{language.dashboard.providerCallsCopy}</p></article>

      <article className="dashboard-panel"><p className="dashboard-kicker">{language.dashboard.intelligence}</p><h2>{language.dashboard.provider}</h2>
        <p className="dashboard-value">{settings.provider}</p><p className="dashboard-empty">{language.dashboard.providerControlCopy}</p></article>

      <article className="dashboard-panel dashboard-wide"><p className="dashboard-kicker">{language.dashboard.connectedWorld}</p><h2>{language.dashboard.services}</h2>
        <div className="connector-list">{connectors.map(({ id, name, configured, connection }) => {
          const connected = connection.status === "connected";
          return <div className="connector-row" key={id}><div><strong>{name}</strong><span>{connected ? `${language.status.connected} · ${connection.sync_status}` : configured ? language.status.readyToConnect : language.status.configurationRequired}</span></div>{connected ? <form action={disconnectConnectorAction}><input type="hidden" name="connectorId" value={id} /><button type="submit">{language.dashboard.disconnect}</button></form> : configured ? <a href={`/api/connectors/${id}/connect`}>{language.dashboard.connect}</a> : <span className="connector-muted">{language.status.unavailable}</span>}</div>;
        })}</div></article>

      <article className="dashboard-panel"><p className="dashboard-kicker">{language.dashboard.briefArchive}</p><h2>{language.dashboard.dailyBriefs}</h2>
        <p className="dashboard-value">{briefs.length}</p><p className="dashboard-empty">{language.dailySummary.archive}</p></article>

      <article className="dashboard-panel"><p className="dashboard-kicker">{language.dashboard.trajectoryTimeline}</p><h2>{language.dashboard.observations}</h2>
        <p className="dashboard-value">{history.length}</p><p className="dashboard-empty">{language.dashboard.observationsCopy}</p></article>
    </section>
  </main>;
}
