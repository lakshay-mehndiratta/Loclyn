const indicator = document.getElementById("connection-indicator");
const label = document.getElementById("connection-label");
const servicesBody = document.querySelector("#services-table tbody");
const diagnosticsBody = document.querySelector("#diagnostics-table tbody");
const requestsBody = document.querySelector("#requests-table tbody");

// Keeps one row per service/diagnostic, keyed by name/id, so updates
// replace the existing row instead of appending duplicates.
const serviceRows = new Map();
const diagnosticRows = new Map();

const MAX_REQUEST_ROWS = 20;

function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws`);

  ws.onopen = () => setConnectionStatus(true);
  ws.onclose = () => {
    setConnectionStatus(false);
    // Dashboard server or Loclyn itself may not be up yet, or restarted —
    // keep trying rather than leaving the page permanently disconnected.
    setTimeout(connect, 2000);
  };
  ws.onerror = () => ws.close();

  ws.onmessage = (event) => {
    const loclynEvent = JSON.parse(event.data);
    handleEvent(loclynEvent);
  };
}

function setConnectionStatus(connected) {
  indicator.className = "status-dot " + (connected ? "status-ok" : "status-error");
  label.textContent = connected ? "Connected" : "Disconnected";
}

function handleEvent(event) {
  if (event.type === "service:updated") renderService(event.payload);
  if (event.type === "diagnostic:updated") renderDiagnostic(event.payload);
  if (event.type === "request:logged") renderRequest(event.payload);
}

function renderService(service) {
  let row = serviceRows.get(service.name);
  if (!row) {
    row = document.createElement("tr");
    serviceRows.set(service.name, row);
    servicesBody.appendChild(row);
  }

  const dotClass = service.status === "running" ? "status-ok" : "status-error";
  row.innerHTML = `
    <td><span class="status-dot ${dotClass}"></span></td>
    <td>${service.name}</td>
    <td>:${service.port}</td>
    <td>${service.status}</td>
  `;
}

function renderDiagnostic(diagnostic) {
  let row = diagnosticRows.get(diagnostic.id + diagnostic.detail);
  if (!row) {
    row = document.createElement("tr");
    diagnosticRows.set(diagnostic.id + diagnostic.detail, row);
    diagnosticsBody.appendChild(row);
  }

  const dotClass =
    diagnostic.severity === "ok" ? "status-ok" :
    diagnostic.severity === "warning" ? "status-warning" : "status-error";

  row.innerHTML = `
    <td><span class="status-dot ${dotClass}"></span></td>
    <td>${diagnostic.label}</td>
    <td>${diagnostic.detail}</td>
    <td>${diagnostic.message ?? diagnostic.severity}</td>
  `;
}

function renderRequest(entry) {
  const row = document.createElement("tr");
  const time = new Date(entry.time).toLocaleTimeString();
  const duration = entry.durationMs === null ? "—" : `${entry.durationMs}ms`;

  row.innerHTML = `
    <td>${time}</td>
    <td>${entry.method}</td>
    <td>${entry.path}</td>
    <td>${entry.status}</td>
    <td>${entry.serviceName}</td>
    <td>${duration}</td>
  `;

  requestsBody.prepend(row);

  while (requestsBody.children.length > MAX_REQUEST_ROWS) {
    requestsBody.removeChild(requestsBody.lastChild);
  }
}

connect();