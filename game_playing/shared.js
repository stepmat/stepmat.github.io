// ─── AI Hints Toggle ──────────────────────────────────────────────────────────

function showAIHints() {
  const el = document.getElementById('toggle-ai-hints');
  return el ? el.checked : true;
}

// ─── Arrow Drawing ────────────────────────────────────────────────────────────

function valueToColor(t) {
  t = Math.max(0, Math.min(1, t));
  let r, g, b;
  if (t <= 0.5) { const s = t*2; r=Math.round(255-127*s); g=0; b=Math.round(128*s); }
  else { const s=(t-0.5)*2; r=Math.round(128-128*s); g=0; b=Math.round(128+127*s); }
  return `rgb(${r},${g},${b})`;
}

function drawArrow(svg, x1, y1, x2, y2, color, width) {
  const dx=x2-x1, dy=y2-y1, len=Math.sqrt(dx*dx+dy*dy);
  if (len < 1) return;
  const ux=dx/len, uy=dy/len;
  const headLen=Math.max(12,width*2.5), headWidth=Math.max(8,width*2);
  const sx=x1+ux*22, sy=y1+uy*22;
  const ex=x2-ux*headLen, ey=y2-uy*headLen;
  const px=-uy, py=ux;
  const line=document.createElementNS('http://www.w3.org/2000/svg','line');
  line.setAttribute('x1',sx); line.setAttribute('y1',sy);
  line.setAttribute('x2',ex); line.setAttribute('y2',ey);
  line.setAttribute('stroke',color); line.setAttribute('stroke-width',width);
  line.setAttribute('stroke-linecap','round'); line.setAttribute('opacity','0.78');
  svg.appendChild(line);
  const pts=[`${x2-ux*2},${y2-uy*2}`,`${ex+px*headWidth/2},${ey+py*headWidth/2}`,`${ex-px*headWidth/2},${ey-py*headWidth/2}`].join(' ');
  const tri=document.createElementNS('http://www.w3.org/2000/svg','polygon');
  tri.setAttribute('points',pts); tri.setAttribute('fill',color); tri.setAttribute('opacity','0.78');
  svg.appendChild(tri);
}

// ─── Generic MiniMax ─────────────────────────────────────────────────────────
// game interface: { moves(s), apply(s,m), evaluate(s,availableMoves),
//                   isMaximizing(s), orderMoves?(s,moves), movesEqual?(m1,m2) }

