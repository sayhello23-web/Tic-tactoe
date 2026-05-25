/* ═══════════════════════════════════════════════
   TIC TAC TOE — MULTIPLAYER ARENA
   game.js  — cross-tab online via localStorage
   ═══════════════════════════════════════════════ */

'use strict';

// ── Win combinations ───────────────────────────
const LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6]
];

function calcWinner(sq) {
  for (const [a,b,c] of LINES)
    if (sq[a] && sq[a]===sq[b] && sq[a]===sq[c]) return sq[a];
  return null;
}
function winLine(sq) {
  for (const ln of LINES) {
    const [a,b,c]=ln;
    if (sq[a] && sq[a]===sq[b] && sq[a]===sq[c]) return ln;
  }
  return null;
}

// ── AI minimax ─────────────────────────────────
function minimax(board, isMax, depth) {
  depth = depth||0;
  const w = calcWinner(board);
  if (w==='O') return 10-depth;
  if (w==='X') return depth-10;
  if (board.every(Boolean)) return 0;
  let best = isMax ? -Infinity : Infinity;
  for (let i=0;i<9;i++) {
    if (!board[i]) {
      board[i] = isMax?'O':'X';
      const v = minimax(board,!isMax,depth+1);
      board[i] = null;
      best = isMax ? Math.max(best,v) : Math.min(best,v);
    }
  }
  return best;
}
function bestMove(board) {
  let best=-Infinity, move=-1;
  for (let i=0;i<9;i++) {
    if (!board[i]) {
      board[i]='O';
      const v=minimax(board,false,0);
      board[i]=null;
      if (v>best){best=v;move=i;}
    }
  }
  return move;
}

function makeRoomId() {
  return Math.random().toString(36).slice(2,7).toUpperCase();
}

// ═══════════════════════════════════════════════
// CROSS-TAB MESSAGING via localStorage
// BroadcastChannel only works same-tab; localStorage
// storage events fire in ALL other tabs of the same origin.
// ═══════════════════════════════════════════════
const MSG_KEY_PREFIX = 'ttt_msg_';

function lsSend(roomId, data) {
  // Writing a unique key triggers the storage event in other tabs
  const key = MSG_KEY_PREFIX + roomId;
  const payload = JSON.stringify({ ...data, _ts: Date.now() });
  try {
    localStorage.setItem(key, payload);
  } catch(e) { console.warn('localStorage unavailable', e); }
}

function lsCleanup(roomId) {
  try { localStorage.removeItem(MSG_KEY_PREFIX + roomId); } catch(e){}
}

// The storage event only fires in OTHER tabs (not the sender).
// So this listener is only for receiving messages from the opponent.
function onStorageEvent(e) {
  if (!state.roomId) return;
  if (e.key !== MSG_KEY_PREFIX + state.roomId) return;
  if (!e.newValue) return;
  try {
    const data = JSON.parse(e.newValue);
    handleOnlineMsg(data);
  } catch(err) { console.warn('msg parse error', err); }
}
window.addEventListener('storage', onStorageEvent);

// ── Convenience wrapper ────────────────────────
function send(data) {
  if (state.mode === 'pvp-online' && state.roomId) {
    lsSend(state.roomId, data);
  }
}

// ═══════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════
const state = {
  screen: 'home',
  mode: null,           // pvp-offline | pva | pvp-online
  board: Array(9).fill(null),
  xIsNext: true,
  scores: { X:0, O:0, D:0 },
  result: null,
  myMark: 'X',
  roomId: '',
  playerName: '',
  playerNames: { X:'Player 1', O:'Player 2' },
  opponentConnected: false,
  aiThinking: false,
  iAmHost: false,
};

let notifTimer = null;
let aiTimer    = null;

// ═══════════════════════════════════════════════
// DOM
// ═══════════════════════════════════════════════
const $ = id => document.getElementById(id);
const screens = {
  home:    $('screen-home'),
  lobby:   $('screen-lobby'),
  waiting: $('screen-waiting'),
  game:    $('screen-game'),
};

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
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  clearTimeout(notifTimer);
  notifTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

