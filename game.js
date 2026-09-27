/* ---------- Audio (synthesized, no external assets) ---------- */

const audioCtx = window.AudioContext ? new AudioContext() : null;

function beep({ freq = 440, duration = 0.15, type = "sine", gain = 0.15, glideTo = null }) {
  if (!audioCtx) return;
  if (audioCtx.state === "suspended") audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  if (glideTo) osc.frequency.linearRampToValueAtTime(glideTo, audioCtx.currentTime + duration);
  g.gain.setValueAtTime(gain, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  osc.connect(g).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

const sounds = {
  move: () => beep({ freq: 180, duration: 0.08, type: "square", gain: 0.06 }),
  bump: () => beep({ freq: 90, duration: 0.12, type: "square", gain: 0.12 }),
  turn: () => beep({ freq: 260, duration: 0.06, type: "triangle", gain: 0.05 }),
  pickup: () => beep({ freq: 520, duration: 0.18, type: "sine", gain: 0.12, glideTo: 780 }),
  shoot: () => beep({ freq: 700, duration: 0.1, type: "sawtooth", gain: 0.1, glideTo: 200 }),
  scream: () => beep({ freq: 500, duration: 0.4, type: "sawtooth", gain: 0.15, glideTo: 60 }),
  miss: () => beep({ freq: 300, duration: 0.25, type: "triangle", gain: 0.1, glideTo: 120 }),
  death: () => beep({ freq: 220, duration: 0.6, type: "sawtooth", gain: 0.18, glideTo: 40 }),
  win: () => {
    beep({ freq: 523, duration: 0.15, gain: 0.14 });
    setTimeout(() => beep({ freq: 659, duration: 0.15, gain: 0.14 }), 140);
    setTimeout(() => beep({ freq: 784, duration: 0.3, gain: 0.14 }), 280);
  },
};

/* ---------- Directions ---------- */

const DIRS = ["N", "E", "S", "W"];
const DIR_VECTORS = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const FACING_ARROW = { N: "▲", E: "▶", S: "▼", W: "◀" };

const FACE_DEFAULT = "🙂";
const FACE_SCARED = "😨";
const FACE_EXCITED = "😲";
const FACE_DEAD = "💀";
const FACE_WIN = "😄";

/* ---------- Game state ---------- */

let state = null;

function inBounds(x, y, size) {
  return x >= 0 && y >= 0 && x < size && y < size;
}

function key(x, y) {
  return `${x},${y}`;
}

function neighbors(x, y, size) {
  return [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].filter(([nx, ny]) => inBounds(nx, ny, size));
}

function newGame(size) {
  const cells = new Map();
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      cells.set(key(x, y), { pit: false, wumpus: false, gold: false, arrow: false });
    }
  }

  const entry = { x: 0, y: 0 };
  const reserved = new Set([key(entry.x, entry.y)]);

  // Pick a random exit distinct from entry, kept hazard-free.
  let exit;
  do {
    exit = { x: Math.floor(Math.random() * size), y: Math.floor(Math.random() * size) };
  } while (key(exit.x, exit.y) === key(entry.x, entry.y));
  reserved.add(key(exit.x, exit.y));

  const freeCells = () =>
    [...cells.keys()].filter((k) => !reserved.has(k) && !cells.get(k).pit && !cells.get(k).wumpus && !cells.get(k).gold && !cells.get(k).arrow);

  function placeRandom(prop) {
    const options = freeCells();
    const pick = options[Math.floor(Math.random() * options.length)];
    cells.get(pick)[prop] = true;
    return pick;
  }

  // Wumpus, gold, arrow: exactly one each, never on entry/exit.
  placeRandom("wumpus");
  placeRandom("gold");
  placeRandom("arrow");

  // Pits scale with grid size: 1 pit at 4x4, 2 at 5x5, 3 at 6x6, etc.
  const pitCount = Math.max(1, size - 3);
  for (let i = 0; i < pitCount; i++) {
    const options = freeCells();
    if (options.length === 0) break;
    const pick = options[Math.floor(Math.random() * options.length)];
    cells.get(pick).pit = true;
  }

  const visited = new Set([key(entry.x, entry.y)]);

  return {
    size,
    cells,
    entry,
    exit,
    visited,
    agent: { x: entry.x, y: entry.y, dir: "E" },
    hasArrow: false,
    hasGold: false,
    arrowUsed: false,
    wumpusAlive: true,
    score: 0,
    over: false,
    lastPercepts: [],
    lastScream: false,
  };
}

