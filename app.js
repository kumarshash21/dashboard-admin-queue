/**
 * Salesforce Single-Queue Inflow Dashboard Controller
 */

const state = {
  queueName: "Admin Queue",
  timeRange: "lastMonth", // 'lastMonth' or 'rolling30'
  cases: [],
  filteredCases: [],
  charts: {},
  showMovingAverage: true,
  isLiveApiConnected: false
};

const SF_COLORS = {
  blue: "#0176D3",
  navy: "#032D60",
  orange: "#FE9339",
  green: "#2E844A",
  red: "#EA001E",
  purple: "#7F27CE",
  gridLines: "#EAEAEA"
};

document.addEventListener("DOMContentLoaded", async () => {
  setupEventListeners();
  updateDateRangeLabel();
  await loadDashboardData();
});

// 1. Timeframe Label Calculation
function updateDateRangeLabel() {
  const labelElem = document.getElementById("dateRangeText");
  const now = new Date();

  if (state.timeRange === "rolling30") {
    const past30 = new Date();
    past30.setDate(now.getDate() - 30);
    const fmt = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    labelElem.textContent = `Window: ${fmt(past30)} — ${fmt(now)}`;
  } else {
    const firstDayPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDayPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    const monthName = firstDayPrevMonth.toLocaleDateString("en-US", { month: "short" });
    labelElem.textContent = `Window: ${monthName} 01 — ${monthName} ${lastDayPrevMonth.getDate()}, ${firstDayPrevMonth.getFullYear()}`;
  }
}

// 2. Fetch Data from Server
async function loadDashboardData() {
  updateDateRangeLabel();
  try {
    const url = `/api/queue-inflow?queueName=${encodeURIComponent(state.queueName)}&range=${state.timeRange}`;
    const response = await fetch(url);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    if (data.records && Array.isArray(data.records)) {
      mapIncomingRecords(data.records);
      state.isLiveApiConnected = true;
      renderDashboard();
      return;
    }
    throw new Error("Invalid response format");
  } catch (err) {
    console.warn("Could not retrieve live Salesforce data, generating local simulation:", err.message);
    state.isLiveApiConnected = false;
    loadSimulatedData();
    renderDashboard();
  }
}

// 3. Fallback Dataset Generator
function loadSimulatedData() {
  const generatedCases = [];
  const now = new Date();
  const priorities = ["Low", "Medium", "High", "Critical"];
  const priorityWeights = [0.3, 0.45, 0.2, 0.05];
  let caseSeq = 200400;

  const numDays = 30;
  for (let i = numDays - 1; i >= 0; i--) {
    let d = new Date();
    if (state.timeRange === "rolling30") {
      d.setDate(now.getDate() - i);
    } else {
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      d = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), (numDays - i));
    }

    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const dailyVolume = isWeekend ? Math.floor(Math.random() * 8 + 3) : Math.floor(Math.random() * 25 + 20);

    for (let c = 0; c < dailyVolume; c++) {
      caseSeq++;
      const hour = getRandomWeightedHour();
      const ticketDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, Math.floor(Math.random() * 60));

      generatedCases.push({
        id: `rec-${caseSeq}`,
        caseNumber: `00${caseSeq}`,
        subject: getRandomSubject(),
        priority: getWeightedChoice(priorities, priorityWeights),
        origin: "Portal",
        routedDate: ticketDate,
        dateKey: ticketDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        hourOfDay: hour,
        status: "New"
      });
    }
  }

  state.cases = generatedCases;
  state.filteredCases = [...generatedCases];
}

// 4. Inflow Normalization
function mapIncomingRecords(raw) {
  state.cases = raw.map((r, i) => {
    const rawDate = r.CreatedDate || new Date().toISOString();
    const dateObj = new Date(rawDate);

    return {
      id: r.Id || `rec-${i}`,
      caseNumber: r.CaseNumber || `00${100000 + i}`,
      subject: r.Subject || "Support Case",
      priority: r.Automation_Priority__c || "Medium",
      origin: r.Origin || "Portal",
      routedDate: dateObj,
      dateKey: dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      hourOfDay: dateObj.getHours(),
      status: r.Status || "New"
    };
  });

  state.filteredCases = [...state.cases];
}

// 5. Render Core View
function renderDashboard() {
  updateKPICards();
  renderDailyInflowChart();
  renderOriginChart();
  renderHourlyCurveChart();
  renderPriorityChart();
  renderTable();
}