// ═══════════════════════════════════════════════
// ONLINE MESSAGE HANDLER
// ═══════════════════════════════════════════════
function handleOnlineMsg(data) {
  switch (data.type) {

    // Joiner → Host: "I joined"
    case 'joined':
      if (!state.iAmHost) return;           // ignore if we're not the host
      state.opponentConnected = true;
      state.playerNames[data.mark] = data.name;
      // Host → Joiner: full sync
      send({
        type: 'sync',
        hostName: state.playerNames['X'],
        board: state.board,
        xIsNext: state.xIsNext,
        scores: state.scores,
      });
      showScreen('game');
      renderGame();
      showNotif(data.name + ' joined! Game starting…');
      break;

    // Host → Joiner: full state sync
    case 'sync':
      if (state.iAmHost) return;            // host doesn't process its own sync
      state.playerNames['X']  = data.hostName;
      state.board             = data.board;
      state.xIsNext           = data.xIsNext;
      state.scores            = data.scores;
      state.opponentConnected = true;
      renderGame();
      showNotif('Connected! Game starting…');
      break;

    // Either side: opponent played a cell
    case 'move':
      state.board   = data.board;
      state.xIsNext = data.xIsNext;
      renderBoard();
      updateTurnIndicator();
      {
        const winner = calcWinner(state.board);
        const full   = state.board.every(Boolean);
        if (winner)    applyResult(winner);
        else if (full) applyResult('D');
      }
      break;

    // Authoritative result+scores from the mover
    case 'result':
      if (state.result) break;             // already applied locally
      state.result = data.result;
      state.scores = data.scores;
      renderScores();
      renderBoard();
      renderResultBanner();
      renderTurnText('');
      break;

    // Restart
    case 'restart':
      state.scores = data.scores;
      resetBoard();
      renderGame();
      break;

    // Opponent left
    case 'leave':
      state.opponentConnected = false;
      showNotif('Opponent left the room.');
      renderRoomInfo();
      renderTurnText('Opponent disconnected.');
      break;
  }
}

// Called on the RECEIVING end when opponent's move finishes the game.
// The mover calls finishGame() which sends 'result'; receiver calls applyResult().
function applyResult(winner) {
  if (state.result) return;
  state.result = winner;
  renderBoard();
  renderResultBanner();
  renderTurnText('');
  // scores will arrive in the 'result' message from the mover
}

// ═══════════════════════════════════════════════
// GAME LOGIC
// ═══════════════════════════════════════════════
function handleCellClick(i) {
  if (state.board[i] || state.result || state.aiThinking) return;

  if (state.mode === 'pvp-online') {
    if (!state.opponentConnected) { showNotif('Waiting for opponent…'); return; }
    const isMyTurn = (state.xIsNext && state.myMark==='X') ||
                     (!state.xIsNext && state.myMark==='O');
    if (!isMyTurn) return;
  }

  const mark = state.xIsNext ? 'X' : 'O';
  state.board[i] = mark;
  state.xIsNext  = !state.xIsNext;

  renderBoard();
  updateTurnIndicator();

  const winner = calcWinner(state.board);
  const full   = state.board.every(Boolean);

  if (state.mode === 'pvp-online') {
    // Always send move FIRST (even winning moves)
    send({ type:'move', board:state.board, xIsNext:state.xIsNext });
    if (winner)    finishGame(winner);
    else if (full) finishGame('D');
  } else {
    if (winner)    finishGame(winner);
    else if (full) finishGame('D');
    else if (state.mode==='pva' && !state.xIsNext) scheduleAiMove();
  }
}

function scheduleAiMove() {
  state.aiThinking = true;
  updateTurnIndicator();
  clearTimeout(aiTimer);
  aiTimer = setTimeout(() => {
    if (state.result) return;
    const move = bestMove([...state.board]);
    if (move===-1) return;
    state.board[move] = 'O';
    state.xIsNext = true;
    state.aiThinking = false;
    renderBoard();
    const winner = calcWinner(state.board);
    const full   = state.board.every(Boolean);
    if (winner)    finishGame(winner);
    else if (full) finishGame('D');
    else           updateTurnIndicator();
  }, 550);
}

function finishGame(winner) {
  if (state.result) return;
  state.result = winner;
  state.scores[winner]++;
  renderScores();
  renderBoard();
  renderResultBanner();
  renderTurnText('');
  if (state.mode === 'pvp-online') {
    send({ type:'result', result:winner, scores:state.scores });
  }
}

function resetBoard() {
  clearTimeout(aiTimer);
  state.board      = Array(9).fill(null);
  state.xIsNext    = true;
  state.result     = null;
  state.aiThinking = false;
}

function restart() {
  resetBoard();
  renderGame();
  if (state.mode === 'pvp-online') {
    send({ type:'restart', scores:state.scores });
  }
}

function leaveGame() {
  if (state.mode === 'pvp-online') {
    send({ type:'leave' });
    lsCleanup(state.roomId);
  }
  clearTimeout(aiTimer);
  Object.assign(state, {
    mode: null, roomId:'', iAmHost:false,
    opponentConnected:false,
    board: Array(9).fill(null),
    result: null,
    scores: {X:0,O:0,D:0},
    aiThinking:false,
  });
  showScreen('home');
}

// ═══════════════════════════════════════════════
// START MODES
// ═══════════════════════════════════════════════
function startOffline(mode) {
  state.mode = mode;
  state.playerNames = {
    X: mode==='pva' ? 'You'    : 'Player 1',
    O: mode==='pva' ? 'AI 🤖' : 'Player 2',
  };
  resetBoard();
  renderGame();
  showScreen('game');
}

function goOnline() {
  state.playerName = $('home-name').value.trim();
  showScreen('lobby');
}

