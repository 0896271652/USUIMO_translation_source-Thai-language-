const SECTION_STATUSES = { coverage: ["missing", "conflict"], review: ["changed", "deleted"] };
const STATUS_LABELS = {
  changed: "EN CHANGED",
  deleted: "OBSOLETE",
  missing: "MISSING",
  conflict: "CONFLICT",
};
const PAGE_SIZE = 100;

const state = {
  index: null,
  report: null,
  section: "coverage",
  activeStatuses: new Set(SECTION_STATUSES.coverage),
  query: "",
  visible: PAGE_SIZE,
};

const elements = {
  sections: document.querySelector("#sections"),
  sourceLabel: document.querySelector("#source-label"),
  language: document.querySelector("#language"),
  revision: document.querySelector("#revision"),
  summary: document.querySelector("#summary"),
  filters: document.querySelector("#filters"),
  search: document.querySelector("#search"),
  download: document.querySelector("#download"),
  sourceWindow: document.querySelector("#source-window"),
  resultCount: document.querySelector("#result-count"),
  entries: document.querySelector("#entries"),
  loadMore: document.querySelector("#load-more"),
  template: document.querySelector("#entry-template"),
};

start().catch((error) => {
  console.error(error);
  elements.entries.innerHTML = `<div class="empty-state">Could not load report: ${escapeHtml(error.message)}</div>`;
});

async function start() {
  state.index = await fetchJson("reports/index.json");
  for (const language of state.index.languages) {
    const option = document.createElement("option");
    option.value = language.code;
    option.textContent = `${language.code} · ${language.nativeLabel} / ${language.label}`;
    elements.language.append(option);
  }

  const requested = new URLSearchParams(location.search).get("lang")?.toUpperCase();
  const initial = state.index.languages.some((language) => language.code === requested)
    ? requested
    : state.index.languages[0]?.code;
  if (!initial) throw new Error("No languages are configured.");

  elements.language.value = initial;
  elements.language.addEventListener("change", () => loadLanguage(elements.language.value));
  elements.search.addEventListener("input", () => {
    state.query = elements.search.value.trim().toLocaleLowerCase();
    state.visible = PAGE_SIZE;
    renderEntries();
  });
  elements.loadMore.addEventListener("click", () => {
    state.visible += PAGE_SIZE;
    renderEntries();
  });
  elements.sections.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-section]");
    if (!button || !state.report) return;
    state.section = button.dataset.section;
    state.activeStatuses = new Set(SECTION_STATUSES[state.section]);
    state.visible = PAGE_SIZE;
    render();
  });
  elements.download.addEventListener("click", downloadReport);
  await loadLanguage(initial);
}

async function loadLanguage(language) {
  const metadata = state.index.languages.find((item) => item.code === language);
  state.report = await fetchJson(metadata.report);
  state.visible = PAGE_SIZE;
  state.activeStatuses = new Set(SECTION_STATUSES[state.section]);
  history.replaceState(null, "", `${location.pathname}?lang=${language}`);
  render();
}

function render() {
  const { report } = state;
  const baseDate = formatDate(report.baseCommit.committedAt);
  const headDate = formatDate(report.headCommit.committedAt);
  const coverage = state.section === "coverage";
  elements.revision.innerHTML = coverage
    ? `Current <strong>${shortSha(report.headCommit.sha)}</strong> · ${headDate}`
    : `Baseline <strong>${shortSha(report.baseCommit.sha)}</strong> · ${baseDate}<br>Current <strong>${shortSha(report.headCommit.sha)}</strong> · ${headDate}`;
  elements.sourceLabel.textContent = coverage ? "LATEST TRANSLATION COVERAGE" : "SOURCE CHANGES TO REVIEW";
  elements.sourceWindow.textContent = coverage
    ? "Latest English vs. latest translation. Missing items disappear when translations are merged. Conflicts need a structure fix."
    : `${baseDate} → ${headDate} · Review English changes against the current translation. These reminders remain until the language checkpoint advances; they do not necessarily mean the text is untranslated.`;
  for (const button of elements.sections.querySelectorAll("button")) {
    const selected = button.dataset.section === state.section;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
    const label = button.dataset.section === "coverage" ? "Missing translations" : "Source changes to review";
    button.textContent = `${label} (${report.sections[button.dataset.section].total.toLocaleString()})`;
  }
  renderSummary();
  renderFilters();
  renderEntries();
}

