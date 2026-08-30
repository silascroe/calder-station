const app = document.querySelector("#app");
const store = { town: null, events: [], error: null };

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

function residentCard(resident) {
  return `
    <article class="resident-card">
      <div class="resident-card-top">
        <div>
          <p class="eyebrow">${escapeHtml(resident.role)}</p>
          <h3>${routeLink(`/residents/${resident.id}`, escapeHtml(resident.name))}</h3>
        </div>
        <span class="energy">${escapeHtml(resident.energy)}% energy</span>
      </div>
      <p class="resident-status">${escapeHtml(resident.status)}</p>
      <div class="resident-meta">
        <span>${escapeHtml(resident.location)}</span>
        <span>${escapeHtml(resident.mood)}</span>
      </div>
    </article>
  `;
}

function eventRow(event) {
  return `
    <li class="event-row">
      <span class="event-time">${escapeHtml(event.time)}</span>
      <span class="event-marker event-marker-${escapeHtml(event.type)}"></span>
      <p><strong>${escapeHtml(event.actor)}</strong> ${escapeHtml(event.text)}</p>
    </li>
  `;
}

function pageHeader(eyebrow, title, description = "") {
  return `
    <div class="page-header">
      <p class="eyebrow">${escapeHtml(eyebrow)}</p>
      <h1>${escapeHtml(title)}</h1>
      ${description ? `<p class="page-description">${escapeHtml(description)}</p>` : ""}
    </div>
  `;
}

function renderOverview() {
  const { town, events } = store;
  app.innerHTML = `
    <section class="hero-grid">
      <div class="hero-copy">
        <p class="eyebrow">Day ${escapeHtml(town.day)} / ${escapeHtml(town.clock)}</p>
        <h1>${escapeHtml(town.name)}</h1>
        <p class="hero-description">${escapeHtml(town.summary)}</p>
        <div class="hero-actions">
          ${routeLink("/map", "Open the map", "button button-primary")}
          ${routeLink("/residents", "Meet the residents", "button button-secondary")}
        </div>
      </div>
      <div class="clock-card">
        <p class="eyebrow">World clock</p>
        <div class="clock">${escapeHtml(town.clock.replace(" UTC", ""))}</div>
        <div class="clock-meta">
          <span>Weather</span>
          <strong>${escapeHtml(town.weather)}</strong>
        </div>
        <div class="clock-meta">
          <span>Residents</span>
          <strong>${escapeHtml(town.residents.length)}</strong>
        </div>
      </div>
    </section>

    <section class="section-block">
      <div class="section-heading">
        <div>
          <p class="eyebrow">People</p>
          <h2>Residents</h2>
        </div>
        ${routeLink("/residents", "View all", "text-link")}
      </div>
      <div class="resident-grid">${town.residents.map(residentCard).join("")}</div>
    </section>

    <section class="section-block">
      <div class="section-heading">
        <div>
          <p class="eyebrow">What just happened</p>
          <h2>Town feed</h2>
        </div>
        ${routeLink("/map", "See locations", "text-link")}
      </div>
      <ol class="event-feed">${events.map(eventRow).join("")}</ol>
    </section>
  `;
}

function renderMap() {
  const { town } = store;
  const locationLabels = town.locations
    .map(
      (location) => `
        <div class="map-location" style="left:${location.x}%;top:${location.y}%">
          <span class="map-location-dot"></span>
          <span>${escapeHtml(location.name)}</span>
        </div>
      `,
    )
    .join("");
  const residentPins = town.residents
    .map(
      (resident) => `
        <a class="resident-pin" href="/residents/${resident.id}" data-route style="left:${resident.x}%;top:${resident.y}%" title="${escapeHtml(resident.name)}">
          <span>${escapeHtml(resident.name.slice(0, 1))}</span>
        </a>
      `,
    )
    .join("");

  app.innerHTML = `
    ${pageHeader("Rookwood / spatial view", "The map", "A simple location view now; a real world map later.")}
    <section class="map-card">
      <div class="map-grid"></div>
      <div class="map-road road-one"></div>
      <div class="map-road road-two"></div>
      ${locationLabels}
      ${residentPins}
      <div class="map-compass">N</div>
      <div class="map-legend"><span class="legend-pin"></span> Resident</div>
    </section>
    <section class="section-block compact-section">
      <div class="section-heading"><div><p class="eyebrow">Locations</p><h2>Places in Rookwood</h2></div></div>
      <div class="location-grid">
        ${town.locations.map((location) => `<div class="location-card"><span class="eyebrow">${escapeHtml(location.type)}</span><strong>${escapeHtml(location.name)}</strong></div>`).join("")}
      </div>
    </section>
  `;
}

