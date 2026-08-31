const app = document.querySelector("#app");
const connectionLabel = document.querySelector("#connection-label");

const store = {
  town: null,
  events: [],
  error: null,
  refreshedAt: null,
  selectedLocationId: "square",
  selectedResidentId: "mara",
};

const CONSEQUENTIAL_EVENT_TYPES = new Set([
  "obligation",
  "obligation-created",
  "encounter",
  "action-interrupted",
  "model-fallback",
]);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function routeLink(path, label, className = "") {
  return `<a class="${className}" href="${path}" data-route>${label}</a>`;
}

function residentById(id) {
  return store.town?.residents.find((resident) => resident.id === id);
}

function locationById(id) {
  return store.town?.locations.find((location) => location.id === id);
}

function obligationById(id) {
  return store.town?.obligations?.find((obligation) => obligation.id === id);
}

function relationshipsFor(id) {
  return (store.town?.relationships ?? [])
    .filter((relationship) => relationship.fromId === id || relationship.toId === id)
    .map((relationship) => {
      const otherId = relationship.fromId === id ? relationship.toId : relationship.fromId;
      const other = residentById(otherId);
      return other ? { relationship, other } : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.relationship.strength - left.relationship.strength);
}

function residentsAt(locationId) {
  return (store.town?.residents ?? []).filter((resident) => resident.locationId === locationId);
}

function residentTime(value) {
  if (!value) return "—";
  return `${value.slice(11, 16)} UTC`;
}

function hourLabel(hour) {
  if (!Number.isFinite(hour)) return "—";
  return `${String(hour).padStart(2, "0")}:00`;
}

function actionLabel(action) {
  return {
    work: "Work",
    eat: "Eat",
    rest: "Rest",
    deliver: "Make deliveries",
    observe: "Keep watch",
  }[action] ?? action ?? "No action yet";
}

function townHasModelActivity() {
  return Boolean(store.town?.stats?.modelAttempts || store.town?.stats?.modelCalls);
}

function initials(name) {
  return String(name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function eventActor(event) {
  if (event.actorId) return residentById(event.actorId)?.name ?? event.actor;
  return event.actor;
}

function eventText(event) {
  return event.text;
}

function isConsequentialEvent(event) {
  return CONSEQUENTIAL_EVENT_TYPES.has(event?.type);
}

function eventStamp(event) {
  if (!event?.at || !store.town?.startedAt) return event?.time ?? "—";
  const elapsed = new Date(event.at).getTime() - new Date(store.town.startedAt).getTime();
  const day = Math.max(1, Math.floor(elapsed / (24 * 60 * 60 * 1000)) + 1);
  return `D${day} · ${event.time ?? event.at.slice(11, 16)}`;
}

function eventKind(event) {
  return {
    "obligation-created": "new commitment",
    obligation: "commitment",
    encounter: "encounter",
    "action-interrupted": "interruption",
    "model-fallback": "fallback",
  }[event?.type] ?? "ordinary record";
}

function eventContext(event) {
  const details = [];
  const obligation = event?.obligationId ? obligationById(event.obligationId) : null;
  const parent = obligation?.parentObligationId ? obligationById(obligation.parentObligationId) : null;
  if (parent) details.push(`Follows ${parent.title}`);
  if (event?.type === "obligation" && event.reason) details.push(event.reason);
  return details.join(" · ");
}

function eventRow(event, { paper = false } = {}) {
  const actorName = eventActor(event);
  const actor = event.actorId
    ? routeLink(`/residents/${event.actorId}`, escapeHtml(actorName))
    : escapeHtml(actorName);
  const paperClass = paper ? " journal-event-paper" : "";
  const consequentialClass = isConsequentialEvent(event) ? " consequential-event" : "";
  const context = eventContext(event);
  return `
    <li class="event-row${paperClass}${consequentialClass}">
      <span class="event-time">${escapeHtml(eventStamp(event))}</span>
      <span class="event-marker event-marker-${escapeHtml(event.type ?? "system")}"></span>
      <p><small class="event-kind">${escapeHtml(eventKind(event))}</small><strong>${actor}</strong> ${escapeHtml(eventText(event))}${context ? `<span class="event-context">${escapeHtml(context)}</span>` : ""}</p>
    </li>
  `;
}

function openObligationsFor(residentId) {
  return (store.town?.obligations ?? [])
    .filter((obligation) => obligation.status === "open" && obligation.ownerId === residentId)
    .sort((left, right) => String(left.dueAt).localeCompare(String(right.dueAt)));
}

function obligationDueLabel(obligation) {
  const due = new Date(obligation.dueAt);
  const now = new Date(store.town?.now);
  if (Number.isNaN(due.getTime()) || Number.isNaN(now.getTime())) return "due time unrecorded";
  const hours = Math.ceil((due.getTime() - now.getTime()) / (60 * 60 * 1000));
  if (hours <= 0) return "due now";
  if (hours < 24) return `due in ${hours}h`;
  return `due in ${Math.ceil(hours / 24)}d`;
}

function obligationRow(obligation) {
  const owner = residentById(obligation.ownerId);
  const counterparty = residentById(obligation.counterpartyId);
  const place = locationById(obligation.destinationId);
  const parent = obligation.parentObligationId ? obligationById(obligation.parentObligationId) : null;
  return `
    <article class="commitment-row">
      <p>${owner ? routeLink(`/residents/${owner.id}`, escapeHtml(owner.name)) : escapeHtml(obligation.ownerId)} <span>owes</span> ${counterparty ? routeLink(`/residents/${counterparty.id}`, escapeHtml(counterparty.name)) : escapeHtml(obligation.counterpartyId)}</p>
      <strong>${escapeHtml(obligation.title)}</strong>
      <small>${escapeHtml(actionLabel(obligation.requiredAction))} · ${escapeHtml(place?.name ?? obligation.destinationId)} · ${escapeHtml(obligationDueLabel(obligation))}</small>
      ${parent ? `<em>Follows ${escapeHtml(parent.title)}</em>` : obligation.parentObligationId ? "<em>Continues an earlier promise</em>" : ""}
    </article>
  `;
}

function pageHeader(eyebrow, title, description = "", index = "") {
  return `
    <header class="folio-page-header">
      <div>
        <p class="eyebrow">${escapeHtml(eyebrow)}</p>
        <h1>${escapeHtml(title)}</h1>
        ${description ? `<p class="page-description">${escapeHtml(description)}</p>` : ""}
      </div>
      ${index ? `<div class="folio-index"><strong>${escapeHtml(index)}</strong><span>Calder Station register</span></div>` : ""}
    </header>
  `;
}

function residentMark(resident, className = "") {
  const portrait = resident.portraitKey
    ? `/resident-icons/${encodeURIComponent(resident.portraitKey)}.png`
    : null;
  return `<span class="resident-mark ${className}" aria-hidden="true">${portrait
    ? `<img class="resident-portrait" src="${portrait}" alt="" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="resident-initials">${escapeHtml(initials(resident.name))}</span>`
    : escapeHtml(initials(resident.name))}</span>`;
}

function residentWatchRow(resident) {
  return `
    <article class="person-slip">
      ${residentMark(resident)}
      <div class="person-slip-copy">
        <h3>${routeLink(`/residents/${resident.id}`, escapeHtml(resident.name))}</h3>
        <p class="resident-role-label">${escapeHtml(resident.role)}</p>
        <small>${escapeHtml(resident.status)}</small>
      </div>
    </article>
  `;
}

function renderOverview() {
  const { town, events } = store;
  const active = town.residents.filter((resident) => resident.lastAction !== "rest");
  const openObligations = (town.obligations ?? []).filter(({ status }) => status === "open");
  const nextResidents = [...town.residents]
    .sort((left, right) => String(left.nextPlanAt ?? left.nextDecisionAt).localeCompare(String(right.nextPlanAt ?? right.nextDecisionAt)))
    .slice(0, 3);
  const occupied = town.locations
    .map((location) => ({ location, residents: residentsAt(location.id) }))
    .filter(({ residents }) => residents.length)
    .sort((left, right) => right.residents.length - left.residents.length);
  const consequentialEvents = events.filter(isConsequentialEvent);
  const ordinaryEvents = events.filter((event) => event.type !== "system" && !isConsequentialEvent(event));
  const latest = consequentialEvents[0] ?? events.find((event) => event.type !== "system") ?? events[0];
  const latestSentence = latest
    ? `${eventActor(latest)} ${eventText(latest)}.`
    : "The town is quiet enough to hear itself continuing.";

  app.innerHTML = `
    <section class="town-folio-hero">
      <div class="town-folio-hero-main">
        <div class="folio-rule" aria-hidden="true"></div>
        <div class="hero-copy-block">
          <p class="eyebrow">Day ${escapeHtml(town.day)} · ${escapeHtml(town.clock)}</p>
          <h1>${escapeHtml(town.name)}</h1>
          <p class="hero-description">${escapeHtml(town.summary)}</p>
          <div class="hero-links">
            <a href="#journal" class="coral-link">Read today's journal ↘</a>
            ${routeLink("/map", "See where everyone is ↗", "blue-link")}
          </div>
        </div>
      </div>
      <aside class="now-folio" aria-label="Calder Station now">
        <div class="section-cap"><span>Right now</span></div>
        <div class="clock">${escapeHtml(town.clock.replace(" UTC", ""))}</div>
        <p class="now-weather">${escapeHtml(town.weather)}</p>
        <p class="now-sentence">${escapeHtml(latestSentence)}</p>
        <div class="mini-stats">
          <div><small>Out</small><strong>${active.length}</strong></div>
          <div><small>Home</small><strong>${town.residents.length - active.length}</strong></div>
          <div><small>Open</small><strong>${openObligations.length}</strong></div>
        </div>
      </aside>
    </section>

    <section class="town-note-strip">
      <p class="eyebrow">Town note</p>
      <p class="town-note-copy">${latest ? `${escapeHtml(eventActor(latest))} ${escapeHtml(eventText(latest))}.` : "Nothing historic has to happen for the town to acquire a history."}</p>
      <div class="town-note-tags">
        <span>${town.residents.length} people</span>
        <span>${town.locations.length} places</span>
        <span>${town.relationships?.length ?? 0} ties</span>
      </div>
    </section>

    <section class="town-folio-grid" id="journal">
      <article class="journal-sheet">
        <header class="folio-section-heading">
          <span class="section-index">I</span>
          <div><p class="eyebrow">Town journal</p><h2>What may endure</h2></div>
          <span class="section-code">Causal record</span>
        </header>
        <ol class="event-feed paper-feed">${consequentialEvents.slice(0, 5).map((event) => eventRow(event, { paper: true })).join("") || "<li class=\"paper-empty\">No consequential entries yet.</li>"}</ol>
        ${ordinaryEvents.length ? `<div class="ordinary-journal"><p class="paper-label">Latest ordinary entries</p><ol class="event-feed">${ordinaryEvents.slice(0, 3).map((event) => eventRow(event, { paper: true })).join("")}</ol></div>` : ""}
        <p class="journal-motto">Routine keeps the town alive. Consequences give it a history.</p>
      </article>

      <aside class="place-ledger commitment-ledger">
        <header class="folio-section-heading compact-heading">
          <span class="section-index">II</span>
          <div><p class="eyebrow">Commitments</p><h2>What is owed</h2></div>
        </header>
        <div class="commitment-list">${openObligations.slice(0, 5).map(obligationRow).join("") || "<p class=\"paper-empty\">No promises are presently due.</p>"}</div>
        <p class="ledger-foot">${openObligations.length} open · ${occupied.length} places occupied · ${routeLink("/map", "open map ↗")}</p>
      </aside>

      <aside class="people-ledger">
        <header class="folio-section-heading compact-heading">
          <span class="section-index">III</span>
          <div><p class="eyebrow">People to watch</p><h2>Lives in motion</h2></div>
        </header>
        <div class="people-slip-list">${nextResidents.map(residentWatchRow).join("")}</div>
        <div class="people-ledger-link">${routeLink("/residents", `All ${town.residents.length} people ↗`, "text-link")}</div>
      </aside>
    </section>

    <section class="town-ledger" aria-label="Simulation details">
      <span>${town.stats.tickCount} hours advanced</span>
      <span>${town.stats.encounterCount ?? 0} encounters</span>
      <span>${town.stats.modelCalls ?? 0} model choices</span>
      <span>${openObligations.length} open obligations</span>
    </section>
  `;
}

function selectedLocation() {
  return locationById(store.selectedLocationId) ?? store.town?.locations?.[0] ?? null;
}

function locationMarker(location) {
  const residents = residentsAt(location.id);
  const selected = location.id === selectedLocation()?.id;
  return `
    <button
      type="button"
      class="survey-location${residents.length ? " occupied" : ""}${selected ? " selected" : ""}"
      data-location-select="${escapeHtml(location.id)}"
      data-place-type="${escapeHtml(location.type)}"
      style="left:${location.x}%;top:${location.y}%"
      aria-label="${escapeHtml(location.name)}, ${residents.length} ${residents.length === 1 ? "person" : "people"} here"
    >
      <span class="survey-pin">${residents.length || ""}</span>
      <span class="survey-label">${escapeHtml(location.name)}</span>
    </button>
  `;
}

function renderMap() {
  const { town } = store;
  const selected = selectedLocation();
  if (selected) store.selectedLocationId = selected.id;
  const selectedResidents = selected ? residentsAt(selected.id) : [];

  app.innerHTML = `
    ${pageHeader(
      "Calder Station / the ground beneath it",
      "The map",
      "A working survey of the town: stable places in ink, present occupancy laid over them like a clerk's fresh notation.",
      "II",
    )}

    <section class="survey-layout">
      <div class="survey-wrap">
        <div class="survey-plate" aria-label="Survey plate of Calder Station">
          <header class="survey-plate-header">
            <div><p>Survey plate / current register</p><strong>Calder Station & immediate environs</strong></div>
            <span>not to scale<br>current occupancy<br>north is true</span>
          </header>

          <div class="terrain terrain-hills"><span>North ridge</span></div>
          <div class="terrain terrain-fields"><span>West fields</span></div>
          <div class="terrain terrain-center"><span>Town center</span></div>
          <div class="survey-river"></div>
          <span class="river-label">Stonewater</span>
          <div class="survey-road road-a"></div>
          <div class="survey-road road-b"></div>
          <div class="survey-road road-c"></div>
          <div class="survey-road road-d"></div>

          ${town.locations.map(locationMarker).join("")}

          <div class="survey-key">
            <p>Reading the plate</p>
            <span><i class="key-live"></i> occupied now</span>
            <span><i class="key-empty"></i> empty at this hour</span>
            <span><i class="key-road"></i> principal road</span>
          </div>
          <div class="survey-compass"><span>N</span></div>
        </div>
      </div>

      <aside class="map-margin">
        <section class="map-margin-intro">
          <p class="eyebrow">Current notation</p>
          <h2>Read the town by place.</h2>
          <p>The geography changes slowly. The people do not. Select any mark on the plate to pull its current register into the margin.</p>
        </section>

        ${selected ? `
          <section class="place-inspector">
            <p class="eyebrow">Selected place</p>
            <h3>${escapeHtml(selected.name)}</h3>
            <p class="inspector-type">${escapeHtml(selected.type)} · current register</p>
            <div class="inspector-occupancy">
              <strong>${selectedResidents.length}</strong>
              <div>
                <p>${selectedResidents.length === 0 ? "No one is recorded here at the current hour." : `${selectedResidents.length === 1 ? "One person is" : "People are"} here at the current hour.`}</p>
                <div class="inspector-people">
                  ${selectedResidents.length
                    ? selectedResidents.map((resident) => routeLink(`/residents/${resident.id}`, escapeHtml(resident.name), "resident-chip")).join("")
                    : "<span class=\"resident-chip\">Empty at this hour</span>"}
                </div>
              </div>
            </div>
          </section>
        ` : ""}

        <section class="place-index">
          <header><div><p class="eyebrow">Town index</p><h3>${town.locations.length} entries</h3></div><span>Plate II</span></header>
          <div>
            ${town.locations.map((location, index) => `
              <button type="button" class="place-index-row${location.id === selected?.id ? " active" : ""}" data-location-select="${escapeHtml(location.id)}">
                <span>${String(index + 1).padStart(2, "0")}</span>
                <strong>${escapeHtml(location.name)}</strong>
                <small>${escapeHtml(location.type)}</small>
              </button>
            `).join("")}
          </div>
        </section>
      </aside>
    </section>

    <section class="town-ledger" aria-label="Map details">
      <span>${town.locations.length} places</span>
      <span>${town.locations.filter((location) => residentsAt(location.id).length).length} occupied</span>
      <span>${town.residents.length} people</span>
      <span>${escapeHtml(town.clock)} current hour</span>
    </section>
  `;
}

function selectedResident() {
  return residentById(store.selectedResidentId) ?? store.town?.residents?.[0] ?? null;
}

function planSummary(resident) {
  if (!resident.dailyPlan) return "";
  const plannedLocation = resident.dailyPlan.locationId ? locationById(resident.dailyPlan.locationId) : null;
  const action = resident.dailyPlan.action ?? resident.dailyPlan.priorities?.[0];
  const socialTarget = resident.dailyPlan.socialIntentions?.[0]?.targetId
    ? residentById(resident.dailyPlan.socialIntentions[0].targetId)
    : null;
  const obligation = openObligationsFor(resident.id)[0];
  const decision = resident.dailyPlan.obligationDecision;
  const decidedObligation = decision?.obligationId ? obligationById(decision.obligationId) : null;
  const decisionAction = decision?.choice === "report_delay" ? "delay" : "fulfill";
  const modelStatus = resident.dailyPlan?.model?.fallback
    ? `Scripted fallback prioritized ${decisionAction === "fulfill" ? "" : "delaying "}${decidedObligation?.title ?? "the commitment"}`
    : resident.dailyPlan?.model?.attempted && decision
      ? `DeepSeek prioritized ${decisionAction === "fulfill" ? "" : "delaying "}${decidedObligation?.title ?? "the commitment"}`
      : null;
  const itinerary = (resident.actionQueue ?? []).slice(0, 4);

  return `
    <div class="register-plan">
      <p class="paper-label">Latest plan</p>
      <strong>${escapeHtml(actionLabel(action))}${plannedLocation ? ` at ${escapeHtml(plannedLocation.name)}` : ""}</strong>
      ${resident.dailyPlan.reason ? `<small>${escapeHtml(resident.dailyPlan.reason)}</small>` : ""}
      ${resident.actionQueue?.length ? `<small>${resident.actionQueue.length} queued action${resident.actionQueue.length === 1 ? "" : "s"}</small>` : ""}
      ${itinerary.length ? `<ol class="plan-itinerary">${itinerary.map((entry) => {
        const place = locationById(entry.intent?.locationId);
        const walk = entry.travelMinutes > 0 ? ` · ${entry.travelMinutes} min walk` : "";
        return `<li><time>${escapeHtml(residentTime(entry.scheduledAt))}</time><span>${escapeHtml(actionLabel(entry.intent?.action))}${place ? ` at ${escapeHtml(place.name)}` : ""}${escapeHtml(walk)}</span></li>`;
      }).join("")}</ol>` : ""}
      ${socialTarget ? `<small>Wants a word with ${escapeHtml(socialTarget.name)}</small>` : ""}
      ${obligation ? `<small>Next commitment: ${escapeHtml(obligation.title)} · ${escapeHtml(obligationDueLabel(obligation))}</small>` : ""}
      ${modelStatus ? `<small class="plan-source">${escapeHtml(modelStatus)}</small>` : ""}
      ${decision?.note ? `<small class="plan-note">“${escapeHtml(decision.note)}”</small>` : ""}
    </div>
  `;
}

function residentDossier(resident, { compact = false } = {}) {
  const relationships = relationshipsFor(resident.id);
  const home = locationById(resident.homeLocationId);
  const work = locationById(resident.workLocationId);
  const routine = resident.routine ?? {};
  const residentEvents = store.events
    .filter((event) => event.actorId === resident.id || event.relatedActorId === resident.id || event.actor === resident.name);
  const meaningfulEvents = residentEvents.filter(isConsequentialEvent);
  const recentEvents = (meaningfulEvents.length ? meaningfulEvents : residentEvents).slice(0, compact ? 4 : 8);
  const turningPoints = (resident.turningPoints ?? []).slice(0, compact ? 2 : 6);
  const commitments = openObligationsFor(resident.id);
  const lastEncounterWith = resident.lastEncounterWithId ? residentById(resident.lastEncounterWithId) : null;
  const residentIndex = store.town.residents.findIndex(({ id }) => id === resident.id) + 1;

  return `
    <article class="resident-dossier${compact ? " compact-dossier" : ""}">
      <header class="dossier-head">
        ${residentMark(resident, "dossier-mark")}
        <div>
          <p class="eyebrow">Personal register</p>
          <h2>${escapeHtml(resident.name)}</h2>
          <p>${escapeHtml(resident.role)} · currently at ${escapeHtml(resident.location)}</p>
        </div>
        <div class="dossier-number"><span>Register entry</span><strong>${String(residentIndex).padStart(2, "0")}</strong></div>
      </header>

      <div class="dossier-grid">
        <section>
          <p class="paper-label">At this hour</p>
          <h3 class="current-status">${escapeHtml(resident.status)}</h3>
          <dl class="paper-stats">
            <div><dt>Mood</dt><dd>${escapeHtml(resident.mood)}</dd></div>
            <div><dt>Energy</dt><dd>${escapeHtml(resident.energy)}%</dd></div>
            <div><dt>Hunger</dt><dd>${escapeHtml(resident.hunger)}%</dd></div>
            <div><dt>Current place</dt><dd>${escapeHtml(resident.location)}</dd></div>
            <div><dt>Next planning turn</dt><dd>${escapeHtml(residentTime(resident.nextPlanAt ?? resident.nextDecisionAt))}</dd></div>
            <div><dt>Queued actions</dt><dd>${escapeHtml(resident.actionQueue?.length ?? 0)}</dd></div>
            <div><dt>Plans / actions</dt><dd>${escapeHtml(`${resident.planCount ?? resident.decisionCount ?? 0} / ${resident.actionCount ?? resident.decisionCount ?? 0}`)}</dd></div>
            <div><dt>Social moments</dt><dd>${escapeHtml(resident.socialCount ?? 0)}</dd></div>
            <div><dt>Last encounter</dt><dd>${escapeHtml(lastEncounterWith?.name ?? "—")}</dd></div>
          </dl>

          <div class="ordinary-route">
            <p class="paper-label">Ordinary route</p>
            <div class="route-line"><span>${escapeHtml(home?.name ?? resident.homeLocationId)}</span><i></i><span>${escapeHtml(work?.name ?? resident.workLocationId)}</span></div>
            <p>${escapeHtml(resident.name.split(" ")[0])} usually starts work at ${hourLabel(routine.workStart)} and finishes around ${hourLabel(routine.workEnd)}. ${escapeHtml(routine.workReason ?? "The day's work is waiting.")}</p>
          </div>

          ${planSummary(resident)}

          ${commitments.length ? `<div class="resident-commitments"><p class="paper-label">Open commitments</p>${commitments.map(obligationRow).join("")}</div>` : ""}
        </section>

        <section class="dossier-right">
          <p class="paper-label">Known ties</p>
          <div class="paper-relationships">
            ${relationships.length ? relationships.slice(0, compact ? 5 : relationships.length).map(({ relationship, other }) => `
              <div class="paper-relationship">
                <span>${routeLink(`/residents/${other.id}`, escapeHtml(other.name))}<small>${escapeHtml(relationship.kind)}${relationship.tension >= 20 ? " · strained" : relationship.tension >= 8 ? " · unsettled" : " · steady"}</small></span>
                <strong><b>${escapeHtml(relationship.strength)}</b><small>${relationship.strength - (relationship.baselineStrength ?? relationship.strength) > 0 ? "+" : ""}${escapeHtml(relationship.strength - (relationship.baselineStrength ?? relationship.strength))} since start</small></strong>
              </div>
            `).join("") : "<p class=\"paper-empty\">No recorded ties yet.</p>"}
          </div>

          ${turningPoints.length ? `<div class="paper-history turning-point-history">
            <p class="paper-label">Turning points</p>
            ${turningPoints.map((event) => `
              <div class="paper-history-row">
                <span>${escapeHtml(eventStamp(event))}</span>
                <p><strong>${escapeHtml(eventActor(event).split(" ")[0])}</strong> ${escapeHtml(eventText(event))}${event.occurrences > 1 ? `<small>This thread has surfaced ${escapeHtml(event.occurrences)} times since ${escapeHtml(eventStamp({ at: event.firstAt, time: event.firstAt?.slice(11, 16) }))}.</small>` : eventContext(event) ? `<small>${escapeHtml(eventContext(event))}</small>` : ""}</p>
              </div>
            `).join("")}
          </div>` : ""}

          <div class="paper-history">
            <p class="paper-label">Recent record</p>
            ${recentEvents.length ? recentEvents.map((event) => `
              <div class="paper-history-row">
                <span>${escapeHtml(eventStamp(event))}</span>
                <p><strong>${escapeHtml(eventActor(event).split(" ")[0])}</strong> ${escapeHtml(eventText(event))}${eventContext(event) ? `<small>${escapeHtml(eventContext(event))}</small>` : ""}</p>
              </div>
            `).join("") : "<p class=\"paper-empty\">No recorded events yet.</p>"}
          </div>
        </section>
      </div>

      <p class="dossier-margin-note">${escapeHtml(resident.name.split(" ")[0])}'s entry is a record of observable life: routines, ties, places, and recent acts. It is deliberately incomplete.</p>
      <div class="register-stamp" aria-hidden="true">CALDER<br>REGISTER</div>
    </article>
  `;
}

function renderResidents() {
  const { town } = store;
  const selected = selectedResident();
  if (selected) store.selectedResidentId = selected.id;

  app.innerHTML = `
    ${pageHeader(
      "The town register",
      "People of Calder Station",
      `${town.residents.length} lives, recorded lightly: where they sleep, where they work, who they know, and what the town has seen them do.`,
      "III",
    )}

    <section class="register-layout">
      <aside class="resident-index">
        <header><p class="eyebrow">Name index</p><h2>Town register</h2></header>
        <label class="resident-search-label" for="resident-search">Find a resident</label>
        <input id="resident-search" class="resident-search" type="search" placeholder="Name or occupation" autocomplete="off">
        <div class="resident-index-list">
          ${town.residents.map((resident, index) => `
            <button
              type="button"
              class="resident-index-row${resident.id === selected?.id ? " active" : ""}"
              data-resident-select="${escapeHtml(resident.id)}"
              data-resident-filter="${escapeHtml(`${resident.name} ${resident.role}`.toLowerCase())}"
            >
              <span>${String(index + 1).padStart(2, "0")}</span>
              ${residentMark(resident, "index-mark")}
              <span><strong>${escapeHtml(resident.name)}</strong><small>${escapeHtml(resident.role)}</small></span>
              <i class="resident-state state-${resident.lastAction === "rest" ? "rest" : "out"}"></i>
            </button>
          `).join("")}
        </div>
      </aside>
      <div class="dossier-wrap">${selected ? residentDossier(selected, { compact: true }) : ""}</div>
    </section>

    <section class="town-ledger" aria-label="Resident register details">
      <span>${town.residents.length} people</span>
      <span>${town.relationships?.length ?? 0} relationships</span>
      <span>${town.residents.filter((resident) => resident.lastAction !== "rest").length} out now</span>
      <span>${town.stats.encounterCount ?? 0} social encounters</span>
    </section>
  `;
}

function renderResidentDetail(id) {
  const resident = residentById(id);
  if (!resident) return renderNotFound();

  app.innerHTML = `
    ${pageHeader("One life in Calder Station", resident.name, `${resident.role} · ${resident.location}`, "III")}
    <div class="single-dossier-wrap">${residentDossier(resident)}</div>
    <div class="back-link">${routeLink("/residents", "Back to the town register ←", "text-link")}</div>
  `;
}

function renderNotFound() {
  app.innerHTML = `
    <section class="empty-state">
      <p class="eyebrow">404 / beyond the boundary stones</p>
      <h1>That place is not in Calder Station.</h1>
      ${routeLink("/", "Return to town", "button button-primary")}
    </section>
  `;
}

function currentPath() {
  return window.location.pathname.replace(/\/$/, "") || "/";
}

function render() {
  document.querySelectorAll("[data-nav]").forEach((link) => {
    const active = link.dataset.nav === currentPath()
      || (link.dataset.nav === "/residents" && currentPath().startsWith("/residents/"));
    link.classList.toggle("active", active);
  });

  if (store.error) {
    app.innerHTML = `<section class="empty-state"><p class="eyebrow">Connection error</p><h1>The town window is dark.</h1><p>${escapeHtml(store.error)}</p></section>`;
    return;
  }

  if (!store.town) {
    app.innerHTML = `<section class="empty-state"><p class="eyebrow">Opening the register</p><h1>Looking into Calder Station…</h1></section>`;
    return;
  }

  const path = currentPath();
  if (path === "/") return renderOverview();
  if (path === "/map") return renderMap();
  if (path === "/residents") return renderResidents();
  if (path.startsWith("/residents/")) return renderResidentDetail(decodeURIComponent(path.split("/")[2] || ""));
  return renderNotFound();
}

async function loadData({ quiet = false } = {}) {
  try {
    const [townResponse, eventsResponse] = await Promise.all([
      fetch("/api/town", { cache: "no-store" }),
      fetch("/api/events?limit=200", { cache: "no-store" }),
    ]);
    if (!townResponse.ok || !eventsResponse.ok) throw new Error("The town API returned an error.");

    store.town = await townResponse.json();
    store.events = (await eventsResponse.json()).events;
    store.error = null;
    store.refreshedAt = new Date();

    const environmentLabel = store.town.environment === "staging" ? "Staging" : "Live";
    document.body.dataset.environment = store.town.environment ?? "preview";
    connectionLabel.textContent = townHasModelActivity()
      ? `${environmentLabel} · model experiment`
      : `${environmentLabel} · scripted rules`;
  } catch (error) {
    if (!quiet || !store.town) {
      store.error = error instanceof Error ? error.message : "Unable to load the town.";
    }
    connectionLabel.textContent = "Town window offline";
  }

  render();
}

document.addEventListener("click", (event) => {
  const route = event.target.closest("a[data-route]");
  if (route && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    const target = new URL(route.href, window.location.origin);
    if (target.origin === window.location.origin) {
      event.preventDefault();
      window.history.pushState({}, "", `${target.pathname}${target.search}`);
      render();
      window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
  }

  const locationButton = event.target.closest("[data-location-select]");
  if (locationButton) {
    store.selectedLocationId = locationButton.dataset.locationSelect;
    if (currentPath() !== "/map") {
      window.history.pushState({}, "", "/map");
    }
    render();
    return;
  }

  const goMap = event.target.closest("[data-go-map]");
  if (goMap) {
    store.selectedLocationId = goMap.dataset.goMap;
    window.history.pushState({}, "", "/map");
    render();
    window.scrollTo({ top: 0, behavior: "instant" });
    return;
  }

  const residentButton = event.target.closest("[data-resident-select]");
  if (residentButton) {
    store.selectedResidentId = residentButton.dataset.residentSelect;
    render();
  }
});

document.addEventListener("input", (event) => {
  if (event.target.id !== "resident-search") return;
  const query = event.target.value.trim().toLowerCase();
  document.querySelectorAll("[data-resident-filter]").forEach((row) => {
    row.hidden = Boolean(query) && !row.dataset.residentFilter.includes(query);
  });
});

window.addEventListener("popstate", render);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadData({ quiet: true });
});

loadData();
window.setInterval(() => loadData({ quiet: true }), 60_000);
