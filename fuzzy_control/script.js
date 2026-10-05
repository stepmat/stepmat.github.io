// ---------- Membership function math ----------
function shoulderLeft(x, plateauEnd, zeroPoint) {
  if (x <= plateauEnd) return 1;
  if (x >= zeroPoint) return 0;
  return (zeroPoint - x) / (zeroPoint - plateauEnd);
}

function shoulderRight(x, zeroPoint, plateauStart) {
  if (x <= zeroPoint) return 0;
  if (x >= plateauStart) return 1;
  return (x - zeroPoint) / (plateauStart - zeroPoint);
}

function triMF(x, a, b, c) {
  if (x <= a || x >= c) return 0;
  if (x === b) return 1;
  if (x < b) return (x - a) / (b - a);
  return (c - x) / (c - b);
}

function membership(set, x) {
  const p = set.p;
  if (set.shape === "shoulder-left") return shoulderLeft(x, p.end1, p.end2);
  if (set.shape === "shoulder-right") return shoulderRight(x, p.end1, p.end2);
  return triMF(x, p.left, p.peak, p.right);
}

// each shape's editable breakpoints, left-to-right, with the membership
// degree (0 or 1) that the point sits at — used both to place the handle
// on the curve and to know which neighbour keys bound it while dragging
const HANDLE_DEFS = {
  "shoulder-left": [
    { key: "end1", mu: 1 },
    { key: "end2", mu: 0 },
  ],
  "shoulder-right": [
    { key: "end1", mu: 0 },
    { key: "end2", mu: 1 },
  ],
  triangle: [
    { key: "left", mu: 0 },
    { key: "peak", mu: 1 },
    { key: "right", mu: 0 },
  ],
};

// ---------- Domain / linguistic term definitions ----------
const TEMP_DOMAIN = { min: 0, max: 40 };
const HUMIDITY_DOMAIN = { min: 0, max: 100 };
const AC_DOMAIN = { min: 15, max: 30 };

function makeInputSets() {
  return [
    { name: "Cold", color: "var(--cold)", shape: "shoulder-left", domain: TEMP_DOMAIN, p: { end1: 5, end2: 20 } },
    { name: "Warm", color: "var(--warm)", shape: "triangle", domain: TEMP_DOMAIN, p: { left: 10, peak: 20, right: 30 } },
    { name: "Hot", color: "var(--hot)", shape: "shoulder-right", domain: TEMP_DOMAIN, p: { end1: 20, end2: 30 } },
  ];
}

function makeHumiditySets() {
  return [
    { name: "Dry", color: "var(--cold)", shape: "shoulder-left", domain: HUMIDITY_DOMAIN, p: { end1: 20, end2: 45 } },
    { name: "Comfortable", color: "var(--warm)", shape: "triangle", domain: HUMIDITY_DOMAIN, p: { left: 30, peak: 50, right: 70 } },
    { name: "Humid", color: "var(--hot)", shape: "shoulder-right", domain: HUMIDITY_DOMAIN, p: { end1: 55, end2: 80 } },
  ];
}

function makeACSets() {
  return [
    { name: "Cooling", color: "var(--cold)", shape: "shoulder-left", domain: AC_DOMAIN, p: { end1: 18, end2: 24 } },
    { name: "Heating", color: "var(--hot)", shape: "shoulder-right", domain: AC_DOMAIN, p: { end1: 21, end2: 27 } },
  ];
}

const inputSets = makeInputSets();
const humiditySets = makeHumiditySets();
const acSets = makeACSets();

// every Temperature term x every Humidity term drives the AC into one of its
// two modes (AND = min); the crisp centroid becomes the AC's target temperature
const RULE_MATRIX = {
  Cold: { Dry: "Heating", Comfortable: "Heating", Humid: "Heating" },
  Warm: { Dry: "Heating", Comfortable: "Heating", Humid: "Cooling" },
  Hot: { Dry: "Cooling", Comfortable: "Cooling", Humid: "Cooling" },
};

const rules = [];
inputSets.forEach((tempSet) => {
  humiditySets.forEach((humiditySet) => {
    const consequentName = RULE_MATRIX[tempSet.name][humiditySet.name];
    rules.push({ tempSet, humiditySet, consequent: acSets.find((s) => s.name === consequentName) });
  });
});

function resetToDefaults(sets, factory) {
  const defaults = factory();
  sets.forEach((set, i) => Object.assign(set.p, defaults[i].p));
}

