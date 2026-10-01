// The event envelope (blueprint §18.2 + schema_version + privacy_class) and
// the idempotency store every consequential write goes through.

import { createHash, randomUUID } from "node:crypto";

export const PRIVACY_CLASSES = Object.freeze(["public", "tenant", "subject", "restricted"]);

const REQUIRED = [
  "event_id",
  "event_type",
  "schema_version",
  "entity_type",
  "entity_id",
  "entity_version",
  "actor_id",
  "tenant_id",
  "occurred_at",
  "recorded_at",
  "correlation_id",
  "idempotency_key",
  "source_system",
  "privacy_class",
  "payload",
];

export function makeEvent({
  type,
  entityType,
  entityId,
  entityVersion,
  actorId,
  authorityId = null,
  tenantId,
  correlationId,
  causationId = null,
  idempotencyKey,
  sourceSystem = "aco.v2",
  privacyClass = "tenant",
  payload = {},
  evidenceRefs = [],
  policyDecisionId = null,
  now,
  id = randomUUID(),
}) {
  const at = new Date(now).toISOString();
  const event = {
    event_id: id,
    event_type: type,
    schema_version: 1,
    entity_type: entityType,
    entity_id: entityId,
    entity_version: entityVersion,
    actor_id: actorId,
    authority_id: authorityId,
    tenant_id: tenantId,
    occurred_at: at,
    recorded_at: at,
    correlation_id: correlationId,
    causation_id: causationId,
    idempotency_key: idempotencyKey,
    source_system: sourceSystem,
    privacy_class: privacyClass,
    payload,
    evidence_refs: evidenceRefs,
    policy_decision_id: policyDecisionId,
  };
  const problems = validateEvent(event);
  if (problems.length) throw new Error(`invalid event: ${problems.join("; ")}`);
  return Object.freeze(event);
}

export function validateEvent(e) {
  const problems = [];
  for (const k of REQUIRED) if (e[k] === undefined || e[k] === null || e[k] === "") problems.push(`${k} missing`);
  if (e.privacy_class && !PRIVACY_CLASSES.includes(e.privacy_class)) problems.push("privacy_class invalid");
  if (!Number.isInteger(e.entity_version) || e.entity_version < 1) problems.push("entity_version must be a positive integer");
  if (!/^[A-Z][A-Za-z]+$/.test(e.event_type || "")) problems.push("event_type must be PascalCase");
  if (!Array.isArray(e.evidence_refs)) problems.push("evidence_refs must be an array");
  return problems;
}

export function hashRequest(body) {
  return createHash("sha256").update(stableStringify(body)).digest("hex");
}

// Key order must not change a hash, or the same request retried from a
// different client would look like a different request.
export function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  return `{${Object.keys(v)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`)
    .join(",")}}`;
}

export class IdempotencyConflict extends Error {
  constructor(key) {
    super(`idempotency key ${key} was already used for a different request`);
    this.code = "idempotency_conflict";
  }
}

/**
 * In-memory stand-in for v2.idempotency_keys. Same contract as the table:
 * same key + same request → the stored result, nothing re-executed;
 * same key + different request → refusal.
 */
export function createIdempotencyStore() {
  const seen = new Map();
  return {
    run(key, requestBody, fn) {
      if (!key) throw new Error("idempotency key required");
      const h = hashRequest(requestBody);
      const prior = seen.get(key);
      if (prior) {
        if (prior.hash !== h) throw new IdempotencyConflict(key);
        return { ...prior.result, replayed: true };
      }
      const result = fn();
      seen.set(key, { hash: h, result });
      return { ...result, replayed: false };
    },
    get size() {
      return seen.size;
    },
  };
}
