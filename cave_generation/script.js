(function () {
  const canvas = document.getElementById("caveCanvas");
  const ctx = canvas.getContext("2d");

  const cols = 96;
  const rows = 72;
  const cellSize = 6;

  const initialChanceInput = document.getElementById("initialChance");
  const numStepsInput = document.getElementById("numSteps");
  const birthLimitInput = document.getElementById("birthLimit");
  const deathLimitInput = document.getElementById("deathLimit");

  const initialChanceVal = document.getElementById("initialChanceVal");
  const numStepsVal = document.getElementById("numStepsVal");
  const birthLimitVal = document.getElementById("birthLimitVal");
  const deathLimitVal = document.getElementById("deathLimitVal");

  const newWorldBtn = document.getElementById("newWorldBtn");
  const smoothBtn = document.getElementById("smoothBtn");
  const statLine = document.getElementById("statLine");

  let grid = createEmptyGrid();
  let generation = 0;

  function createEmptyGrid() {
    return new Uint8Array(cols * rows);
  }

  function idx(x, y) {
    return y * cols + x;
  }

  function randomiseGrid(chance) {
    const g = createEmptyGrid();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        g[idx(x, y)] = Math.random() < chance ? 1 : 0;
      }
    }
    return g;
  }

  function countAliveNeighbours(g, x, y) {
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
          count += 1; // outside the map counts as alive
        } else {
          count += g[idx(nx, ny)];
        }
      }
    }
    return count;
  }

  function step(g, birthLimit, deathLimit) {
    const next = createEmptyGrid();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const alive = g[idx(x, y)] === 1;
        const neighbours = countAliveNeighbours(g, x, y);
        if (alive) {
          next[idx(x, y)] = neighbours < deathLimit ? 0 : 1;
        } else {
          next[idx(x, y)] = neighbours > birthLimit ? 1 : 0;
        }
      }
    }
    return next;
  }

  function render() {
    canvas.width = cols * cellSize;
    canvas.height = rows * cellSize;

    const aliveColor = getComputedStyle(document.documentElement).getPropertyValue("--color-alive").trim() || "#475569";
    const deadColor = getComputedStyle(document.documentElement).getPropertyValue("--color-dead").trim() || "#2563eb";

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        ctx.fillStyle = g_alive(x, y) ? aliveColor : deadColor;
        ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      }
    }

    updateStats();
  }

  function g_alive(x, y) {
    return grid[idx(x, y)] === 1;
  }

  function updateStats() {
    let aliveCount = 0;
    for (let i = 0; i < grid.length; i++) aliveCount += grid[i];
    const pct = ((aliveCount / grid.length) * 100).toFixed(1);
    statLine.textContent = `Generation ${generation} — ${pct}% rock (${aliveCount}/${grid.length} cells)`;
  }

  function generateNewWorld() {
    const chance = parseFloat(initialChanceInput.value);
    const steps = parseInt(numStepsInput.value, 10);
    const birthLimit = parseInt(birthLimitInput.value, 10);
    const deathLimit = parseInt(deathLimitInput.value, 10);

    grid = randomiseGrid(chance);
    generation = 0;

    for (let i = 0; i < steps; i++) {
      grid = step(grid, birthLimit, deathLimit);
      generation++;
    }

    render();
  }

  function smoothMap() {
    const birthLimit = parseInt(birthLimitInput.value, 10);
    const deathLimit = parseInt(deathLimitInput.value, 10);
    grid = step(grid, birthLimit, deathLimit);
    generation++;
    render();
  }

  initialChanceInput.addEventListener("input", () => {
    initialChanceVal.textContent = parseFloat(initialChanceInput.value).toFixed(2);
  });
  numStepsInput.addEventListener("input", () => {
    numStepsVal.textContent = numStepsInput.value;
  });
  birthLimitInput.addEventListener("input", () => {
    birthLimitVal.textContent = birthLimitInput.value;
  });
  deathLimitInput.addEventListener("input", () => {
    deathLimitVal.textContent = deathLimitInput.value;
  });
  newWorldBtn.addEventListener("click", generateNewWorld);
  smoothBtn.addEventListener("click", smoothMap);

  // initial world on load
  generateNewWorld();
})();
