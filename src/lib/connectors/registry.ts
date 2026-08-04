/**
 * Connector registry.
 *
 * Connectors self-register here. Nothing else in the system enumerates them, so
 * adding Slack means adding one file and one import — the state engine, memory
 * and dashboard need no changes because they consume normalised events.
 */

import type { Capability, Connector, ConnectorContext, SyncResult, TrajectoryEvent } from "@/lib/types";

const registry = new Map<string, Connector>();

export function register(connector: Connector): Connector {
  registry.set(connector.id, connector);
  return connector;
}

export function getConnector(id: string): Connector | undefined {
  return registry.get(id);
}

export function allConnectors(): Connector[] {
  return [...registry.values()];
}

export function configuredConnectors(): Connector[] {
  return allConnectors().filter((c) => c.isConfigured());
}

/**
 * Helper for defining a connector. Handles the boilerplate so an implementation
 * is just: which env vars gate it, how to pull, how to normalise.
 */
export function defineConnector(spec: {
  id: string;
  name: string;
  description: string;
  capabilities: Capability[];
  /** Env vars that must all be present for this connector to be usable. */
  requiredEnv: string[];
  pull?: (ctx: ConnectorContext) => Promise<SyncResult>;
}): Connector {
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    capabilities: spec.capabilities,
    isConfigured: () => spec.requiredEnv.every((k) => Boolean(process.env[k])),
    async sync(ctx: ConnectorContext): Promise<SyncResult> {
      if (!spec.pull) return { events: [] };
      return spec.pull(ctx);
    },
  };
}

/**
 * Normalise an arbitrary payload into a TrajectoryEvent. Every connector routes
 * through this so the event shape is enforced in one place.
 */
export function toEvent(input: {
  source: string;
  type: string;
  title: string;
  body?: string;
  occurredAt: string | Date;
  externalId?: string;
  entityIds?: string[];
  projectId?: string;
  payload?: Record<string, unknown>;
}): TrajectoryEvent {
  return {
    id: crypto.randomUUID(),
    source: input.source,
    type: input.type,
    title: input.title,
    body: input.body,
    occurredAt:
      input.occurredAt instanceof Date
        ? input.occurredAt.toISOString()
        : new Date(input.occurredAt).toISOString(),
    entityIds: input.entityIds ?? [],
    projectId: input.projectId,
    externalId: input.externalId,
    payload: input.payload ?? {},
  };
}