// 6. KPIs
function updateKPICards() {
  const total = state.filteredCases.length;
  document.getElementById("kpiTotalInflow").textContent = total.toLocaleString();

  const dayMap = {};
  state.filteredCases.forEach(c => {
    dayMap[c.dateKey] = (dayMap[c.dateKey] || 0) + 1;
  });

  const uniqueDays = Object.keys(dayMap).length || 1;
  document.getElementById("kpiDailyAvg").textContent = (total / uniqueDays).toFixed(1);

  let peakDay = "--";
  let peakCount = 0;
  for (const [day, count] of Object.entries(dayMap)) {
    if (count > peakCount) {
      peakCount = count;
      peakDay = day;
    }
  }
  document.getElementById("kpiPeakDay").textContent = peakDay;
  document.getElementById("kpiPeakCount").textContent = `${peakCount} tickets peak velocity`;
}

// 7. Daily Chart with Continuous Date Axis
function renderDailyInflowChart() {
  const canvas = document.getElementById("dailyInflowChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (state.charts.daily) state.charts.daily.destroy();

  // Generate complete sequence of chronological date keys
  const dateKeys = [];
  const now = new Date();

  if (state.timeRange === "rolling30") {
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      dateKeys.push(d.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
    }
  } else {
    const totalDays = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    for (let day = 1; day <= totalDays; day++) {
      const d = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), day);
      dateKeys.push(d.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
    }
  }

  const countsMap = {};
  dateKeys.forEach(k => countsMap[k] = 0);
  state.filteredCases.forEach(c => {
    if (countsMap[c.dateKey] !== undefined) countsMap[c.dateKey]++;
  });

  const dataCounts = dateKeys.map(k => countsMap[k]);

  // 7-day Simple Moving Average
  const movingAvg = [];
  for (let i = 0; i < dataCounts.length; i++) {
    const start = Math.max(0, i - 6);
    const windowVals = dataCounts.slice(start, i + 1);
    movingAvg.push(Math.round(windowVals.reduce((a, b) => a + b, 0) / windowVals.length));
  }

  const datasets = [
    {
      type: "bar",
      label: "Inflow Tickets",
      data: dataCounts,
      backgroundColor: SF_COLORS.blue,
      borderRadius: 4
    }
  ];

  if (state.showMovingAverage) {
    datasets.push({
      type: "line",
      label: "7-Day Moving Avg",
      data: movingAvg,
      borderColor: SF_COLORS.orange,
      borderWidth: 2,
      pointRadius: 0,
      fill: false,
      tension: 0.3
    });
  }

  state.charts.daily = new Chart(ctx, {
    data: { labels: dateKeys, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: SF_COLORS.gridLines }, beginAtZero: true }
      }
    }
  });
}

function renderOriginChart() {
  const canvas = document.getElementById("originChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (state.charts.origin) state.charts.origin.destroy();

  const originCounts = {};
  state.filteredCases.forEach(c => {
    originCounts[c.origin] = (originCounts[c.origin] || 0) + 1;
  });

  state.charts.origin = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: Object.keys(originCounts),
      datasets: [{
        data: Object.values(originCounts),
        backgroundColor: [SF_COLORS.blue, SF_COLORS.navy, SF_COLORS.purple, SF_COLORS.orange, SF_COLORS.green]
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } }
    }
  });
}