function createRoom() {
  const name = state.playerName || 'Player 1';
  const id   = makeRoomId();

  // Clean any stale key first
  lsCleanup(id);

  Object.assign(state, {
    roomId: id,
    myMark: 'X',
    iAmHost: true,
    playerNames: { X:name, O:'Waiting...' },
    opponentConnected: false,
    mode: 'pvp-online',
    scores: {X:0,O:0,D:0},
  });
  resetBoard();

  $('waiting-room-code').textContent = id;
  $('waiting-sub-text').textContent  =
    'Open another tab → Play Online → Join Room → enter: ' + id;
  showScreen('waiting');
  showNotif('Room ' + id + ' created!');
}

function joinRoom() {
  const code = $('input-room-code').value.trim().toUpperCase();
  if (code.length < 4) { showNotif('Enter a valid room code.'); return; }

  const name = state.playerName || 'Player 2';

  Object.assign(state, {
    roomId: code,
    myMark: 'O',
    iAmHost: false,
    playerNames: { X:'Host', O:name },
    opponentConnected: false,
    mode: 'pvp-online',
    scores: {X:0,O:0,D:0},
  });
  resetBoard();

  renderGame();
  showScreen('game');

  // Small delay to let the screen render, then announce to host
  setTimeout(() => {
    send({ type:'joined', mark:'O', name });
  }, 200);
}

// ═══════════════════════════════════════════════
// RENDER
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
      badge.className   = 'badge badge-online';
    } else {
      badge.textContent = 'Waiting...';
      badge.className   = 'badge badge-waiting';
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
  const wl = winLine(state.board) || [];
  const currentMark = state.xIsNext ? 'X' : 'O';
  const isMyTurn = state.mode !== 'pvp-online' ||
    (state.xIsNext  && state.myMark==='X') ||
    (!state.xIsNext && state.myMark==='O');

  document.querySelectorAll('.cell').forEach(cell => {
    const i   = parseInt(cell.dataset.i, 10);
    const val = state.board[i];
    cell.className = 'cell';
    if (val) cell.classList.add('filled');
    if (wl.includes(i) && val) cell.classList.add('win-cell', val.toLowerCase());
    if ((!isMyTurn || state.result || state.aiThinking) && !val)
      cell.classList.add('disabled');
    cell.innerHTML = val
      ? `<span class="cell-symbol ${val.toLowerCase()}">${val}</span>`
      : '';
  });

  $('tag-x').classList.toggle('active', currentMark==='X' && !state.result);
  $('tag-o').classList.toggle('active', currentMark==='O' && !state.result);
}

function renderResultBanner() {
  const banner = $('result-banner');
  if (!state.result) { banner.className='result-banner hidden'; return; }
  banner.className = 'result-banner';
  if (state.result==='D') {
    banner.classList.add('draw');
    $('result-text').textContent = 'DRAW!';
    $('result-sub').textContent  = 'well played';
  } else {
    banner.classList.add(state.result==='X' ? 'x-wins' : 'o-wins');
    $('result-text').textContent = state.playerNames[state.result] + ' WINS!';
    $('result-sub').textContent  = state.result + ' takes the round';
  }
}

function updateTurnIndicator() {
  if (state.result) { renderTurnText(''); return; }
  const currentMark = state.xIsNext ? 'X' : 'O';
  const isMyTurn = state.mode !== 'pvp-online' ||
    (state.xIsNext  && state.myMark==='X') ||
    (!state.xIsNext && state.myMark==='O');

  if (state.aiThinking) {
    renderTurnText('🤖 AI is thinking...');
  } else if (state.mode==='pvp-online' && !state.opponentConnected) {
    renderTurnText('Waiting for opponent to connect...');
  } else if (state.mode==='pvp-online' && !isMyTurn) {
    renderTurnText('Waiting for opponent...');
  } else {
    renderTurnText(state.playerNames[currentMark] + "'s turn (" + currentMark + ')');
  }
}

function renderTurnText(txt) { $('turn-text').textContent = txt; }
function renderLeaveBtn() {
  $('btn-leave').textContent = state.mode==='pvp-online' ? 'Leave' : 'Menu';
}

// ═══════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════
$('btn-pvp-offline').addEventListener('click', () => startOffline('pvp-offline'));
$('btn-pva').addEventListener('click',         () => startOffline('pva'));
$('btn-go-online').addEventListener('click',   goOnline);

$('btn-create-room').addEventListener('click', createRoom);
$('btn-join-room').addEventListener('click',   joinRoom);
$('btn-lobby-back').addEventListener('click',  () => showScreen('home'));
$('input-room-code').addEventListener('keydown', e => { if(e.key==='Enter') joinRoom(); });

$('btn-cancel-room').addEventListener('click', () => {
  lsCleanup(state.roomId);
  Object.assign(state,{mode:null,roomId:'',iAmHost:false});
  showScreen('home');
});

document.querySelectorAll('.cell').forEach(cell => {
  cell.addEventListener('click', () => handleCellClick(parseInt(cell.dataset.i,10)));
});

$('btn-restart').addEventListener('click', restart);
$('btn-leave').addEventListener('click',   leaveGame);

// ═══════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════
showScreen('home');