// clamp a dragged breakpoint so it can't cross its neighbours or the domain edge
function updatePoint(set, key, domainX) {
  const order = HANDLE_DEFS[set.shape].map((h) => h.key);
  const idx = order.indexOf(key);
  const eps = (set.domain.max - set.domain.min) * 0.02;
  let lo = set.domain.min;
  let hi = set.domain.max;
  if (idx > 0) lo = Math.max(lo, set.p[order[idx - 1]] + eps);
  if (idx < order.length - 1) hi = Math.min(hi, set.p[order[idx + 1]] - eps);
  set.p[key] = lo > hi ? (lo + hi) / 2 : Math.min(Math.max(domainX, lo), hi);
}

// ---------- SVG chart rendering ----------
const SVG_NS = "http://www.w3.org/2000/svg";
const CHART_W = 640;
const CHART_H = 234;
const PAD = { top: 28, right: 16, bottom: 26, left: 30 };
const PLOT_W = CHART_W - PAD.left - PAD.right;
const PLOT_H = CHART_H - PAD.top - PAD.bottom;

function el(tag, attrs) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

function xScale(domain, x) {
  return PAD.left + ((x - domain.min) / (domain.max - domain.min)) * PLOT_W;
}

function yScale(mu) {
  return PAD.top + (1 - mu) * PLOT_H;
}

function samplePoints(domain, fn, n = 200) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const x = domain.min + (i / n) * (domain.max - domain.min);
    pts.push([x, Math.max(0, Math.min(1, fn(x)))]);
  }
  return pts;
}

function pointsToPath(domain, pts, close = false) {
  let d = pts
    .map(([x, mu], i) => `${i === 0 ? "M" : "L"}${xScale(domain, x).toFixed(2)},${yScale(mu).toFixed(2)}`)
    .join(" ");
  if (close) {
    d += ` L${xScale(domain, pts[pts.length - 1][0]).toFixed(2)},${yScale(0).toFixed(2)}`;
    d += ` L${xScale(domain, pts[0][0]).toFixed(2)},${yScale(0).toFixed(2)} Z`;
  }
  return d;
}

function baseSvg() {
  const svg = el("svg", { viewBox: `0 0 ${CHART_W} ${CHART_H}` });
  svg.appendChild(
    el("line", { x1: PAD.left, y1: PAD.top + PLOT_H, x2: PAD.left + PLOT_W, y2: PAD.top + PLOT_H, stroke: "var(--color-border)", "stroke-width": 1 })
  );
  svg.appendChild(
    el("line", { x1: PAD.left, y1: PAD.top, x2: PAD.left, y2: PAD.top + PLOT_H, stroke: "var(--color-border)", "stroke-width": 1 })
  );
  return svg;
}

function addAxisLabels(svg, domain, ticks) {
  ticks.forEach((t) => {
    const x = xScale(domain, t);
    const text = el("text", { x, y: PAD.top + PLOT_H + 16, fill: "var(--color-text-muted)", "font-size": "10", "text-anchor": "middle" });
    text.textContent = t;
    svg.appendChild(text);
  });
  [0, 0.5, 1].forEach((mu) => {
    const y = yScale(mu);
    const text = el("text", { x: PAD.left - 6, y: y + 3, fill: "var(--color-text-muted)", "font-size": "9", "text-anchor": "end" });
    text.textContent = mu;
    svg.appendChild(text);
  });
}

// tracks every active drag's stop-function so a pointerup/cancel that lands
// anywhere on the page (not just on the handle, e.g. if capture is lost)
// always clears the dragging state instead of leaving it stuck
const activeDragStops = new Set();
window.addEventListener("pointerup", () => activeDragStops.forEach((stop) => stop()));
window.addEventListener("pointercancel", () => activeDragStops.forEach((stop) => stop()));
window.addEventListener("blur", () => activeDragStops.forEach((stop) => stop()));

// converts pointer events into domain-space x values via the SVG's own CTM,
// so dragging stays correct regardless of how the SVG is scaled by CSS
function attachDrag(svg, node, domain, onMove) {
  let dragging = false;

  function toDomainX(e) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    const clampedX = Math.min(Math.max(loc.x, PAD.left), PAD.left + PLOT_W);
    return domain.min + ((clampedX - PAD.left) / PLOT_W) * (domain.max - domain.min);
  }

  const stop = (e) => {
    if (!dragging) return;
    dragging = false;
    node.setAttribute("r", 6);
    activeDragStops.delete(stop);
    try {
      node.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* already released */
    }
  };

  node.addEventListener("pointerdown", (e) => {
    dragging = true;
    activeDragStops.add(stop);
    node.setPointerCapture(e.pointerId);
    node.setAttribute("r", 8);
    e.preventDefault();
  });
  node.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    onMove(toDomainX(e));
  });
  node.addEventListener("pointerup", stop);
  node.addEventListener("pointercancel", stop);
  node.addEventListener("pointerenter", () => { if (!dragging) node.setAttribute("r", 8); });
  node.addEventListener("pointerleave", () => { if (!dragging) node.setAttribute("r", 6); });
}