/* ---------- Percepts ---------- */

function computePercepts(s) {
  const { x, y } = s.agent;
  const here = s.cells.get(key(x, y));
  const percepts = [];
  const adj = neighbors(x, y, s.size);

  if (adj.some(([nx, ny]) => s.cells.get(key(nx, ny)).pit)) percepts.push("breeze");
  if (s.wumpusAlive && adj.some(([nx, ny]) => s.cells.get(key(nx, ny)).wumpus)) percepts.push("stench");
  if (here.gold) percepts.push("glitter");
  if (here.arrow && !s.hasArrow) percepts.push("glint of metal");
  if (key(x, y) === key(s.exit.x, s.exit.y)) percepts.push("daylight above");

  return percepts;
}

/* ---------- Actions ---------- */

function addScore(delta) {
  state.score += delta;
}

function pressDirection(dir) {
  if (state.over) return;
  if (state.agent.dir !== dir) {
    state.agent.dir = dir;
    sounds.turn();
    render();
  } else {
    moveForward();
  }
}

function moveForward() {
  if (state.over) return;
  const [dx, dy] = DIR_VECTORS[state.agent.dir];
  const nx = state.agent.x + dx;
  const ny = state.agent.y + dy;

  addScore(-1);

  if (!inBounds(nx, ny, state.size)) {
    sounds.bump();
    setMessage("Bump : the tunnel ends here.");
    render();
    return;
  }

  state.agent.x = nx;
  state.agent.y = ny;
  state.visited.add(key(nx, ny));

  const cell = state.cells.get(key(nx, ny));

  if (cell.pit || (cell.wumpus && state.wumpusAlive)) {
    sounds.death();
    addScore(-1000);
    endGame(cell.pit ? "You fell into a pit." : "The Wumpus caught you.", false);
    render();
    return;
  }

  sounds.move();

  if (cell.arrow && !state.hasArrow) {
    state.hasArrow = true;
    sounds.pickup();
    setMessage("You found the arrow.");
  } else if (cell.gold && !state.hasGold) {
    state.hasGold = true;
    sounds.pickup();
    setMessage("You grabbed the gold!");
  } else if (key(nx, ny) === key(state.exit.x, state.exit.y) && state.hasGold) {
    addScore(1000);
    sounds.win();
    endGame("You escaped the cave with the gold!", true);
  } else if (key(nx, ny) === key(state.exit.x, state.exit.y)) {
    setMessage("Daylight above - but you have no gold yet.");
  } else {
    setMessage("");
  }

  render();
}

function shootArrow() {
  if (state.over || !state.hasArrow || state.arrowUsed) return;
  state.arrowUsed = true;
  sounds.shoot();

  const [dx, dy] = DIR_VECTORS[state.agent.dir];
  let x = state.agent.x;
  let y = state.agent.y;
  let hit = false;

  while (true) {
    x += dx;
    y += dy;
    if (!inBounds(x, y, state.size)) break;
    if (state.cells.get(key(x, y)).wumpus) {
      hit = true;
      break;
    }
  }

  if (hit) {
    state.wumpusAlive = false;
    state.lastScream = true;
    addScore(10);
    sounds.scream();
    setMessage("A dying scream echoes through the cave : the Wumpus is dead!");
  } else {
    addScore(-10);
    sounds.miss();
    setMessage("The arrow clatters uselessly against the rock. It missed.");
  }

  render();
}

function endGame(message, won) {
  state.over = true;
  state.won = won;
  document.getElementById("overlay-title").textContent = won ? "You escaped!" : "Game Over";
  document.getElementById("overlay-message").textContent = message;
  document.getElementById("overlay-score").textContent = state.score;
  document.getElementById("overlay").classList.remove("hidden");
}

function setMessage(msg) {
  const percepts = computePercepts(state);
  const parts = [...percepts];
  if (msg) parts.push(msg);
  document.getElementById("percepts").textContent = parts.join(" · ") || "All quiet.";
}

/* ---------- Rendering ---------- */

