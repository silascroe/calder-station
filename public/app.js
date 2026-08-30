const app = document.querySelector("#app");
const connectionLabel = document.querySelector("#connection-label");
const store = { town: null, events: [], error: null, refreshedAt: null };

function escapeHtml(value) {
  return String(value)
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
  return store.town.residents.filter((resident) => resident.locationId === locationId);
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

function pageHeader(eyebrow, title, description = "") {
  return `
    <header class="page-header">
      <p class="eyebrow">${escapeHtml(eyebrow)}</p>
      <h1>${escapeHtml(title)}</h1>
      ${description ? `<p class="page-description">${escapeHtml(description)}</p>` : ""}
    </header>
  `;
}

function eventRow(event) {
  const actor = event.actorId
    ? routeLink(`/residents/${event.actorId}`, escapeHtml(event.actor))
    : escapeHtml(event.actor);
  return `
    <li class="event-row">
      <span class="event-time">${escapeHtml(event.time)}</span>
      <span class="event-marker event-marker-${escapeHtml(event.type)}"></span>
      <p><strong>${actor}</strong> ${escapeHtml(event.text)}</p>
    </li>
  `;
}

function residentCard(resident, { compact = false } = {}) {
  const home = locationById(resident.homeLocationId)?.name ?? resident.homeLocationId;
  return `
    <article class="resident-card${compact ? " resident-card-compact" : ""}">
      <div class="resident-card-top">
        <div>
          <p class="eyebrow">${escapeHtml(resident.role)}</p>
          <h3>${routeLink(`/residents/${resident.id}`, escapeHtml(resident.name))}</h3>
        </div>
        <span class="energy">${escapeHtml(resident.energy)}%</span>
      </div>
      <p class="resident-status">${escapeHtml(resident.status)}</p>
      <div class="resident-meta">
        <span>${escapeHtml(resident.location)}</span>
        <span>${escapeHtml(resident.mood)}</span>
      </div>
      ${compact ? "" : `<p class="resident-home">Home: ${escapeHtml(home)} · next decision ${escapeHtml(residentTime(resident.nextDecisionAt))}</p>`}
    </article>
  `;
}

function renderOverview() {
  const { town, events } = store;
  const active = town.residents.filter((resident) => resident.lastAction !== "rest");
  const nextResidents = [...town.residents]
    .sort((left, right) => String(left.nextDecisionAt).localeCompare(String(right.nextDecisionAt)))
    .slice(0, 6);
  const occupied = town.locations
    .map((location) => ({ location, residents: residentsAt(location.id) }))
    .filter(({ residents }) => residents.length)
    .sort((left, right) => right.residents.length - left.residents.length);

  app.innerHTML = `
    <section class="town-hero">
      <div>
        <p class="eyebrow">Day ${escapeHtml(town.day)} · ${escapeHtml(town.clock)}</p>
        <h1>${escapeHtml(town.name)}</h1>
        <p class="hero-description">${escapeHtml(town.summary)}</p>
      </div>
      <aside class="now-card" aria-label="Rookwood now">
        <p class="eyebrow">Right now</p>
        <div class="clock">${escapeHtml(town.clock.replace(" UTC", ""))}</div>
        <p class="now-weather">${escapeHtml(town.weather)}</p>
        <div class="now-sentence">
          <strong>${active.length}</strong> of ${town.residents.length} people are out or working.
          The town has recorded <strong>${town.stats.eventCount}</strong> moments so far.
        </div>
      </aside>
    </section>

    <section class="section-block town-now-grid">
      <article class="story-panel">
        <div class="section-heading"><div><p class="eyebrow">Town journal</p><h2>Latest from Rookwood</h2></div></div>
        <ol class="event-feed">${events.slice(0, 10).map(eventRow).join("")}</ol>
      </article>
      <aside class="where-panel">
        <div class="section-heading">
          <div><p class="eyebrow">Where everyone is</p><h2>Occupied places</h2></div>
          ${routeLink("/map", "Full map", "text-link")}
        </div>
        <ol class="occupancy-list">
          ${occupied.map(({ location, residents }) => `
            <li><span><strong>${escapeHtml(location.name)}</strong><small>${escapeHtml(location.type)}</small></span><span class="occupancy-count">${residents.length}</span></li>
          `).join("")}
        </ol>
      </aside>
    </section>

    <section class="section-block">
      <div class="section-heading">
        <div><p class="eyebrow">Next to stir</p><h2>People to watch</h2></div>
        ${routeLink("/residents", `All ${town.residents.length} people`, "text-link")}
      </div>
      <div class="resident-grid">${nextResidents.map((resident) => residentCard(resident, { compact: true })).join("")}</div>
    </section>

    <section class="town-ledger" aria-label="Simulation details">
      <span>${town.locations.length} places</span><span>${town.relationships?.length ?? 0} relationships</span>
      <span>${town.stats.tickCount} hours advanced</span><span>${town.stats.encounterCount ?? 0} encounters</span>
    </section>
  `;
}

function locationMarker(location) {
  const residents = residentsAt(location.id);
  return `
    <div class="map-place${residents.length ? " map-place-occupied" : ""}" style="left:${location.x}%;top:${location.y}%">
      <span class="map-place-dot">${residents.length || ""}</span>
      <span class="map-place-label">${escapeHtml(location.name)}</span>
    </div>
  `;
}

function renderMap() {
  const { town } = store;
  app.innerHTML = `
    ${pageHeader("Rookwood / the ground beneath it", "The map", "A working map of Rookwood, with the town's current occupancy marked.")}
    <section class="map-layout">
      <div class="map-card" aria-label="Map of Rookwood">
        <div class="map-grid"></div><div class="map-road road-one"></div><div class="map-road road-two"></div><div class="map-road road-three"></div>
        ${town.locations.map(locationMarker).join("")}
        <div class="map-compass">N</div><div class="map-legend"><span class="legend-pin" aria-hidden="true"></span> occupied place</div>
      </div>
      <aside class="map-note"><p class="eyebrow">Reading the map</p><p>Gold circles show occupied places. The number is how many people are there now; empty places stay as small rings.</p></aside>
    </section>
    <section class="section-block compact-section">
      <div class="section-heading"><div><p class="eyebrow">The town by place</p><h2>Doors, fields, and rooms</h2></div></div>
      <div class="location-grid">
        ${town.locations.map((location) => {
          const residents = residentsAt(location.id);
          return `<article class="location-card">
            <div><span class="eyebrow">${escapeHtml(location.type)}</span><h3>${escapeHtml(location.name)}</h3></div>
            <div class="location-people">${residents.length
              ? residents.map((resident) => routeLink(`/residents/${resident.id}`, escapeHtml(resident.name))).join("")
              : "<span>Empty at this hour</span>"}</div>
          </article>`;
        }).join("")}
      </div>
    </section>
  `;
}

function renderResidents() {
  const { town } = store;
  app.innerHTML = `
    ${pageHeader("The town register", "People of Rookwood", `${town.residents.length} residents, each with a home, work, routine, and ties to the others.`)}
    <section class="resident-list">${town.residents.map((resident) => residentCard(resident)).join("")}</section>
  `;
}

function renderResidentDetail(id) {
  const resident = residentById(id);
  if (!resident) return renderNotFound();
  const recentEvents = store.events.filter((event) => event.actorId === resident.id || event.relatedActorId === resident.id || event.actor === resident.name);
  const relationships = relationshipsFor(id);
  const home = locationById(resident.homeLocationId);
  const work = locationById(resident.workLocationId);
  const routine = resident.routine ?? {};
  const lastEncounterWith = resident.lastEncounterWithId ? residentById(resident.lastEncounterWithId) : null;
  const plannedSocialTarget = resident.dailyPlan?.socialIntentions?.[0]?.targetId
    ? residentById(resident.dailyPlan.socialIntentions[0].targetId)
    : null;
  const plannedLocation = resident.dailyPlan?.locationId ? locationById(resident.dailyPlan.locationId) : null;
  const planAction = resident.dailyPlan?.action ?? resident.dailyPlan?.priorities?.[0];

  app.innerHTML = `
    ${pageHeader("One life in Rookwood", resident.name, `${resident.role} · ${resident.location}`)}
    <section class="detail-grid">
      <article class="profile-card">
        <div class="profile-monogram">${escapeHtml(resident.name.split(" ").map((part) => part[0]).join(""))}</div>
        <p class="eyebrow">At this hour</p><h2>${escapeHtml(resident.status)}</h2>
        <dl class="profile-stats">
          <div><dt>Mood</dt><dd>${escapeHtml(resident.mood)}</dd></div><div><dt>Energy</dt><dd>${escapeHtml(resident.energy)}%</dd></div>
          <div><dt>Hunger</dt><dd>${escapeHtml(resident.hunger)}%</dd></div><div><dt>Current place</dt><dd>${escapeHtml(resident.location)}</dd></div>
          <div><dt>Next decision</dt><dd>${escapeHtml(residentTime(resident.nextDecisionAt))}</dd></div>
          <div><dt>Social moments</dt><dd>${escapeHtml(resident.socialCount ?? 0)}</dd></div>
          <div><dt>Last encounter</dt><dd>${escapeHtml(lastEncounterWith?.name ?? "—")}</dd></div>
        </dl>
      </article>
      <div class="resident-story">
        <article class="routine-card">
          <p class="eyebrow">Ordinary day</p><h2>Home and routine</h2>
          <div class="route-line"><span>${escapeHtml(home?.name ?? resident.homeLocationId)}</span><i></i><span>${escapeHtml(work?.name ?? resident.workLocationId)}</span></div>
          <p>${escapeHtml(resident.name.split(" ")[0])} usually starts work at ${hourLabel(routine.workStart)} and finishes around ${hourLabel(routine.workEnd)}. ${escapeHtml(routine.workReason ?? "The day's work is waiting.")}</p>
          ${resident.dailyPlan ? `<div class="plan-note"><span>Latest plan</span><strong>${escapeHtml(actionLabel(planAction))}${plannedLocation ? ` at ${escapeHtml(plannedLocation.name)}` : ""}</strong>${resident.dailyPlan.reason ? `<small>${escapeHtml(resident.dailyPlan.reason)}</small>` : ""}${plannedSocialTarget ? `<small>Wants a word with ${escapeHtml(plannedSocialTarget.name)}</small>` : ""}</div>` : `<div class="plan-note"><span>Latest plan</span><strong>No decision yet</strong></div>`}
        </article>
        <article class="connections-card">
          <p class="eyebrow">Known ties</p><h2>Relationships</h2>
          ${relationships.length ? `<ul class="connection-list">${relationships.map(({ relationship, other }) => `
            <li>${routeLink(`/residents/${other.id}`, escapeHtml(other.name))}<span>${escapeHtml(relationship.kind)} · ${escapeHtml(relationship.strength)}%</span></li>
          `).join("")}</ul>` : `<p class="connection-empty">No recorded ties yet.</p>`}
        </article>
      </div>
    </section>
    <section class="section-block resident-history">
      <div class="section-heading"><div><p class="eyebrow">Personal history</p><h2>What ${escapeHtml(resident.name.split(" ")[0])} has done</h2></div></div>
      <ol class="event-feed">${(recentEvents.length ? recentEvents : [{ time: "—", actor: resident.name, text: "has no recorded events yet", type: "routine" }]).map(eventRow).join("")}</ol>
    </section>
    <div class="back-link">${routeLink("/residents", "Back to everyone", "text-link")}</div>
  `;
}

function renderNotFound() {
  app.innerHTML = `<section class="empty-state"><p class="eyebrow">404 / beyond the boundary stones</p><h1>That place is not in Rookwood.</h1>${routeLink("/", "Return to town", "button button-primary")}</section>`;
}

function currentPath() {
  return window.location.pathname.replace(/\/$/, "") || "/";
}

function render() {
  document.querySelectorAll("[data-nav]").forEach((link) => {
    const active = link.dataset.nav === currentPath() || (link.dataset.nav === "/residents" && currentPath().startsWith("/residents/"));
    link.classList.toggle("active", active);
  });
  if (store.error) {
    app.innerHTML = `<section class="empty-state"><p class="eyebrow">Connection error</p><h1>The town window is dark.</h1><p>${escapeHtml(store.error)}</p></section>`;
    return;
  }
  if (!store.town) {
    app.innerHTML = `<section class="empty-state"><p class="eyebrow">Opening the shutters</p><h1>Looking into Rookwood…</h1></section>`;
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
    connectionLabel.textContent = "Live · scripted rules";
  } catch (error) {
    if (!quiet || !store.town) store.error = error instanceof Error ? error.message : "Unable to load the town.";
    connectionLabel.textContent = "Town window offline";
  }
  render();
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-route]");
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = new URL(link.href, window.location.origin);
  if (target.origin !== window.location.origin) return;
  event.preventDefault();
  window.history.pushState({}, "", `${target.pathname}${target.search}`);
  render();
  window.scrollTo({ top: 0, behavior: "instant" });
});

window.addEventListener("popstate", render);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadData({ quiet: true });
});

loadData();
window.setInterval(() => loadData({ quiet: true }), 60_000);