function addCurves(svg, domain, sets, style) {
  return sets.map((set) => {
    const path = el("path", { fill: "none", stroke: set.color, "stroke-width": style.width, opacity: style.opacity });
    svg.appendChild(path);
    return { set, path };
  });
}

function updateCurves(domain, curveEls) {
  curveEls.forEach(({ set, path }) => {
    const pts = samplePoints(domain, (x) => membership(set, x));
    path.setAttribute("d", pointsToPath(domain, pts));
  });
}

function addHandles(svg, domain, sets, onChange) {
  const handleEls = [];
  sets.forEach((set) => {
    HANDLE_DEFS[set.shape].forEach((hd) => {
      const circle = el("circle", { r: 6, fill: set.color, stroke: "var(--color-bg-panel)", "stroke-width": 2, class: "handle" });
      const label = el("text", {
        "font-size": 9,
        "text-anchor": "middle",
        fill: set.color,
        style: "paint-order:stroke;stroke:var(--color-bg-panel);stroke-width:3px;",
      });
      svg.appendChild(circle);
      svg.appendChild(label);
      handleEls.push({ set, key: hd.key, mu: hd.mu, circle, label });
      attachDrag(svg, circle, domain, (domainX) => {
        updatePoint(set, hd.key, domainX);
        onChange();
      });
    });
  });
  return handleEls;
}

function updateHandles(domain, handleEls) {
  handleEls.forEach(({ set, key, mu, circle, label }) => {
    const x = set.p[key];
    const cx = xScale(domain, x);
    const cy = yScale(mu);
    circle.setAttribute("cx", cx);
    circle.setAttribute("cy", cy);
    label.setAttribute("x", cx);
    label.setAttribute("y", cy + (mu === 1 ? -10 : 16));
    label.textContent = x.toFixed(1);
  });
}

function mount(container, svg) {
  container.innerHTML = "";
  container.appendChild(svg);
}

// ---------- build all charts once; only attributes are mutated after this ----------
// shared by every "input" chart (temperature, humidity): bold curves, draggable
// handles, plus a dashed marker line + dots that track the current slider value
function buildInputChart(containerId, domain, sets, ticks) {
  const svg = baseSvg();
  addAxisLabels(svg, domain, ticks);
  const curves = addCurves(svg, domain, sets, { width: 2.5, opacity: 1 });
  const markerLine = el("line", { stroke: "var(--color-text)", "stroke-width": 1.5, "stroke-dasharray": "4,3" });
  svg.appendChild(markerLine);
  const markerDots = sets.map((set) => {
    const c = el("circle", { r: 4, fill: set.color, stroke: "var(--color-bg-panel)", "stroke-width": 1.5 });
    svg.appendChild(c);
    return { set, circle: c };
  });
  const handles = addHandles(svg, domain, sets, () => update());
  mount(document.getElementById(containerId), svg);
  return { domain, curves, markerLine, markerDots, handles };
}

function updateInputChart(chart, value) {
  updateCurves(chart.domain, chart.curves);
  updateHandles(chart.domain, chart.handles);
  const markerX = xScale(chart.domain, value);
  chart.markerLine.setAttribute("x1", markerX);
  chart.markerLine.setAttribute("x2", markerX);
  chart.markerLine.setAttribute("y1", PAD.top);
  chart.markerLine.setAttribute("y2", PAD.top + PLOT_H);
  chart.markerDots.forEach(({ set, circle }) => {
    circle.setAttribute("cx", markerX);
    circle.setAttribute("cy", yScale(membership(set, value)));
  });
}

const tempChart = buildInputChart("fuzzifyChart", TEMP_DOMAIN, inputSets, [0, 10, 20, 30, 40]);
const humidityChart = buildInputChart("humidityChart", HUMIDITY_DOMAIN, humiditySets, [0, 20, 40, 60, 80, 100]);

const outputSvg = baseSvg();
addAxisLabels(outputSvg, AC_DOMAIN, [15, 18, 21, 24, 27, 30]);
const outputCurves = addCurves(outputSvg, AC_DOMAIN, acSets, { width: 1, opacity: 0.35 });
const aggPath = el("path", { fill: "var(--color-accent)", opacity: 0.35, stroke: "var(--color-accent)", "stroke-width": 2 });
outputSvg.appendChild(aggPath);
const centroidLine = el("line", { stroke: "var(--color-text)", "stroke-width": 2 });
outputSvg.appendChild(centroidLine);
const outputHandles = addHandles(outputSvg, AC_DOMAIN, acSets, () => update());
mount(document.getElementById("acChart"), outputSvg);

