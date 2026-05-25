/* ═══════════════════════════════════════════════
   TIC TAC TOE — MULTIPLAYER ARENA
   game.js
   ═══════════════════════════════════════════════ */

'use strict';

// ── Win combinations ───────────────────────────
const LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6]
];

// ── Utility: calculate winner ──────────────────
function calcWinner(squares) {
  for (const [a, b, c] of LINES) {
    if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c])
      return squares[a];
  }
  return null;
}

// ── Utility: winning line indices ─────────────
function winLine(squares) {
  for (const line of LINES) {
    const [a, b, c] = line;
    if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c])
      return line;
  }
  return null;
}

// ── AI: Minimax ────────────────────────────────
function minimax(board, isMax, depth = 0) {
  const winner = calcWinner(board);
  if (winner === 'O') return 10 - depth;
  if (winner === 'X') return depth - 10;
  if (board.every(Boolean)) return 0;

  let best = isMax ? -Infinity : Infinity;
  for (let i = 0; i < 9; i++) {
    if (!board[i]) {
      board[i] = isMax ? 'O' : 'X';
      const val = minimax(board, !isMax, depth + 1);
      board[i] = null;
      best = isMax ? Math.max(best, val) : Math.min(best, val);
    }
  }
  return best;
}

function bestMove(board) {
  let best = -Infinity, move = -1;
  for (let i = 0; i < 9; i++) {
    if (!board[i]) {
      board[i] = 'O';
      const val = minimax(board, false);
      board[i] = null;
      if (val > best) { best = val; move = i; }
    }
  }
  return move;
}

// ── Random Room ID ─────────────────────────────
function makeRoomId() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

// ═══════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════
const state = {
  screen: 'home',       // home | lobby | waiting | game
  mode: null,           // pvp-offline | pva | pvp-online
  board: Array(9).fill(null),
  xIsNext: true,
  scores: { X: 0, O: 0, D: 0 },
  result: null,         // null | 'X' | 'O' | 'D'
  myMark: 'X',
  roomId: '',
  playerNames: { X: 'Player 1', O: 'Player 2' },
  opponentConnected: false,
  aiThinking: false,
};

let channel = null;     // BroadcastChannel instance
let notifTimer = null;
let aiTimer = null;

// ═══════════════════════════════════════════════
// DOM REFS
// ═══════════════════════════════════════════════
const $ = id => document.getElementById(id);
const screens = {
  home:    $('screen-home'),
  lobby:   $('screen-lobby'),
  waiting: $('screen-waiting'),
  game:    $('screen-game'),
};

