// Capacity reservations: never promise the same hours twice.
//
// A person has `weeklyHours` they are willing to give and `committedHours`
// already taken by active engagements. Reservations sit on top:
//   soft — a hold while a demand is deciding; expires (default 72 h)
//   hard — tied to an accepted engagement; released only by an event
//
// A hard request is checked against hard reservations only, and pre-empts
// soft holds it would collide with (they are released, with an event, so the
// other demand's owner finds out). A soft request is checked against both.
// That ordering is the product rule: an accepted engagement beats a maybe.

const DAY = 86_400_000;
export const DEFAULT_SOFT_HOLD_HOURS = 72;

function overlaps(a, b) {
  return Date.parse(a.from) < Date.parse(b.to) && Date.parse(b.from) < Date.parse(a.to);
}

function live(r, now) {
  if (r.state === "hard") return true;
  if (r.state === "soft") return Date.parse(r.expiresAt) > now;
  return false;
}

/**
 * Try to reserve.
 * @returns {{ ok: true, reservation, preempted: object[] } | { ok: false, reason, available, requested, window }}
 */
export function reserve({ capacity, existing = [], request, now }) {
  if (!capacity?.consented) return { ok: false, reason: "capacity_not_consented" };
  if (!(request.hoursPerWeek > 0)) return { ok: false, reason: "invalid_hours" };
  if (!(Date.parse(request.to) > Date.parse(request.from))) return { ok: false, reason: "invalid_window" };
  if (request.kind !== "soft" && request.kind !== "hard") return { ok: false, reason: "invalid_kind" };

  const budget = capacity.weeklyHours - (capacity.committedHours ?? 0);
  // Holds from the same demand are replaced, not stacked: converting a soft
  // hold into a hard one must not count the person twice.
  const others = existing.filter((r) => live(r, now) && r.demandId !== request.demandId && overlaps(r, request));
  const blocking = request.kind === "hard" ? others.filter((r) => r.state === "hard") : others;
  const used = peakHours(blocking, request);

  if (used + request.hoursPerWeek > budget + 1e-9) {
    return {
      ok: false,
      reason: "capacity_conflict",
      available: Math.max(0, round(budget - used)),
      requested: request.hoursPerWeek,
      window: { from: request.from, to: request.to },
    };
  }

  const preempted =
    request.kind === "hard"
      ? preemptSoft(others.filter((r) => r.state === "soft"), budget - used - request.hoursPerWeek, request)
      : [];

  const reservation = {
    capacityId: capacity.id,
    demandId: request.demandId,
    state: request.kind,
    hoursPerWeek: request.hoursPerWeek,
    from: request.from,
    to: request.to,
    expiresAt:
      request.kind === "soft"
        ? new Date(now + (request.holdHours ?? DEFAULT_SOFT_HOLD_HOURS) * 3_600_000).toISOString()
        : null,
    authorityId: request.authorityId ?? null,
    ownerActorId: request.ownerActorId ?? null,
  };
  return { ok: true, reservation, preempted };
}

// Soft holds are released, largest first, until what is left fits.
function preemptSoft(softs, headroom, request) {
  const remaining = [...softs].sort((a, b) => b.hoursPerWeek - a.hoursPerWeek);
  const out = [];
  while (remaining.length > 0 && peakHours(remaining, request) > headroom + 1e-9) {
    const s = remaining.shift();
    out.push({ ...s, state: "preempted", releaseReason: `preempted_by_hard:${request.demandId}` });
  }
  return out;
}

// The worst week inside the request window. Reservations are piecewise
// constant, so the peak is at one of the boundaries.
function peakHours(reservations, window) {
  const points = new Set([Date.parse(window.from)]);
  for (const r of reservations) {
    for (const t of [Date.parse(r.from), Date.parse(r.to)]) {
      if (t >= Date.parse(window.from) && t < Date.parse(window.to)) points.add(t);
    }
  }
  let peak = 0;
  for (const t of points) {
    const at = reservations
      .filter((r) => Date.parse(r.from) <= t && t < Date.parse(r.to))
      .reduce((s, r) => s + r.hoursPerWeek, 0);
    peak = Math.max(peak, at);
  }
  return peak;
}

/** Soft holds whose time has passed. The caller emits ReservationExpired for each. */
export function expiredHolds(existing, now) {
  return existing.filter((r) => r.state === "soft" && Date.parse(r.expiresAt) <= now);
}

export function freeHoursAt(capacity, existing, at, now) {
  const t = Date.parse(at);
  const used = existing
    .filter((r) => live(r, now) && Date.parse(r.from) <= t && t < Date.parse(r.to))
    .reduce((s, r) => s + r.hoursPerWeek, 0);
  return round(capacity.weeklyHours - (capacity.committedHours ?? 0) - used);
}

function round(x) {
  return Math.round(x * 100) / 100;
}

export const _internal = { overlaps, peakHours, DAY };