function renderHourlyCurveChart() {
  const canvas = document.getElementById("hourlyChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (state.charts.hourly) state.charts.hourly.destroy();

  const hourlyCounts = new Array(24).fill(0);
  state.filteredCases.forEach(c => {
    if (c.hourOfDay >= 0 && c.hourOfDay < 24) hourlyCounts[c.hourOfDay]++;
  });

  state.charts.hourly = new Chart(ctx, {
    type: "line",
    data: {
      labels: Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`),
      datasets: [{
        label: "Tickets Routed",
        data: hourlyCounts,
        borderColor: SF_COLORS.green,
        backgroundColor: "rgba(46, 132, 74, 0.1)",
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: SF_COLORS.gridLines }, beginAtZero: true }
      }
    }
  });
}

function renderPriorityChart() {
  const canvas = document.getElementById("priorityChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (state.charts.priority) state.charts.priority.destroy();

  const priorityKeys = ["Low", "Medium", "High", "Critical"];
  const counts = priorityKeys.map(p => state.filteredCases.filter(c => (c.priority || "").toLowerCase() === p.toLowerCase()).length);

  state.charts.priority = new Chart(ctx, {
    type: "bar",
    data: {
      labels: priorityKeys,
      datasets: [{
        label: "Case Volume",
        data: counts,
        backgroundColor: [SF_COLORS.green, SF_COLORS.blue, SF_COLORS.orange, SF_COLORS.red],
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: SF_COLORS.gridLines }, beginAtZero: true }
      }
    }
  });
}

// 8. Table Render
function renderTable() {
  const tbody = document.getElementById("casesTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const displayList = state.filteredCases.slice(0, 50);
  document.getElementById("recordCountText").textContent = `Showing ${displayList.length} of ${state.filteredCases.length} cases`;

  displayList.forEach(c => {
    const tr = document.createElement("tr");
    const pClass = (c.priority || "medium").toLowerCase();
    tr.innerHTML = `
      <td><strong>${c.caseNumber}</strong></td>
      <td>${c.subject}</td>
      <td><span class="pill pill-${pClass}">${c.priority}</span></td>
      <td>${c.origin}</td>
      <td>${c.routedDate.toLocaleString()}</td>
      <td><span class="pill pill-medium">${c.status}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// 9. Event Listeners
function setupEventListeners() {
  // Timeframe selector
  document.getElementById("timeRangeSelect").addEventListener("change", async (e) => {
    state.timeRange = e.target.value;
    await loadDashboardData();
  });

  document.getElementById("toggleMa").addEventListener("change", (e) => {
    state.showMovingAverage = e.target.checked;
    renderDailyInflowChart();
  });

  document.getElementById("searchInput").addEventListener("input", applyFilters);
  document.getElementById("priorityFilter").addEventListener("change", applyFilters);
  document.getElementById("originFilter").addEventListener("change", applyFilters);
  document.getElementById("refreshDataBtn").addEventListener("click", () => loadDashboardData());
  document.getElementById("exportCsvBtn").addEventListener("click", exportToCSV);
}

function applyFilters() {
  const term = document.getElementById("searchInput").value.toLowerCase();
  const selPriority = document.getElementById("priorityFilter").value;
  const selOrigin = document.getElementById("originFilter").value;

  state.filteredCases = state.cases.filter(c => {
    const matchesSearch = c.caseNumber.toLowerCase().includes(term) || c.subject.toLowerCase().includes(term);
    const matchesPriority = selPriority === "ALL" || (c.priority || "").toLowerCase() === selPriority.toLowerCase();
    const matchesOrigin = selOrigin === "ALL" || (c.origin || "").toLowerCase() === selOrigin.toLowerCase();
    return matchesSearch && matchesPriority && matchesOrigin;
  });

  renderDashboard();
}

function exportToCSV() {
  const headers = ["CaseNumber", "Subject", "Priority", "Origin", "RoutedDate", "Status"];
  const rows = state.filteredCases.map(c => [
    c.caseNumber,
    `"${c.subject.replace(/"/g, '""')}"`,
    c.priority,
    c.origin,
    c.routedDate.toISOString(),
    c.status
  ]);

  const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
  const link = document.createElement("a");
  link.setAttribute("href", encodeURI(csvContent));
  link.setAttribute("download", `queue_inflow_${state.timeRange}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function getRandomWeightedHour() {
  const r = Math.random();
  if (r < 0.65) return Math.floor(Math.random() * 7) + 9;
  if (r < 0.90) return Math.floor(Math.random() * 6) + 16;
  return Math.floor(Math.random() * 9);
}

function getWeightedChoice(items, weights) {
  const rand = Math.random();
  let cumulative = 0;
  for (let i = 0; i < items.length; i++) {
    cumulative += weights[i];
    if (rand <= cumulative) return items[i];
  }
  return items[items.length - 1];
}

function getRandomSubject() {
  const subjects = [
    "Unable to authenticate SSO via Okta",
    "Billing discrepancy on invoice #INV-9281",
    "API 500 error on webhook endpoint /v1/events",
    "Password reset request from locked user",
    "Latency spike observed on US-East tenant",
    "Integration failure with external ERP sync",
    "License allocation quota exceeded"
  ];
  return subjects[Math.floor(Math.random() * subjects.length)];
}