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

function eventRow(event, { paper = false } = {}) {
  const actorName = eventActor(event);
  const actor = event.actorId
    ? routeLink(`/residents/${event.actorId}`, escapeHtml(actorName))
    : escapeHtml(actorName);
  const paperClass = paper ? " journal-event-paper" : "";
  return `
    <li class="event-row${paperClass}">
      <span class="event-time">${escapeHtml(event.time ?? "—")}</span>
      <span class="event-marker event-marker-${escapeHtml(event.type ?? "system")}"></span>
      <p><strong>${actor}</strong> ${escapeHtml(eventText(event))}</p>
    </li>
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
  const latest = events.find((event) => event.type !== "system") ?? events[0];
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
      <p class="town-note-copy">Nothing historic has to happen for the town to acquire a history.</p>
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
          <div><p class="eyebrow">Town journal</p><h2>The day, as it happened</h2></div>
          <span class="section-code">Newest first</span>
        </header>
        <ol class="event-feed paper-feed">${events.slice(0, 7).map((event) => eventRow(event, { paper: true })).join("")}</ol>
        <p class="journal-motto">Small moments first. Systems second.</p>
      </article>

      <aside class="place-ledger">
        <header class="folio-section-heading compact-heading">
          <span class="section-index">II</span>
          <div><p class="eyebrow">Places</p><h2>Where they are</h2></div>
        </header>
        <div class="place-ledger-list">
          ${occupied.slice(0, 6).map(({ location, residents }) => `
            <button type="button" class="place-ledger-row" data-go-map="${escapeHtml(location.id)}">
              <span><strong>${escapeHtml(location.name)}</strong><small>${escapeHtml(location.type)}</small></span>
              <b>${residents.length}</b>
            </button>
          `).join("")}
        </div>
        <p class="ledger-foot">${occupied.length} of ${town.locations.length} places occupied</p>
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
  const obligation = (store.town?.obligations ?? []).find(({ ownerId }) => ownerId === resident.id);
  const modelStatus = resident.dailyPlan?.model?.fallback
    ? "Scripted fallback used"
    : resident.dailyPlan?.model?.attempted
      ? "DeepSeek shaped this decision"
      : null;

  return `
    <div class="register-plan">
      <p class="paper-label">Latest plan</p>
      <strong>${escapeHtml(actionLabel(action))}${plannedLocation ? ` at ${escapeHtml(plannedLocation.name)}` : ""}</strong>
      ${resident.dailyPlan.reason ? `<small>${escapeHtml(resident.dailyPlan.reason)}</small>` : ""}
      ${resident.actionQueue?.length ? `<small>${resident.actionQueue.length} queued action${resident.actionQueue.length === 1 ? "" : "s"}</small>` : ""}
      ${socialTarget ? `<small>Wants a word with ${escapeHtml(socialTarget.name)}</small>` : ""}
      ${obligation ? `<small>Obligation: ${escapeHtml(obligation.status)}</small>` : ""}
      ${modelStatus ? `<small class="plan-source">${escapeHtml(modelStatus)}</small>` : ""}
    </div>
  `;
}

function residentDossier(resident, { compact = false } = {}) {
  const relationships = relationshipsFor(resident.id);
  const home = locationById(resident.homeLocationId);
  const work = locationById(resident.workLocationId);
  const routine = resident.routine ?? {};
  const recentEvents = store.events
    .filter((event) => event.actorId === resident.id || event.relatedActorId === resident.id || event.actor === resident.name)
    .slice(0, compact ? 4 : 8);
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
        </section>

        <section class="dossier-right">
          <p class="paper-label">Known ties</p>
          <div class="paper-relationships">
            ${relationships.length ? relationships.slice(0, compact ? 5 : relationships.length).map(({ relationship, other }) => `
              <div class="paper-relationship">
                <span>${routeLink(`/residents/${other.id}`, escapeHtml(other.name))}<small>${escapeHtml(relationship.kind)}</small></span>
                <strong>${escapeHtml(relationship.strength)}</strong>
              </div>
            `).join("") : "<p class=\"paper-empty\">No recorded ties yet.</p>"}
          </div>

          <div class="paper-history">
            <p class="paper-label">Recent record</p>
            ${recentEvents.length ? recentEvents.map((event) => `
              <div class="paper-history-row">
                <span>${escapeHtml(event.time ?? "—")}</span>
                <p><strong>${escapeHtml(eventActor(event).split(" ")[0])}</strong> ${escapeHtml(eventText(event))}</p>
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
      fetch("/api/events?limit=80", { cache: "no-store" }),
    ]);
    if (!townResponse.ok || !eventsResponse.ok) throw new Error("The town API returned an error.");

    store.town = await townResponse.json();
    store.events = (await eventsResponse.json()).events;
    store.error = null;
    store.refreshedAt = new Date();

    const environmentLabel = store.town.environment === "staging" ? "Staging" : "Live";
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