function minimaxSearch(game, state, depth, alpha, beta) {
  const moves = game.moves(state);
  if (depth === 0 || moves.length === 0) return game.evaluate(state, moves);
  const ordered = game.orderMoves ? game.orderMoves(state, moves) : moves;
  if (game.isMaximizing(state)) {
    let best = -Infinity;
    for (const m of ordered) {
      best = Math.max(best, minimaxSearch(game, game.apply(state, m), depth-1, alpha, beta));
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const m of ordered) {
      best = Math.min(best, minimaxSearch(game, game.apply(state, m), depth-1, alpha, beta));
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }
}

// ─── Generic UCT ─────────────────────────────────────────────────────────────
// game interface additionally requires: isTerminal(s), simulate(s) -> [0,1] (1=AI wins)

class UCTNode {
  constructor(state, move, parent) {
    this.state = state; this.move = move; this.parent = parent;
    this.children = []; this.wins = 0; this.visits = 0; this._unvisited = null;
  }
  getUnvisited(game) {
    if (this._unvisited === null) this._unvisited = game.moves(this.state);
    const eq = game.movesEqual || ((a,b) => a === b);
    return this._unvisited.filter(m => !this.children.some(c => eq(c.move, m)));
  }
  uct(c) {
    if (this.visits === 0) return Infinity;
    return this.wins/this.visits + c*Math.sqrt(Math.log(this.parent.visits)/this.visits);
  }
  bestChild(c) { return this.children.reduce((a,b) => b.uct(c) > a.uct(c) ? b : a); }
}

function _uctIterate(game, root, explorationC) {
  let node = root;
  while (node.getUnvisited(game).length === 0 && node.children.length > 0 && !game.isTerminal(node.state))
    node = node.bestChild(explorationC);
  const unvis = node.getUnvisited(game);
  if (unvis.length > 0 && !game.isTerminal(node.state)) {
    const m = unvis[Math.floor(Math.random()*unvis.length)];
    const child = new UCTNode(game.apply(node.state, m), m, node);
    node.children.push(child); node = child;
  }
  const rawResult = game.simulate(node.state);
  // isMaximizing(node.state) = true means the maximizing player is ABOUT to move,
  // so the minimizing player just moved — rawResult (1=minimizer wins) is correct.
  // If the maximizing player just moved, flip so wins track their perspective.
  let r = game.isMaximizing(node.state) ? rawResult : (1 - rawResult);
  let n = node;
  while (n) { n.visits++; n.wins += r; r = 1 - r; n = n.parent; }
}

function _uctResult(root) {
  if (!root.children.length) return {move: null, arrowData: []};
  const best = root.children.reduce((a,b) => b.visits > a.visits ? b : a);
  const maxV = Math.max(...root.children.map(c => c.visits));
  const arrowData = root.children.map(c => ({
    move: c.move,
    value: c.visits > 0 ? c.wins/c.visits : 0.5,
    width: 2 + 10*(c.visits/maxV),
  }));
  return {move: best.move, arrowData};
}

// ─── Player Helpers ───────────────────────────────────────────────────────────

// player: 'X' = maximizer (p1), 'O' = minimizer (p2)
function getPlayerType(player) {
  return document.getElementById(player === 'X' ? 'p1-type' : 'p2-type').value;
}

function isMinimaxActive() {
  return getPlayerType('X') === 'minimax' || getPlayerType('O') === 'minimax';
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function buildSidebar(opts = {}) {
  const {
    extraSettings = '', extraControls = '', extraPanels = '',
    mmDepthMax = 5, mmDepthDefault = 3,
    uctSimsMax = 3000, uctSimsDefault = 800,
    p1Label = 'Player 1 (X)', p2Label = 'Player 2 (O)',
    p1Default = 'human', p2Default = 'minimax',
  } = opts;

  const playerSection = (prefix, label, def) => `
    <div style="margin-bottom:14px;">
      <div style="font-size:0.82rem;color:var(--color-text-muted);margin-bottom:4px;font-weight:bold;">${label}</div>
      <select id="${prefix}-type">
        <option value="human"${def==='human'?' selected':''}>Human</option>
        <option value="minimax"${def==='minimax'?' selected':''}>MiniMax (heuristics)</option>
        <option value="uct"${def==='uct'?' selected':''}>UCT</option>
      </select>
      <div id="${prefix}-mm-opts" style="display:${def==='minimax'?'block':'none'}">
        <label>Depth
          <div class="range-row">
            <input type="range" id="${prefix}-mm-depth" min="1" max="${mmDepthMax}" value="${mmDepthDefault}">
            <span class="range-val" id="${prefix}-mm-depth-val">${mmDepthDefault}</span>
          </div>
        </label>
      </div>
      <div id="${prefix}-uct-opts" style="display:${def==='uct'?'block':'none'}">
        <label>Playouts
          <div class="range-row">
            <input type="range" id="${prefix}-uct-sims" min="100" max="${uctSimsMax}" step="100" value="${uctSimsDefault}">
            <span class="range-val" id="${prefix}-uct-sims-val">${uctSimsDefault}</span>
          </div>
        </label>
      </div>
    </div>
  `;

  document.getElementById('sidebar').innerHTML = `
    <div class="panel" style="min-width:220px;">
      <h3>Players</h3>
      ${playerSection('p1', p1Label, p1Default)}
      ${playerSection('p2', p2Label, p2Default)}
      ${extraSettings}
      <button class="btn-primary" id="btn-new">New Game</button>
    </div>
    <div style="display:flex; flex-direction:column; gap:14px; min-width:190px; max-width:250px; width:250px;">
      <div class="panel">
        <h3>Status</h3>
        <div id="status-box"></div>
        <div id="thinking"></div>
        <div id="ai-progress-wrap"><div id="ai-progress-bar"></div></div>
        <label style="display:flex;align-items:center;gap:6px;margin-top:8px;font-size:0.82rem;color:var(--color-text-muted);cursor:pointer;">
          <input type="checkbox" id="toggle-ai-hints"> Show AI thinking
        </label>
      </div>
      ${extraControls ? `<div class="panel">${extraControls}</div>` : ''}
      <div class="panel" id="score-panel" style="display:none">
        <h3>Score Breakdown</h3>
        <div id="score-breakdown" style="font-size:0.82rem;font-family:monospace;line-height:1.8;color:var(--color-text-muted);"></div>
      </div>
      ${extraPanels}
    </div>
  `;
}

function setupSharedUI(callbacks = {}) {
  const {onAlgoChange, onNewGame, onPlayerChange} = callbacks;
  ['p1', 'p2'].forEach(prefix => {
    document.getElementById(`${prefix}-type`).addEventListener('change', function() {
      document.getElementById(`${prefix}-mm-opts`).style.display = this.value === 'minimax' ? 'block' : 'none';
      document.getElementById(`${prefix}-uct-opts`).style.display = this.value === 'uct' ? 'block' : 'none';
      cancelAI();
      if (onAlgoChange) onAlgoChange(this.value);
      // cancelAI() throws away any move in progress, so the turn must be handed out
      // again: otherwise an AI whose settings changed mid-think never moves, and a
      // player switched from Human to AI on their own turn never starts.
      if (onPlayerChange) onPlayerChange();
    });
    document.getElementById(`${prefix}-mm-depth`).addEventListener('input', function() {
      document.getElementById(`${prefix}-mm-depth-val`).textContent = this.value;
    });
    document.getElementById(`${prefix}-uct-sims`).addEventListener('input', function() {
      document.getElementById(`${prefix}-uct-sims-val`).textContent = this.value;
    });
  });
  document.getElementById('btn-new').addEventListener('click', () => { cancelAI(); if (onNewGame) onNewGame(); });
  document.getElementById('toggle-ai-hints').addEventListener('change', () => { if (callbacks.onRender) callbacks.onRender(); });
  // Weight inputs live in each game's extraSettings. Every game's onAlgoChange just
  // refreshes its Score Breakdown, so reuse it to update the panel as soon as a
  // weight is edited rather than after the next move.
  document.getElementById('sidebar').addEventListener('input', (e) => {
    if (e.target.closest('.piece-weight-row') && onAlgoChange) onAlgoChange();
  });
}

let _aiGen = 0;

// Invalidates any in-flight AI computation so its result is discarded when it finishes.
// Must be called whenever the board/turn state is about to change outside of runAI's own
// callback (New Game, algorithm/depth/sims changes, undo) — otherwise a stale computation
// can land its move on a board it was never computed against.
function cancelAI() {
  _aiGen++;
  const thinkEl = document.getElementById('thinking');
  const progWrap = document.getElementById('ai-progress-wrap');
  if (thinkEl) thinkEl.textContent = '';
  if (progWrap) progWrap.style.display = 'none';
}

function runAI(game, state, onResult) {
  const gen = ++_aiGen;
  const isMax = game.isMaximizing(state);
  const prefix = isMax ? 'p1' : 'p2';
  const algo = document.getElementById(`${prefix}-type`).value;
  const thinkEl = document.getElementById('thinking');
  const progWrap = document.getElementById('ai-progress-wrap');
  const progBar = document.getElementById('ai-progress-bar');

  function cancel() {
    thinkEl.textContent = '';
    progWrap.style.display = 'none';
  }

  thinkEl.textContent = algo === 'minimax' ? 'MiniMax thinking...' : 'UCT simulating...';
  progWrap.style.display = 'block';
  progBar.style.width = '0%';

  if (algo === 'minimax') {
    const depth = parseInt(document.getElementById(`${prefix}-mm-depth`).value);
    const moves = game.moves(state);
    if (!moves.length) {
      cancel();
      onResult({move: null, arrowData: []});
      return;
    }
    const maximizing = game.isMaximizing(state);
    let bestVal = maximizing ? -Infinity : Infinity;
    const moveScores = [];
    let i = 0;

    function stepMM() {
      if (_aiGen !== gen) { return; }
      const m = moves[i];
      const val = minimaxSearch(game, game.apply(state, m), depth - 1, -Infinity, Infinity);
      moveScores.push({move: m, score: val});
      if (maximizing ? val > bestVal : val < bestVal) bestVal = val;
      i++;
      progBar.style.width = `${(i / moves.length * 100).toFixed(1)}%`;
      if (i < moves.length) {
        setTimeout(stepMM, 0);
      } else {
        if (_aiGen !== gen) { return; }
        const best = moveScores.filter(ms => ms.score === bestVal);
        const bestMove = best[Math.floor(Math.random() * best.length)].move;
        const arrowData = moveScores.map(ms => {
          const t = maximizing
            ? (ms.score === Infinity ? 1 : ms.score === -Infinity ? 0 : 0.5 + 0.5 * ms.score / (1 + Math.abs(ms.score)))
            : (ms.score === Infinity ? 0 : ms.score === -Infinity ? 1 : 0.5 - 0.5 * ms.score / (1 + Math.abs(ms.score)));
          return {move: ms.move, value: t, width: 7};
        });
        cancel();
        onResult({move: bestMove, arrowData});
      }
    }
    setTimeout(stepMM, 10);
  } else {
    const totalSims = parseInt(document.getElementById(`${prefix}-uct-sims`).value);
    const root = new UCTNode(state, null, null);
    root.visits = 1;
    let done = 0;

    function tick() {
      if (_aiGen !== gen) { return; }
      const deadline = performance.now() + 16; // ~60 fps budget
      while (done < totalSims && performance.now() < deadline) {
        _uctIterate(game, root, Math.SQRT2);
        done++;
      }
      progBar.style.width = `${(done / totalSims * 100).toFixed(1)}%`;
      if (done < totalSims) {
        requestAnimationFrame(tick);
      } else {
        if (_aiGen !== gen) { return; }
        cancel();
        onResult(_uctResult(root));
      }
    }
    setTimeout(tick, 10);
  }
}

// ─── Fit the board on narrow screens ──────────────────────────────────────────
// Boards have fixed pixel sizes. When the window is narrower than the board, scale the
// whole board (hint overlay included) with CSS zoom so no part of it is cut off. zoom
// scales layout and hit-testing together, so clicks still land on the right cell.

function fitBoardToWindow() {
  const board = document.querySelector('.main > :first-child');
  if (!board) return;
  board.style.zoom = '';
  const cs = getComputedStyle(document.body);
  const available = document.documentElement.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const width = board.offsetWidth;
  if (available > 0 && width > available) board.style.zoom = (available / width).toFixed(4);
}

window.addEventListener('load', () => {
  fitBoardToWindow();
  // run again once layout settles: an over-wide page can briefly widen the viewport
  setTimeout(fitBoardToWindow, 50);
});
window.addEventListener('resize', fitBoardToWindow);

// ─── Tooltips ─────────────────────────────────────────────────────────────────

(function() {
  const tip = document.createElement('div');
  tip.className = 'hw-tooltip';
  document.body.appendChild(tip);

  document.addEventListener('mouseover', e => {
    const el = e.target.closest('[data-tooltip]');
    if (!el) return;
    tip.textContent = el.dataset.tooltip;
    tip.style.display = 'block';
  });
  document.addEventListener('mouseout', e => {
    const el = e.target.closest('[data-tooltip]');
    if (el && !el.contains(e.relatedTarget)) tip.style.display = 'none';
  });
  document.addEventListener('mousemove', e => {
    if (tip.style.display === 'none') return;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = (e.clientX + 14 + tw > window.innerWidth ? e.clientX - tw - 14 : e.clientX + 14) + 'px';
    tip.style.top  = (e.clientY + th + 8 > window.innerHeight ? e.clientY - th - 8 : e.clientY + 8) + 'px';
  });
})();