function renderSummary() {
  elements.summary.replaceChildren(...SECTION_STATUSES[state.section].map((status) => {
    const card = document.createElement("div");
    card.className = "summary-card";
    card.innerHTML = `<span class="summary-card__number">${state.report.sections[state.section].counts[status]}</span><span class="summary-card__label">${STATUS_LABELS[status]}</span>`;
    return card;
  }));
}

function renderFilters() {
  elements.filters.replaceChildren(...SECTION_STATUSES[state.section].map((status) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter is-active";
    button.dataset.status = status;
    button.textContent = STATUS_LABELS[status];
    button.addEventListener("click", () => {
      if (state.activeStatuses.has(status)) state.activeStatuses.delete(status);
      else state.activeStatuses.add(status);
      button.classList.toggle("is-active", state.activeStatuses.has(status));
      state.visible = PAGE_SIZE;
      renderEntries();
    });
    return button;
  }));
}

function renderEntries() {
  const matches = state.report.sections[state.section].entries.filter((entry) => {
    if (!state.activeStatuses.has(entry.status)) return false;
    if (!state.query) return true;
    return [entry.sourceFile, entry.targetFile, entry.pointer, entry.sourceBefore, entry.sourceAfter, entry.translationCurrent]
      .some((value) => JSON.stringify(value).toLocaleLowerCase().includes(state.query));
  });

  const visible = matches.slice(0, state.visible);
  elements.entries.replaceChildren(...visible.map(renderEntry));
  if (visible.length === 0) {
    elements.entries.innerHTML = '<div class="empty-state">No items match the current filters.</div>';
  }
  elements.resultCount.textContent = `Showing ${visible.length.toLocaleString()} of ${matches.length.toLocaleString()} matching items`;
  elements.loadMore.hidden = visible.length >= matches.length;
}

function renderEntry(entry) {
  const fragment = elements.template.content.cloneNode(true);
  const article = fragment.querySelector(".entry");
  const status = fragment.querySelector(".status");
  status.textContent = STATUS_LABELS[entry.status];
  status.classList.add(`status--${entry.status}`);
  fragment.querySelector(".pointer").textContent = entry.pointer || "/";

  const file = fragment.querySelector(".file");
  file.textContent = entry.targetFile;
  file.href = `https://github.com/${state.report.repository}/blob/${state.report.headCommit.sha}/${entry.targetFile}`;

  const comparison = fragment.querySelector(".comparison");
  const panels = [];
  if (state.section === "review") {
    panels.push(valuePanel("PREVIOUS EN", entry.sourceBefore, "before"));
  }
  if (entry.status !== "deleted") {
    panels.push(valuePanel("CURRENT EN", entry.sourceAfter, "after"));
  }
  panels.push(valuePanel(`CURRENT ${state.report.language}`, entry.translationCurrent, "translation"));
  comparison.replaceChildren(...panels);
  comparison.style.setProperty("--panel-count", panels.length);
  return article;
}

function valuePanel(label, value, kind) {
  const panel = document.createElement("div");
  panel.className = `value-panel value-panel--${kind}`;
  const labelElement = document.createElement("div");
  labelElement.className = "value-panel__label";
  labelElement.textContent = label;
  const pre = document.createElement("pre");
  if (value === null) {
    pre.className = "empty";
    pre.textContent = "Not present";
  } else if (typeof value === "string") {
    pre.textContent = value;
  } else {
    pre.textContent = JSON.stringify(value, null, 2);
  }
  panel.append(labelElement, pre);
  return panel;
}

function downloadReport() {
  const blob = new Blob([`${JSON.stringify(state.report, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `translation-changes-${state.report.language}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
}

function shortSha(sha) { return sha.slice(0, 7); }
function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}