// ---------- derived UI pieces ----------
function renderDegreeChips(containerId, sets, value) {
  const row = document.getElementById(containerId);
  row.innerHTML = "";
  sets.forEach((set) => {
    const mu = membership(set, value);
    const chip = document.createElement("div");
    chip.className = "degree-chip";
    chip.innerHTML = `<span class="degree-chip__dot" style="background:${set.color}"></span>${set.name}: <b>${mu.toFixed(2)}</b>`;
    row.appendChild(chip);
  });
}

// builds the 9 rules as a Temperature (rows) x Humidity (columns) matrix once;
// updateRuleMatrix then only changes each cell's shading, outline and number, so the
// cells' background-color transition can play instead of the table being replaced
const ruleCells = [];

function buildRuleMatrix() {
  const wrap = document.getElementById("ruleMatrixWrap");
  wrap.innerHTML = "";

  const table = document.createElement("table");
  table.className = "rule-matrix";

  // fixed layout needs explicit column widths, otherwise the narrow axis-label
  // and row-header columns would be stretched as wide as the data columns
  const colgroup = document.createElement("colgroup");
  const axisCol = document.createElement("col");
  axisCol.style.width = "28px";
  const headerCol = document.createElement("col");
  headerCol.style.width = "90px";
  colgroup.appendChild(axisCol);
  colgroup.appendChild(headerCol);
  humiditySets.forEach(() => colgroup.appendChild(document.createElement("col")));
  table.appendChild(colgroup);

  const thead = document.createElement("thead");

  // top row: two blank corners (for the row-axis label + row-header columns)
  // plus a "Humidity" label spanning the three humidity columns
  const axisRow = document.createElement("tr");
  for (let i = 0; i < 2; i++) {
    const c = document.createElement("th");
    c.className = "rule-matrix__corner";
    axisRow.appendChild(c);
  }
  const humidityAxisLabel = document.createElement("th");
  humidityAxisLabel.className = "rule-matrix__axis-label rule-matrix__axis-label--col";
  humidityAxisLabel.colSpan = humiditySets.length;
  humidityAxisLabel.textContent = "Humidity";
  axisRow.appendChild(humidityAxisLabel);
  thead.appendChild(axisRow);

  const headRow = document.createElement("tr");
  for (let i = 0; i < 2; i++) {
    const c = document.createElement("th");
    c.className = "rule-matrix__corner";
    headRow.appendChild(c);
  }
  humiditySets.forEach((hSet) => {
    const th = document.createElement("th");
    th.className = "rule-matrix__col-header";
    th.textContent = hSet.name;
    th.style.color = hSet.color;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);


  const tbody = document.createElement("tbody");
  inputSets.forEach((tSet, rowIdx) => {
    const row = document.createElement("tr");

    if (rowIdx === 0) {
      const tempAxisLabel = document.createElement("th");
      tempAxisLabel.className = "rule-matrix__axis-label rule-matrix__axis-label--row";
      tempAxisLabel.rowSpan = inputSets.length;
      tempAxisLabel.textContent = "Temperature";
      row.appendChild(tempAxisLabel);
    }

    const rowHeader = document.createElement("th");
    rowHeader.className = "rule-matrix__row-header";
    rowHeader.textContent = tSet.name;
    rowHeader.style.color = tSet.color;
    row.appendChild(rowHeader);

    humiditySets.forEach((hSet) => {
      const rule = rules.find((r) => r.tempSet === tSet && r.humiditySet === hSet);
      const td = document.createElement("td");
      td.className = "rule-matrix__cell";
      td.innerHTML = `
        <span class="rule-matrix__dot" style="background:${rule.consequent.color}"></span>
        <span class="rule-matrix__mode">${rule.consequent.name}</span>
        <div class="rule-matrix__strength"></div>
      `;
      ruleCells.push({ rule, td, strengthEl: td.querySelector(".rule-matrix__strength") });
      row.appendChild(td);
    });
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
}

// each cell's shading intensity is its firing strength, and the strongest
// cell (the rule actually driving the output) gets an accent outline
function updateRuleMatrix(temp, humidity) {
  const strengths = ruleCells.map(({ rule }) =>
    Math.min(membership(rule.tempSet, temp), membership(rule.humiditySet, humidity)));
  const maxStrength = Math.max(...strengths);
  ruleCells.forEach(({ rule, td, strengthEl }, i) => {
    const strength = strengths[i];
    td.classList.toggle("is-dominant", maxStrength > 0 && strength === maxStrength);
    const alphaPct = 6 + strength * 54;
    td.style.backgroundColor = `color-mix(in srgb, ${rule.consequent.color} ${alphaPct.toFixed(0)}%, transparent)`;
    strengthEl.textContent = strength.toFixed(2);
  });
}

// the max firing strength across all rules feeding each consequent — this is
// exactly the clip level each mode's fuzzy set gets before aggregation/centroid
function computeModeStrengths(strengths) {
  let cooling = 0;
  let heating = 0;
  rules.forEach((rule, idx) => {
    if (rule.consequent.name === "Cooling") cooling = Math.max(cooling, strengths[idx]);
    else heating = Math.max(heating, strengths[idx]);
  });
  return { cooling, heating };
}

function renderRuleTotals(strengths) {
  const { cooling, heating } = computeModeStrengths(strengths);
  const row = document.getElementById("ruleTotals");
  row.innerHTML = `
    <div class="degree-chip"><span class="degree-chip__dot" style="background:var(--cold)"></span>Total Cooling: <b>${cooling.toFixed(2)}</b></div>
    <div class="degree-chip"><span class="degree-chip__dot" style="background:var(--hot)"></span>Total Heating: <b>${heating.toFixed(2)}</b></div>
  `;
}

function updateACDisplay(centroid) {
  document.getElementById("acTempValue").textContent = centroid.toFixed(1);
}

function computeAggregateAndCentroid(strengths) {
  const n = 300;
  const aggPts = [];
  for (let i = 0; i <= n; i++) {
    const x = AC_DOMAIN.min + (i / n) * (AC_DOMAIN.max - AC_DOMAIN.min);
    let mu = 0;
    rules.forEach((rule, idx) => {
      mu = Math.max(mu, Math.min(strengths[idx], membership(rule.consequent, x)));
    });
    aggPts.push([x, mu]);
  }
  let num = 0;
  let den = 0;
  aggPts.forEach(([x, mu]) => {
    num += x * mu;
    den += mu;
  });
  return { aggPts, centroid: den > 0 ? num / den : AC_DOMAIN.min };
}

// ---------- master update: re-run on slider input and on any handle drag ----------
let currentTemp = parseFloat(document.getElementById("tempSlider").value);
let currentHumidity = parseFloat(document.getElementById("humiditySlider").value);

function update() {
  document.getElementById("tempValue").textContent = currentTemp.toFixed(1);
  document.getElementById("humidityValue").textContent = currentHumidity.toFixed(1);

  updateInputChart(tempChart, currentTemp);
  renderDegreeChips("fuzzifyDegrees", inputSets, currentTemp);

  updateInputChart(humidityChart, currentHumidity);
  renderDegreeChips("humidityDegrees", humiditySets, currentHumidity);

  updateRuleMatrix(currentTemp, currentHumidity);

  const strengths = rules.map((r) => Math.min(membership(r.tempSet, currentTemp), membership(r.humiditySet, currentHumidity)));

  renderRuleTotals(strengths);

  updateCurves(AC_DOMAIN, outputCurves);
  updateHandles(AC_DOMAIN, outputHandles);
  const { aggPts, centroid } = computeAggregateAndCentroid(strengths);
  aggPath.setAttribute("d", pointsToPath(AC_DOMAIN, aggPts, true));
  const centroidX = xScale(AC_DOMAIN, centroid);
  centroidLine.setAttribute("x1", centroidX);
  centroidLine.setAttribute("x2", centroidX);
  centroidLine.setAttribute("y1", PAD.top);
  centroidLine.setAttribute("y2", PAD.top + PLOT_H);

  updateACDisplay(centroid);
}

document.getElementById("tempSlider").addEventListener("input", (e) => {
  currentTemp = parseFloat(e.target.value);
  update();
});

document.getElementById("humiditySlider").addEventListener("input", (e) => {
  currentHumidity = parseFloat(e.target.value);
  update();
});

document.getElementById("resetInputShapes").addEventListener("click", () => {
  resetToDefaults(inputSets, makeInputSets);
  update();
});

document.getElementById("resetHumidityShapes").addEventListener("click", () => {
  resetToDefaults(humiditySets, makeHumiditySets);
  update();
});

document.getElementById("resetACShapes").addEventListener("click", () => {
  resetToDefaults(acSets, makeACSets);
  update();
});

buildRuleMatrix();
update();