function renderResidents() {
  const { town } = store;
  app.innerHTML = `
    ${pageHeader("Rookwood / population", "Residents", "Three people, a great many possible problems.")}
    <section class="resident-list">${town.residents.map(residentCard).join("")}</section>
  `;
}

function renderResidentDetail(id) {
  const resident = residentById(id);
  if (!resident) return renderNotFound();

  const recentEvents = store.events.filter((event) => event.actor === resident.name);
  app.innerHTML = `
    ${pageHeader("Resident file", resident.name, `${resident.role} / ${resident.location}`)}
    <section class="detail-grid">
      <article class="profile-card">
        <div class="profile-initial">${escapeHtml(resident.name.slice(0, 1))}</div>
        <p class="eyebrow">Current status</p>
        <h2>${escapeHtml(resident.status)}</h2>
        <div class="profile-stats">
          <div><span>mood</span><strong>${escapeHtml(resident.mood)}</strong></div>
          <div><span>energy</span><strong>${escapeHtml(resident.energy)}%</strong></div>
          <div><span>location</span><strong>${escapeHtml(resident.location)}</strong></div>
        </div>
      </article>
      <article class="detail-events">
        <p class="eyebrow">Recent activity</p>
        <h2>What ${escapeHtml(resident.name.split(" ")[0])} has done</h2>
        <ol class="event-feed">${(recentEvents.length ? recentEvents : [{ time: "—", actor: resident.name, text: "has no recorded events yet", type: "routine" }]).map(eventRow).join("")}</ol>
      </article>
    </section>
    <div class="back-link">${routeLink("/residents", "← Back to residents", "text-link")}</div>
  `;
}

function renderNotFound() {
  app.innerHTML = `
    <section class="empty-state">
      <p class="eyebrow">404 / fog of war</p>
      <h1>That place is not on the map.</h1>
      ${routeLink("/", "Return to town", "button button-primary")}
    </section>
  `;
}

function currentPath() {
  return window.location.pathname.replace(/\/$/, "") || "/";
}

function render() {
  document.querySelectorAll("[data-nav]").forEach((link) => {
    link.classList.toggle("active", link.dataset.nav === currentPath() || (link.dataset.nav === "/residents" && currentPath().startsWith("/residents/")));
  });

  if (store.error) {
    app.innerHTML = `<section class="empty-state"><p class="eyebrow">Connection error</p><h1>The town window is offline.</h1><p>${escapeHtml(store.error)}</p></section>`;
    return;
  }
  if (!store.town) {
    app.innerHTML = `<section class="empty-state"><p class="eyebrow">Starting the window</p><h1>Loading Rookwood…</h1></section>`;
    return;
  }

  const path = currentPath();
  if (path === "/") return renderOverview();
  if (path === "/map") return renderMap();
  if (path === "/residents") return renderResidents();
  if (path.startsWith("/residents/")) return renderResidentDetail(decodeURIComponent(path.split("/")[2] || ""));
  return renderNotFound();
}

async function loadData() {
  try {
    const [townResponse, eventsResponse] = await Promise.all([fetch("/api/town"), fetch("/api/events")]);
    if (!townResponse.ok || !eventsResponse.ok) throw new Error("The demo API returned an error.");
    store.town = await townResponse.json();
    store.events = (await eventsResponse.json()).events;
  } catch (error) {
    store.error = error instanceof Error ? error.message : "Unable to load the town.";
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
});

window.addEventListener("popstate", render);
loadData();
