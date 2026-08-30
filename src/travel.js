const MINUTE_MS = 60 * 1000;
const NEXT_TURN_MINUTES = 24 * 60;

export const ACTION_DURATION_MINUTES = Object.freeze({
  deliver: 20,
  observe: 30,
  work: 120,
  eat: 30,
  rest: 60,
});

function locationFor(town, id) {
  return (town.locations ?? []).find((location) => location.id === id) ?? null;
}

export function travelMinutesBetween(town, fromId, toId) {
  if (!fromId || !toId || fromId === toId) return 0;
  const from = locationFor(town, fromId);
  const to = locationFor(town, toId);
  if (!from || !to) return Number.POSITIVE_INFINITY;
  return Math.max(5, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y)));
}

export function serviceMinutesFor(action) {
  return ACTION_DURATION_MINUTES[action] ?? 30;
}

export function obligationsBeforeNextTurn(town, resident, now, limit = 3) {
  const planningAt = new Date(now);
  if (Number.isNaN(planningAt.getTime())) return [];
  const boundary = planningAt.getTime() + NEXT_TURN_MINUTES * MINUTE_MS;
  return (town?.obligations ?? [])
    .filter((obligation) => (
      obligation.ownerId === resident?.id
      && obligation.status === "open"
      && Number.isFinite(new Date(obligation.dueAt).getTime())
      && new Date(obligation.dueAt).getTime() <= boundary
    ))
    .sort((left, right) => String(left.dueAt).localeCompare(String(right.dueAt)) || left.id.localeCompare(right.id))
    .slice(0, limit);
}

export function projectObligationOrder(town, resident, obligations, now) {
  let availableAt = new Date(now).getTime();
  let locationId = resident.locationId;
  const steps = [];
  for (const obligation of obligations) {
    const travelMinutes = travelMinutesBetween(town, locationId, obligation.destinationId);
    const arrivalAt = availableAt + travelMinutes * MINUTE_MS;
    const dueAt = new Date(obligation.dueAt).getTime();
    const meetsDeadline = Number.isFinite(arrivalAt) && Number.isFinite(dueAt) && arrivalAt <= dueAt;
    const latenessMinutes = meetsDeadline || !Number.isFinite(arrivalAt) || !Number.isFinite(dueAt)
      ? 0
      : Math.ceil((arrivalAt - dueAt) / MINUTE_MS);
    steps.push({
      obligationId: obligation.id,
      destinationId: obligation.destinationId,
      arrivalAt: Number.isFinite(arrivalAt) ? new Date(arrivalAt).toISOString() : null,
      dueAt: obligation.dueAt,
      travelMinutes,
      serviceMinutes: serviceMinutesFor(obligation.requiredAction ?? "deliver"),
      meetsDeadline,
      latenessMinutes,
    });
    availableAt = arrivalAt + serviceMinutesFor(obligation.requiredAction ?? "deliver") * MINUTE_MS;
    locationId = obligation.destinationId;
  }
  return {
    allMeet: steps.every(({ meetsDeadline }) => meetsDeadline),
    metCount: steps.filter(({ meetsDeadline }) => meetsDeadline).length,
    totalLatenessMinutes: steps.reduce((total, step) => total + step.latenessMinutes, 0),
    completedAt: Number.isFinite(availableAt) ? new Date(availableAt).toISOString() : null,
    steps,
  };
}

function permutations(values) {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) => (
    permutations([...values.slice(0, index), ...values.slice(index + 1)])
      .map((tail) => [value, ...tail])
  ));
}

export function bestObligationOrder(town, resident, obligations, now, { firstId = null } = {}) {
  const orders = permutations(obligations).filter((order) => !firstId || order[0]?.id === firstId);
  const candidates = orders.map((order) => ({
    order,
    projection: projectObligationOrder(town, resident, order, now),
  }));
  return candidates.sort((left, right) => (
    Number(right.projection.allMeet) - Number(left.projection.allMeet)
    || right.projection.metCount - left.projection.metCount
    || left.projection.totalLatenessMinutes - right.projection.totalLatenessMinutes
    || String(left.projection.completedAt).localeCompare(String(right.projection.completedAt))
    || left.order.map(({ id }) => id).join("|").localeCompare(right.order.map(({ id }) => id).join("|"))
  ))[0] ?? { order: [], projection: { allMeet: true, metCount: 0, totalLatenessMinutes: 0, steps: [] } };
}

export function schedulePlanActions(town, resident, actions, planAt) {
  const startedAt = new Date(planAt).getTime();
  let availableAt = startedAt;
  let locationId = resident.locationId;
  return actions.map((action, sequence) => {
    const offsetMinutes = action.offsetMinutes ?? sequence * 60;
    const plannedAt = startedAt + offsetMinutes * MINUTE_MS;
    const departAt = Math.max(plannedAt, availableAt);
    const travelMinutes = travelMinutesBetween(town, locationId, action.locationId);
    const scheduledAt = departAt + travelMinutes * MINUTE_MS;
    const serviceMinutes = serviceMinutesFor(action.action);
    availableAt = scheduledAt + serviceMinutes * MINUTE_MS;
    locationId = action.locationId;
    return {
      plannedAt: new Date(plannedAt).toISOString(),
      scheduledAt: new Date(scheduledAt).toISOString(),
      travelMinutes,
      serviceMinutes,
    };
  });
}