function render() {
  const board = document.getElementById("board");
  board.style.gridTemplateColumns = `repeat(${state.size}, 1fr)`;
  board.innerHTML = "";

  for (let y = 0; y < state.size; y++) {
    for (let x = 0; x < state.size; x++) {
      const cellData = state.cells.get(key(x, y));
      const div = document.createElement("div");
      div.className = "cell";

      const isEntry = x === state.entry.x && y === state.entry.y;
      const isExit = x === state.exit.x && y === state.exit.y;
      const isVisited = state.visited.has(key(x, y));
      const isAgent = x === state.agent.x && y === state.agent.y;

      if (isEntry) div.classList.add("entry-marker");

      if (!isVisited) {
        div.classList.add("unexplored");
      } else {
        if (isExit) div.classList.add("exit-tile");

        if (state.over && cellData.pit) div.classList.add("pit-revealed");
        if (state.over && cellData.wumpus) div.classList.add("wumpus-revealed");

        const icons = document.createElement("div");
        icons.className = "icons";
        const adj = neighbors(x, y, state.size);
        if (adj.some(([nx, ny]) => state.cells.get(key(nx, ny)).pit)) {
          icons.innerHTML += `<div class="sensor-box breeze">Breeze</div>`;
        }
        if (state.wumpusAlive && adj.some(([nx, ny]) => state.cells.get(key(nx, ny)).wumpus)) {
          icons.innerHTML += `<div class="sensor-box stench">Stench</div>`;
        }
        if (cellData.gold && state.hasGold === false) {
          icons.innerHTML += `<div class="sensor-box glitter">Glitter</div>`;
        }
        if (cellData.arrow && !state.hasArrow) {
          icons.innerHTML += `<div class="sensor-box arrow-glint">Arrow</div>`;
        }
        div.appendChild(icons);
      }

      if (isAgent) {
        const agentEl = document.createElement("span");
        agentEl.className = "agent";

        const faceEl = document.createElement("span");
        faceEl.className = "face";
        faceEl.textContent = faceForAgent();
        agentEl.appendChild(faceEl);

        const facingEl = document.createElement("span");
        facingEl.className = `facing facing-${state.agent.dir}`;
        facingEl.textContent = FACING_ARROW[state.agent.dir];
        agentEl.appendChild(facingEl);

        if (state.hasArrow && !state.arrowUsed) {
          const quiverEl = document.createElement("span");
          quiverEl.className = "quiver";
          quiverEl.textContent = "🏹";
          agentEl.appendChild(quiverEl);
        }

        div.appendChild(agentEl);
      }

      board.appendChild(div);
    }
  }

  document.getElementById("score").textContent = state.score;
  document.getElementById("arrow-status").textContent = state.arrowUsed
    ? "used"
    : state.hasArrow
    ? "ready"
    : "not found";
  document.getElementById("gold-status").textContent = state.hasGold ? "carried" : "-";

  setMessage("");
}

function faceForAgent() {
  if (state.over) return state.won ? FACE_WIN : FACE_DEAD;

  const { x, y } = state.agent;
  const here = state.cells.get(key(x, y));
  if (here.gold && !state.hasGold) return FACE_EXCITED;

  const adj = neighbors(x, y, state.size);
  const scared =
    adj.some(([nx, ny]) => state.cells.get(key(nx, ny)).pit) ||
    (state.wumpusAlive && adj.some(([nx, ny]) => state.cells.get(key(nx, ny)).wumpus));
  if (scared) return FACE_SCARED;

  return FACE_DEFAULT;
}

/* ---------- Setup ---------- */

function startGame() {
  const size = parseInt(document.getElementById("grid-size").value, 10);
  state = newGame(size);
  document.getElementById("overlay").classList.add("hidden");
  render();
}

document.getElementById("grid-size").addEventListener("input", (e) => {
  document.getElementById("grid-size-label").textContent = `${e.target.value} × ${e.target.value}`;
});

document.getElementById("new-game").addEventListener("click", startGame);
document.getElementById("restart-btn").addEventListener("click", startGame);
document.getElementById("dir-up").addEventListener("click", () => pressDirection("N"));
document.getElementById("dir-down").addEventListener("click", () => pressDirection("S"));
document.getElementById("dir-left").addEventListener("click", () => pressDirection("W"));
document.getElementById("dir-right").addEventListener("click", () => pressDirection("E"));
document.getElementById("shoot-arrow").addEventListener("click", shootArrow);

window.addEventListener("keydown", (e) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) {
    e.preventDefault();
  }
  switch (e.key) {
    case "w":
    case "W":
    case "ArrowUp":
      pressDirection("N");
      break;
    case "s":
    case "S":
    case "ArrowDown":
      pressDirection("S");
      break;
    case "a":
    case "A":
    case "ArrowLeft":
      pressDirection("W");
      break;
    case "d":
    case "D":
    case "ArrowRight":
      pressDirection("E");
      break;
    case " ":
      shootArrow();
      break;
  }
});

startGame();