// ═══════════════════════════════════════════════
// SCREEN MANAGER
// ═══════════════════════════════════════════════
function showScreen(name) {
  state.screen = name;
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

// ═══════════════════════════════════════════════
// NOTIFICATION
// ═══════════════════════════════════════════════
function showNotif(msg) {
  const el = $('notif');
  el.textContent = msg;
  el.classList.remove('hidden');
  // force re-trigger animation
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  clearTimeout(notifTimer);
  notifTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

// ═══════════════════════════════════════════════
// ONLINE: BroadcastChannel
// ═══════════════════════════════════════════════
function openChannel(roomId) {
  if (channel) { channel.close(); }
  channel = new BroadcastChannel('ttt_' + roomId);
  channel.onmessage = e => handleOnlineMsg(e.data);
}

function send(data) {
  if (channel) channel.postMessage(data);
}

function handleOnlineMsg(data) {
  switch (data.type) {
    case 'joined':
      state.opponentConnected = true;
      state.playerNames[data.mark] = data.name;
      showScreen('game');
      renderGame();
      showNotif(data.name + ' joined!');
      break;

    case 'move':
      state.board = data.board;
      state.xIsNext = data.xIsNext;
      renderBoard();
      updateTurnIndicator();
      checkResultAfterOnlineMove();
      break;

    case 'restart':
      resetBoard();
      renderGame();
      break;

    case 'leave':
      showNotif('Opponent left the room.');
      state.opponentConnected = false;
      renderGame();
      showScreen('waiting');
      break;
  }
}

function checkResultAfterOnlineMove() {
  const winner = calcWinner(state.board);
  const full = state.board.every(Boolean);
  if (winner) finishGame(winner);
  else if (full) finishGame('D');
  else renderGame();
}

// ═══════════════════════════════════════════════
// GAME ACTIONS
// ═══════════════════════════════════════════════
function handleCellClick(i) {
  if (state.board[i] || state.result || state.aiThinking) return;

  // Online: only allow my turn
  if (state.mode === 'pvp-online') {
    const isMyTurn = (state.xIsNext && state.myMark === 'X') ||
                     (!state.xIsNext && state.myMark === 'O');
    if (!isMyTurn) return;
  }

  const mark = state.xIsNext ? 'X' : 'O';
  state.board[i] = mark;
  state.xIsNext = !state.xIsNext;

  renderBoard();

  const winner = calcWinner(state.board);
  const full = state.board.every(Boolean);

  if (winner) {
    finishGame(winner);
  } else if (full) {
    finishGame('D');
  } else {
    updateTurnIndicator();
    if (state.mode === 'pvp-online') {
      send({ type: 'move', board: state.board, xIsNext: state.xIsNext });
    }
    if (state.mode === 'pva' && !state.xIsNext) {
      scheduleAiMove();
    }
  }
}

function scheduleAiMove() {
  state.aiThinking = true;
  updateTurnIndicator();
  clearTimeout(aiTimer);
  aiTimer = setTimeout(() => {
    if (state.result) return;
    const move = bestMove([...state.board]);
    if (move === -1) return;
    state.board[move] = 'O';
    state.xIsNext = true;
    state.aiThinking = false;
    renderBoard();
    const winner = calcWinner(state.board);
    const full = state.board.every(Boolean);
    if (winner) finishGame(winner);
    else if (full) finishGame('D');
    else updateTurnIndicator();
  }, 550);
}

function finishGame(winner) {
  state.result = winner;
  state.scores[winner]++;
  renderScores();
  renderBoard();        // apply win-cell classes
  renderResultBanner();
  renderTurnText('');
}

function resetBoard() {
  clearTimeout(aiTimer);
  state.board = Array(9).fill(null);
  state.xIsNext = true;
  state.result = null;
  state.aiThinking = false;
}

function restart() {
  resetBoard();
  renderGame();
  if (state.mode === 'pvp-online') send({ type: 'restart' });
}

function leaveGame() {
  if (state.mode === 'pvp-online') send({ type: 'leave' });
  if (channel) { channel.close(); channel = null; }
  clearTimeout(aiTimer);
  state.mode = null;
  state.roomId = '';
  state.opponentConnected = false;
  state.board = Array(9).fill(null);
  state.result = null;
  state.scores = { X: 0, O: 0, D: 0 };
  state.aiThinking = false;
  showScreen('home');
}

// ═══════════════════════════════════════════════
// START MODES
// ═══════════════════════════════════════════════
function startOffline(mode) {
  state.mode = mode;
  state.playerNames = {
    X: mode === 'pva' ? 'You'      : 'Player 1',
    O: mode === 'pva' ? 'AI 🤖'   : 'Player 2',
  };
  resetBoard();
  renderGame();
  showScreen('game');
}

function createRoom() {
  const name = $('home-name').value.trim() || 'Player 1';
  const id = makeRoomId();
  state.roomId = id;
  state.myMark = 'X';
  state.playerNames = { X: name, O: 'Waiting...' };
  state.opponentConnected = false;
  state.mode = 'pvp-online';
  resetBoard();

  openChannel(id);

  $('waiting-room-code').textContent = id;
  $('waiting-sub-text').textContent = 'Open another tab → Online → Join → ' + id;
  showScreen('waiting');
  showNotif('Room ' + id + ' created!');
}

function joinRoom() {
  const code = $('input-room-code').value.trim().toUpperCase();
  if (code.length < 4) { showNotif('Enter a valid room code.'); return; }

  const name = $('home-name').value.trim() || 'Player 2';
  state.roomId = code;
  state.myMark = 'O';
  state.playerNames = { X: 'Host', O: name };
  state.opponentConnected = true;
  state.mode = 'pvp-online';
  resetBoard();

  openChannel(code);

  renderGame();
  showScreen('game');
  // Notify the host
  setTimeout(() => send({ type: 'joined', mark: 'O', name }), 100);
}

// ═══════════════════════════════════════════════
// RENDER FUNCTIONS
// ═══════════════════════════════════════════════
function renderGame() {
  renderRoomInfo();
  renderPlayerTags();
  renderScores();
  renderBoard();
  renderResultBanner();
  updateTurnIndicator();
  renderLeaveBtn();
}

function renderRoomInfo() {
  const el = $('room-info');
  if (state.mode === 'pvp-online') {
    el.classList.remove('hidden');
    $('game-room-code').textContent = state.roomId;
    const badge = $('badge-connected');
    if (state.opponentConnected) {
      badge.textContent = 'Connected';
      badge.className = 'badge badge-online';
    } else {
      badge.textContent = 'Waiting...';
      badge.className = 'badge badge-waiting';
    }
    $('badge-my-mark').textContent = 'You: ' + state.myMark;
  } else {
    el.classList.add('hidden');
  }
}

function renderPlayerTags() {
  $('name-x').textContent = state.playerNames.X;
  $('name-o').textContent = state.playerNames.O;
}

function renderScores() {
  $('score-x').textContent = state.scores.X;
  $('score-o').textContent = state.scores.O;
  $('score-d').textContent = state.scores.D;
}

function renderBoard() {
  const winner = calcWinner(state.board);
  const wl = winLine(state.board) || [];
  const currentMark = state.xIsNext ? 'X' : 'O';
  const isMyTurn = state.mode !== 'pvp-online' ||
                   (state.xIsNext  && state.myMark === 'X') ||
                   (!state.xIsNext && state.myMark === 'O');

  document.querySelectorAll('.cell').forEach(cell => {
    const i = parseInt(cell.dataset.i, 10);
    const val = state.board[i];
    const isWin = wl.includes(i);

    // Classes
    cell.className = 'cell';
    if (val) cell.classList.add('filled');
    if (isWin && val) {
      cell.classList.add('win-cell');
      cell.classList.add(val.toLowerCase());
    }
    if ((!isMyTurn || state.result || state.aiThinking) && !val) {
      cell.classList.add('disabled');
    }

    // Symbol
    cell.innerHTML = val
      ? `<span class="cell-symbol ${val.toLowerCase()}">${val}</span>`
      : '';
  });

  // Active player glow
  const tagX = $('tag-x');
  const tagO = $('tag-o');
  tagX.classList.toggle('active', currentMark === 'X' && !state.result);
  tagO.classList.toggle('active', currentMark === 'O' && !state.result);
}

function renderResultBanner() {
  const banner = $('result-banner');
  if (!state.result) {
    banner.classList.add('hidden');
    banner.className = 'result-banner hidden';
    return;
  }
  banner.classList.remove('hidden');
  banner.className = 'result-banner';

  if (state.result === 'D') {
    banner.classList.add('draw');
    $('result-text').textContent = 'DRAW!';
    $('result-sub').textContent = 'well played';
  } else {
    const cls = state.result === 'X' ? 'x-wins' : 'o-wins';
    banner.classList.add(cls);
    $('result-text').textContent = state.playerNames[state.result] + ' WINS!';
    $('result-sub').textContent = state.result + ' takes the round';
  }
}

function updateTurnIndicator() {
  const winner = calcWinner(state.board);
  if (winner || state.result) { renderTurnText(''); return; }

  const currentMark = state.xIsNext ? 'X' : 'O';
  const isMyTurn = state.mode !== 'pvp-online' ||
                   (state.xIsNext  && state.myMark === 'X') ||
                   (!state.xIsNext && state.myMark === 'O');

  if (state.aiThinking) {
    renderTurnText('🤖 AI is thinking...');
  } else if (state.mode === 'pvp-online' && !isMyTurn) {
    renderTurnText('Waiting for opponent...');
  } else {
    renderTurnText(state.playerNames[currentMark] + "'s turn (" + currentMark + ')');
  }
}

function renderTurnText(txt) {
  $('turn-text').textContent = txt;
}

function renderLeaveBtn() {
  $('btn-leave').textContent = state.mode === 'pvp-online' ? 'Leave' : 'Menu';
}

// ═══════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════

// Home
$('btn-pvp-offline').addEventListener('click', () => startOffline('pvp-offline'));
$('btn-pva').addEventListener('click',         () => startOffline('pva'));
$('btn-go-online').addEventListener('click',   () => showScreen('lobby'));

// Lobby
$('btn-create-room').addEventListener('click', createRoom);
$('btn-join-room').addEventListener('click',   joinRoom);
$('btn-lobby-back').addEventListener('click',  () => showScreen('home'));
$('input-room-code').addEventListener('keydown', e => {
  if (e.key === 'Enter') joinRoom();
});

// Waiting
$('btn-cancel-room').addEventListener('click', () => {
  if (channel) { channel.close(); channel = null; }
  state.mode = null;
  state.roomId = '';
  showScreen('home');
});

// Game board cells
document.querySelectorAll('.cell').forEach(cell => {
  cell.addEventListener('click', () => {
    handleCellClick(parseInt(cell.dataset.i, 10));
  });
});

// Game actions
$('btn-restart').addEventListener('click', restart);
$('btn-leave').addEventListener('click',   leaveGame);

// ═══════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════
showScreen('home');
