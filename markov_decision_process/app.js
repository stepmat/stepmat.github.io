(() => {
  "use strict";

  const NODE_RADIUS = 28;
  const DRAG_THRESHOLD = 6;

  const GAMMA = 1;
  const THETA = 0.0001;
  const MAX_ITERATIONS = 100;

  let nodes = []; // {id, name, x, y}
  let edges = []; // {id, from, to, action, prob, cost} — cost: positive = worse (subtracted from value)
  let nextNodeId = 1;
  let nextEdgeId = 1;

  let dragState = null; // {type: 'connect'|'move', ...}
  let pendingEdge = null; // {from, to} when editor is open for a brand-new edge
  let editingEdgeId = null; // id when editor is open for an existing edge
  let editingNodeId = null; // id when the node editor is open

  const svg = document.getElementById("graphSvg");
  const edgesLayer = document.getElementById("edgesLayer");
  const nodesLayer = document.getElementById("nodesLayer");
  const edgeEditor = document.getElementById("edgeEditor");
  const edgeAction = document.getElementById("edgeAction");
  const edgeProb = document.getElementById("edgeProb");
  const edgeCost = document.getElementById("edgeCost");
  const actionSuggestList = document.getElementById("actionSuggestList");
  const nodeEditor = document.getElementById("nodeEditor");
  const nodeNameInput = document.getElementById("nodeName");
  const validationMsg = document.getElementById("validationMsg");
  const resultsPanel = document.getElementById("results-panel");

  const SVG_NS = "http://www.w3.org/2000/svg";

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (const k in attrs) el.setAttribute(k, attrs[k]);
    }
    return el;
  }

  function getCoords(evt) {
    const rect = svg.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  function findNode(id) {
    return nodes.find((n) => n.id === id);
  }

  function nextNodeName() {
    let i = 0;
    const existing = new Set(nodes.map((n) => n.name));
    while (existing.has(`S${i}`)) i++;
    return `S${i}`;
  }

  function addNode(x, y) {
    const node = { id: nextNodeId++, name: nextNodeName(), x, y };
    nodes.push(node);
    render();
    return node;
  }

  function deleteNode(id) {
    nodes = nodes.filter((n) => n.id !== id);
    edges = edges.filter((e) => e.from !== id && e.to !== id);
    render();
  }

  function deleteEdge(id) {
    edges = edges.filter((e) => e.id !== id);
    render();
  }

  // ---------- Interaction ----------

  svg.addEventListener("mousedown", (e) => {
    const nodeTarget = e.target.closest("[data-node-id]");
    const coords = getCoords(e);

    closeEdgeEditor();
    closeNodeEditor();

    if (nodeTarget) {
      const nodeId = parseInt(nodeTarget.getAttribute("data-node-id"), 10);
      if (e.shiftKey) {
        const node = findNode(nodeId);
        dragState = { type: "move", nodeId, offsetX: coords.x - node.x, offsetY: coords.y - node.y };
      } else {
        dragState = { type: "connect", fromId: nodeId, moved: false, startX: coords.x, startY: coords.y };
      }
      e.preventDefault();
    } else if (e.target === svg) {
      dragState = { type: "background", startX: coords.x, startY: coords.y };
    }
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragState) return;
    const coords = getCoords(e);

    if (dragState.type === "move") {
      const node = findNode(dragState.nodeId);
      if (node) {
        node.x = coords.x - dragState.offsetX;
        node.y = coords.y - dragState.offsetY;
        render();
      }
    } else if (dragState.type === "connect") {
      const dist = Math.hypot(coords.x - dragState.startX, coords.y - dragState.startY);
      if (dist > DRAG_THRESHOLD) dragState.moved = true;
      drawTempLine(dragState.fromId, coords);
    }
  });

  window.addEventListener("mouseup", (e) => {
    if (!dragState) return;
    const coords = getCoords(e);

    if (dragState.type === "connect") {
      removeTempLine();
      if (dragState.moved) {
        const elAtPoint = document.elementFromPoint(e.clientX, e.clientY);
        const nodeTarget = elAtPoint && elAtPoint.closest && elAtPoint.closest("[data-node-id]");
        if (nodeTarget) {
          const toId = parseInt(nodeTarget.getAttribute("data-node-id"), 10);
          openEdgeEditorForNew(dragState.fromId, toId, coords);
        }
      } else {
        openNodeEditor(dragState.fromId, coords);
      }
    } else if (dragState.type === "background") {
      const dist = Math.hypot(coords.x - dragState.startX, coords.y - dragState.startY);
      if (dist < DRAG_THRESHOLD) {
        addNode(coords.x, coords.y);
      }
    }
    dragState = null;
  });

  svg.addEventListener("click", (e) => {
    const edgeTarget = e.target.closest("[data-edge-id]");
    if (!edgeTarget) return;
    const edgeId = parseInt(edgeTarget.getAttribute("data-edge-id"), 10);
    const edge = edges.find((ed) => ed.id === edgeId);
    if (edge) openEdgeEditorForExisting(edge, getCoords(e));
  });

  document.getElementById("edgeSaveBtn").addEventListener("click", saveEdgeEditor);
  document.getElementById("edgeDeleteBtn").addEventListener("click", () => {
    if (editingEdgeId != null) deleteEdge(editingEdgeId);
    closeEdgeEditor();
  });
  document.getElementById("edgeCancelBtn").addEventListener("click", closeEdgeEditor);

  document.getElementById("nodeSaveBtn").addEventListener("click", saveNodeEditor);
  document.getElementById("nodeDeleteBtn").addEventListener("click", () => {
    if (editingNodeId != null) deleteNode(editingNodeId);
    closeNodeEditor();
  });
  document.getElementById("nodeCancelBtn").addEventListener("click", closeNodeEditor);

  document.getElementById("loadExampleBtn").addEventListener("click", loadExample);
  document.getElementById("clearBtn").addEventListener("click", () => {
    nodes = [];
    edges = [];
    resultsPanel.hidden = true;
    render();
  });
  document.getElementById("solveBtn").addEventListener("click", solve);

  // ---------- Temp connection line while dragging ----------

  let tempLine = null;

  function drawTempLine(fromId, toCoords) {
    const from = findNode(fromId);
    if (!from) return;
    if (!tempLine) {
      tempLine = svgEl("line", { class: "temp-line" });
      edgesLayer.appendChild(tempLine);
    }
    tempLine.setAttribute("x1", from.x);
    tempLine.setAttribute("y1", from.y);
    tempLine.setAttribute("x2", toCoords.x);
    tempLine.setAttribute("y2", toCoords.y);
  }

  function removeTempLine() {
    if (tempLine) {
      tempLine.remove();
      tempLine = null;
    }
  }

  // ---------- Edge editor popup ----------

  // Native <datalist> suggestion popups are unreliable across browsers (poor/no
  // support in Safari, doesn't render in some sandboxes) — this is a small
  // custom-rendered dropdown instead, filtered as the user types.
  let allActionNames = [];

  function refreshActionNames() {
    allActionNames = [...new Set(edges.map((e) => e.action))];
  }

  function renderActionSuggestions() {
    const filter = edgeAction.value.trim().toLowerCase();
    const matches = allActionNames.filter((name) => name.toLowerCase().includes(filter));

    if (matches.length === 0) {
      actionSuggestList.hidden = true;
      return;
    }

    actionSuggestList.innerHTML = "";
    matches.forEach((name) => {
      const item = document.createElement("div");
      item.className = "suggest-item";
      item.textContent = name;
      // mousedown (not click) fires before the input's blur handler hides the list
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        edgeAction.value = name;
        actionSuggestList.hidden = true;
        edgeAction.focus();
      });
      actionSuggestList.appendChild(item);
    });
    actionSuggestList.hidden = false;
  }

  function hideActionSuggestions() {
    actionSuggestList.hidden = true;
  }

  edgeAction.addEventListener("focus", renderActionSuggestions);
  edgeAction.addEventListener("input", renderActionSuggestions);
  edgeAction.addEventListener("blur", () => setTimeout(hideActionSuggestions, 150));

  function positionEditor(editorEl, coords) {
    // coords are SVG-relative; convert to viewport coordinates since the
    // editor is position:fixed (so it can never be clipped by the canvas's
    // overflow:hidden, regardless of how tall the popup renders).
    const svgRect = svg.getBoundingClientRect();
    const viewportX = svgRect.left + coords.x;
    const viewportY = svgRect.top + coords.y;

    // Make it visible-but-invisible first so we can measure its real size
    // instead of guessing — guessed heights are what caused the clipping bug.
    editorEl.hidden = false;
    editorEl.style.visibility = "hidden";
    const rect = editorEl.getBoundingClientRect();
    const margin = 8;
    const maxLeft = window.innerWidth - rect.width - margin;
    const maxTop = window.innerHeight - rect.height - margin;
    const left = Math.min(Math.max(margin, viewportX), Math.max(margin, maxLeft));
    const top = Math.min(Math.max(margin, viewportY), Math.max(margin, maxTop));
    editorEl.style.left = `${left}px`;
    editorEl.style.top = `${top}px`;
    editorEl.style.visibility = "";
  }

  function openEdgeEditorForNew(fromId, toId, coords) {
    closeNodeEditor();
    pendingEdge = { from: fromId, to: toId };
    editingEdgeId = null;

    refreshActionNames();

    edgeAction.value = "";
    edgeProb.value = 1;
    edgeCost.value = 0;

    document.getElementById("edgeDeleteBtn").hidden = true;

    positionEditor(edgeEditor, coords);
    renderActionSuggestions();
    // Deferred a frame: focusing immediately after the visibility toggle in
    // positionEditor is unreliable — the browser hasn't settled layout yet.
    requestAnimationFrame(() => edgeAction.focus());
  }

  function openEdgeEditorForExisting(edge, coords) {
    closeNodeEditor();
    pendingEdge = null;
    editingEdgeId = edge.id;
    refreshActionNames();
    edgeAction.value = edge.action;
    edgeProb.value = edge.prob;
    edgeCost.value = edge.cost;
    document.getElementById("edgeDeleteBtn").hidden = false;
    positionEditor(edgeEditor, coords);
    renderActionSuggestions();
    requestAnimationFrame(() => {
      edgeAction.focus();
      edgeAction.select();
    });
  }

  function openNodeEditor(nodeId, coords) {
    closeEdgeEditor();
    editingNodeId = nodeId;
    const node = findNode(nodeId);
    nodeNameInput.value = node.name;
    positionEditor(nodeEditor, coords);
    requestAnimationFrame(() => {
      nodeNameInput.focus();
      nodeNameInput.select();
    });
  }

  function closeNodeEditor() {
    nodeEditor.hidden = true;
    editingNodeId = null;
  }

  function saveNodeEditor() {
    if (editingNodeId != null) {
      const node = findNode(editingNodeId);
      const name = nodeNameInput.value.trim();
      if (node && name) node.name = name;
    }
    closeNodeEditor();
    render();
  }

  function closeEdgeEditor() {
    edgeEditor.hidden = true;
    pendingEdge = null;
    editingEdgeId = null;
  }

  function saveEdgeEditor() {
    const action = (edgeAction.value || "A0").trim();
    let prob = parseFloat(edgeProb.value);
    if (Number.isNaN(prob)) prob = 0;
    prob = Math.min(1, Math.max(0, prob));
    let cost = parseFloat(edgeCost.value);
    if (Number.isNaN(cost)) cost = 0;

    if (editingEdgeId != null) {
      const edge = edges.find((e) => e.id === editingEdgeId);
      if (edge) {
        edge.action = action;
        edge.prob = prob;
        edge.cost = cost;
      }
    } else if (pendingEdge) {
      // Only merge into an edge that already has this exact (from, to, action) —
      // a different action between the same pair of states must stay a separate edge.
      const existing = edges.find(
        (e) => e.from === pendingEdge.from && e.to === pendingEdge.to && e.action === action
      );
      if (existing) {
        existing.prob = prob;
        existing.cost = cost;
      } else {
        edges.push({
          id: nextEdgeId++,
          from: pendingEdge.from,
          to: pendingEdge.to,
          action,
          prob,
          cost,
        });
      }
    }

    closeEdgeEditor();
    render();
  }

  // ---------- Rendering ----------

  function edgePairKey(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  function computeEdgeGeometry() {
    // group by unordered pair for spacing, self-loops handled separately
    const groups = new Map();
    edges.forEach((e) => {
      if (e.from === e.to) return;
      const key = edgePairKey(e.from, e.to);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    });

    const geometry = new Map(); // edge.id -> {path, labelX, labelY}

    groups.forEach((group, key) => {
      // Use a perpendicular shared by both directions (based on the pair's
      // canonical low-id -> high-id line) so a reverse edge curves to the
      // opposite side instead of retracing the same path.
      const [lowId, highId] = key.split("|").map(Number);
      const lowNode = findNode(lowId);
      const highNode = findNode(highId);
      const pdx = highNode.x - lowNode.x;
      const pdy = highNode.y - lowNode.y;
      const pdist = Math.hypot(pdx, pdy) || 1;
      const perp = { x: -pdy / pdist, y: pdx / pdist };

      // sub-group by direction so opposite directions curve away from each other
      const byDirection = new Map();
      group.forEach((e) => {
        const dKey = `${e.from}->${e.to}`;
        if (!byDirection.has(dKey)) byDirection.set(dKey, []);
        byDirection.get(dKey).push(e);
      });

      byDirection.forEach((dirEdges) => {
        const n = dirEdges.length;
        dirEdges.forEach((e, j) => {
          const from = findNode(e.from);
          const to = findNode(e.to);
          const sign = e.from === lowId ? 1 : -1;
          const spread = (j - (n - 1) / 2) * 26;
          const offset = sign * 16 + spread;
          geometry.set(e.id, computeCurve(from, to, offset, perp));
        });
      });
    });

    // self loops
    const selfByNode = new Map();
    edges
      .filter((e) => e.from === e.to)
      .forEach((e) => {
        if (!selfByNode.has(e.from)) selfByNode.set(e.from, []);
        selfByNode.get(e.from).push(e);
      });
    selfByNode.forEach((list, nodeId) => {
      const node = findNode(nodeId);
      list.forEach((e, i) => {
        geometry.set(e.id, computeSelfLoop(node, i));
      });
    });

    return geometry;
  }

  function computeCurve(from, to, offset, perp) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;
    const px = perp ? perp.x : -uy;
    const py = perp ? perp.y : ux;
    const midX = (from.x + to.x) / 2 + px * offset;
    const midY = (from.y + to.y) / 2 + py * offset;

    const startX = from.x + ux * NODE_RADIUS;
    const startY = from.y + uy * NODE_RADIUS;

    // shorten end so arrowhead doesn't overlap node; approximate direction using control point
    const endDx = to.x - midX;
    const endDy = to.y - midY;
    const endDist = Math.hypot(endDx, endDy) || 1;
    const endX = to.x - (endDx / endDist) * (NODE_RADIUS + 2);
    const endY = to.y - (endDy / endDist) * (NODE_RADIUS + 2);

    const path = `M ${startX} ${startY} Q ${midX} ${midY} ${endX} ${endY}`;
    const labelX = 0.25 * startX + 0.5 * midX + 0.25 * endX;
    const labelY = 0.25 * startY + 0.5 * midY + 0.25 * endY;
    return { path, labelX, labelY };
  }

  function computeSelfLoop(node, index) {
    const angle = -Math.PI / 2 + index * 0.9;
    const spread = 0.5;
    const a1 = angle - spread;
    const a2 = angle + spread;
    const startX = node.x + Math.cos(a1) * NODE_RADIUS;
    const startY = node.y + Math.sin(a1) * NODE_RADIUS;
    const endX = node.x + Math.cos(a2) * NODE_RADIUS;
    const endY = node.y + Math.sin(a2) * NODE_RADIUS;
    const loopDist = NODE_RADIUS * 2.4;
    const c1x = node.x + Math.cos(a1) * loopDist;
    const c1y = node.y + Math.sin(a1) * loopDist;
    const c2x = node.x + Math.cos(a2) * loopDist;
    const c2y = node.y + Math.sin(a2) * loopDist;
    const path = `M ${startX} ${startY} C ${c1x} ${c1y} ${c2x} ${c2y} ${endX} ${endY}`;
    const labelX = node.x + Math.cos(angle) * loopDist;
    const labelY = node.y + Math.sin(angle) * loopDist;
    return { path, labelX, labelY };
  }

  function render(policyMap, valueMap) {
    edgesLayer.innerHTML = "";
    nodesLayer.innerHTML = "";

    const geometry = computeEdgeGeometry();

    edges.forEach((e) => {
      const geo = geometry.get(e.id);
      if (!geo) return;
      const isPolicy = policyMap && policyMap.get(e.from) === e.action;

      const hit = svgEl("path", {
        d: geo.path,
        class: "edge-hit",
        "data-edge-id": e.id,
      });
      edgesLayer.appendChild(hit);

      const visible = svgEl("path", {
        d: geo.path,
        class: `edge-path${isPolicy ? " edge-policy" : ""}`,
        "marker-end": "url(#arrowHead)",
        "data-edge-id": e.id,
      });
      edgesLayer.appendChild(visible);

      const label = svgEl("text", {
        x: geo.labelX,
        y: geo.labelY,
        class: `edge-label${isPolicy ? " edge-label-policy" : ""}`,
        "text-anchor": "middle",
        "data-edge-id": e.id,
      });
      label.textContent = `${e.action}  p=${e.prob}  cost=${e.cost}`;
      edgesLayer.appendChild(label);
    });

    nodes.forEach((n) => {
      const g = svgEl("g", { class: "node", "data-node-id": n.id });

      const circle = svgEl("circle", {
        cx: n.x,
        cy: n.y,
        r: NODE_RADIUS,
        class: "node-circle",
        "data-node-id": n.id,
      });
      g.appendChild(circle);

      const text = svgEl("text", {
        x: n.x,
        y: n.y + (valueMap ? -2 : 5),
        class: "node-label",
        "text-anchor": "middle",
        "data-node-id": n.id,
      });
      text.textContent = n.name;
      g.appendChild(text);

      if (valueMap && valueMap.has(n.id)) {
        const vText = svgEl("text", {
          x: n.x,
          y: n.y + 15,
          class: "node-value",
          "text-anchor": "middle",
          "data-node-id": n.id,
        });
        vText.textContent = `V=${valueMap.get(n.id).toFixed(2)}`;
        g.appendChild(vText);
      }

      nodesLayer.appendChild(g);
    });
  }

  // ---------- Value iteration on the graph ----------

  function solve() {
    validationMsg.textContent = "";

    if (nodes.length === 0) {
      validationMsg.textContent = "Add at least one state to the canvas first.";
      return;
    }

    const gamma = GAMMA;
    const theta = THETA;
    const maxIterations = MAX_ITERATIONS;

    // group edges by state -> action -> [edges]
    const actionsByState = new Map();
    nodes.forEach((n) => actionsByState.set(n.id, new Map()));
    edges.forEach((e) => {
      const stateMap = actionsByState.get(e.from);
      if (!stateMap.has(e.action)) stateMap.set(e.action, []);
      stateMap.get(e.action).push(e);
    });

    const issues = [];
    actionsByState.forEach((stateMap, nodeId) => {
      const node = findNode(nodeId);
      stateMap.forEach((list, action) => {
        const sum = list.reduce((s, e) => s + e.prob, 0);
        if (Math.abs(sum - 1) > 0.01) {
          issues.push(`${node.name}/${action} (sum=${sum.toFixed(3)})`);
        }
      });
    });
    if (issues.length > 0) {
      validationMsg.textContent = `Warning: some transition probabilities don't sum to 1: ${issues.join("; ")}`;
    }

    let V = new Map(nodes.map((n) => [n.id, 0]));
    const history = [];
    let iterations = 0;
    let converged = false;

    for (let iter = 0; iter < maxIterations; iter++) {
      const newV = new Map();
      let maxDelta = 0;

      nodes.forEach((n) => {
        const stateMap = actionsByState.get(n.id);
        if (stateMap.size === 0) {
          newV.set(n.id, 0);
          return;
        }
        let best = Infinity;
        stateMap.forEach((list) => {
          let q = 0;
          list.forEach((e) => {
            q += e.prob * (e.cost + gamma * V.get(e.to));
          });
          if (q < best) best = q;
        });
        newV.set(n.id, best);
        maxDelta = Math.max(maxDelta, Math.abs(best - V.get(n.id)));
      });

      V = newV;
      iterations++;
      history.push(maxDelta);
      if (maxDelta < theta) {
        converged = true;
        break;
      }
    }

    const policy = new Map();
    nodes.forEach((n) => {
      const stateMap = actionsByState.get(n.id);
      if (stateMap.size === 0) return;
      let best = Infinity;
      let bestAction = null;
      stateMap.forEach((list, action) => {
        let q = 0;
        list.forEach((e) => {
          q += e.prob * (e.cost + gamma * V.get(e.to));
        });
        if (q < best) {
          best = q;
          bestAction = action;
        }
      });
      policy.set(n.id, bestAction);
    });

    renderResults(V, policy, iterations, converged, history);
    render(policy, V);
  }

  function renderResults(V, policy, iterations, converged, history) {
    const statusMsg = document.getElementById("statusMsg");
    statusMsg.textContent = converged
      ? `Converged after ${iterations} iteration(s).`
      : `Did not converge within ${iterations} iteration(s) — values shown are the best found so far.`;
    statusMsg.className = `status-msg${converged ? "" : " warn"}`;

    const resultsTable = document.getElementById("resultsTable");
    resultsTable.innerHTML = "";
    const head = document.createElement("tr");
    ["State", "V(s)", "Optimal action"].forEach((t) => {
      const th = document.createElement("th");
      th.textContent = t;
      head.appendChild(th);
    });
    resultsTable.appendChild(head);

    nodes.forEach((n) => {
      const row = document.createElement("tr");
      const tdS = document.createElement("td");
      tdS.textContent = n.name;
      const tdV = document.createElement("td");
      tdV.textContent = V.get(n.id).toFixed(4);
      const tdA = document.createElement("td");
      tdA.textContent = policy.has(n.id) ? policy.get(n.id) : "— (terminal)";
      row.appendChild(tdS);
      row.appendChild(tdV);
      row.appendChild(tdA);
      resultsTable.appendChild(row);
    });

    const historyTable = document.getElementById("historyTable");
    historyTable.innerHTML = "";
    const hHead = document.createElement("tr");
    ["Sweep #", "Max Δ"].forEach((t) => {
      const th = document.createElement("th");
      th.textContent = t;
      hHead.appendChild(th);
    });
    historyTable.appendChild(hHead);
    history.forEach((delta, i) => {
      const row = document.createElement("tr");
      const tdI = document.createElement("td");
      tdI.textContent = i + 1;
      const tdD = document.createElement("td");
      tdD.textContent = delta.toFixed(6);
      row.appendChild(tdI);
      row.appendChild(tdD);
      historyTable.appendChild(row);
    });

    resultsPanel.hidden = false;
  }

  // ---------- Example ----------

  function loadExample() {
    // Classic "commute to work" MDP (Randour, UMons).
    nodes = [
      { id: 1, name: "Home", x: 460, y: 50 },
      { id: 2, name: "Wait room", x: 90, y: 280 },
      { id: 3, name: "Train", x: 270, y: 330 },
      { id: 4, name: "Light traffic", x: 540, y: 230 },
      { id: 5, name: "Medium traffic", x: 680, y: 280 },
      { id: 6, name: "Heavy traffic", x: 820, y: 330 },
      { id: 7, name: "Work", x: 460, y: 460 },
    ];
    edges = [
      { id: 1, from: 1, to: 2, action: "railway", prob: 0.1, cost: 2 },
      { id: 2, from: 1, to: 3, action: "railway", prob: 0.9, cost: 2 },
      { id: 3, from: 1, to: 4, action: "car", prob: 0.2, cost: 1 },
      { id: 4, from: 1, to: 5, action: "car", prob: 0.7, cost: 1 },
      { id: 5, from: 1, to: 6, action: "car", prob: 0.1, cost: 1 },
      { id: 6, from: 1, to: 7, action: "cycle", prob: 1, cost: 45 },
      { id: 7, from: 2, to: 1, action: "go home", prob: 1, cost: 2 },
      { id: 8, from: 2, to: 2, action: "wait", prob: 0.1, cost: 3 },
      { id: 9, from: 2, to: 3, action: "wait", prob: 0.9, cost: 3 },
      { id: 10, from: 3, to: 7, action: "relax", prob: 1, cost: 35 },
      { id: 11, from: 4, to: 7, action: "drive", prob: 1, cost: 20 },
      { id: 12, from: 5, to: 7, action: "drive", prob: 1, cost: 30 },
      { id: 13, from: 6, to: 7, action: "drive", prob: 1, cost: 70 },
    ];
    nextNodeId = 8;
    nextEdgeId = 14;
    fitNodesToCanvas();
    resultsPanel.hidden = true;
    render();
  }

  // The example is laid out for a canvas about 880px wide. On a narrower canvas the
  // right-hand states would sit behind the canvas-wrap's overflow:hidden, invisible
  // and unclickable, so squeeze the x positions to fit. A layout that already fits
  // is left exactly as authored.
  function fitNodesToCanvas() {
    const width = svg.getBoundingClientRect().width;
    const xs = nodes.map((n) => n.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    if (maxX + NODE_RADIUS + 8 <= width) return;
    // wider than the node itself: self-loop labels are centred on the node and
    // are roughly 100px wide
    const pad = NODE_RADIUS + 28;
    if (width <= 2 * pad) return;
    const scale = (width - 2 * pad) / (maxX - minX || 1);
    nodes.forEach((n) => {
      n.x = pad + (n.x - minX) * scale;
    });
  }

  render();
})();
