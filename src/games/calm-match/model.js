export const COLS = 5;
export const ROWS = 6;
export const TARGET = 90;
export const SAVE_KEY = 'softie:calm-match:v1';
const color = () => Math.floor(Math.random() * 4);
export const adjacent = (a, b) => a !== b && Math.abs(a % COLS - b % COLS) <= 1
  && Math.abs(Math.floor(a / COLS) - Math.floor(b / COLS)) <= 1;

export function findMove(board) {
  for (let a = 0; a < board.length; a++) {
    for (let b = 0; b < board.length; b++) {
      if (!adjacent(a, b) || board[a] !== board[b]) continue;
      for (let c = 0; c < board.length; c++) {
        if (c !== a && adjacent(b, c) && board[c] === board[a]) return [a, b, c];
      }
    }
  }
  return [];
}

export function ensureMove(board) {
  if (findMove(board).length) return false;
  // A bounded fallback guarantees playability without an endless shuffle loop.
  for (let i = board.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [board[i], board[j]] = [board[j], board[i]];
  }
  if (!findMove(board).length) board[1] = board[2] = board[0];
  return true;
}

export function newGame() {
  const state = { version: 1, board: Array.from({ length: COLS * ROWS }, color), cleared: 0, moves: 0, best: 0 };
  ensureMove(state.board);
  return state;
}

export function validSave(state) {
  return state?.version === 1 && Array.isArray(state.board) && state.board.length === COLS * ROWS
    && state.board.every(c => Number.isInteger(c) && c >= 0 && c < 4)
    && ['cleared', 'moves', 'best'].every(k => Number.isSafeInteger(state[k]) && state[k] >= 0)
    && state.cleared <= TARGET && state.best <= COLS * ROWS;
}

export function extendPath(board, path, index) {
  if (!Number.isInteger(index) || index < 0 || index >= board.length) return path;
  if (!path.length) return [index];
  if (index === path.at(-2)) return path.slice(0, -1);
  if (path.includes(index) || board[index] !== board[path[0]] || !adjacent(path.at(-1), index)) return path;
  return [...path, index];
}

export function clearPath(state, path) {
  if (state.cleared >= TARGET || path.length < 3 || new Set(path).size !== path.length
    || path.some((i, n) => !Number.isInteger(i) || i < 0 || i >= state.board.length
      || state.board[i] !== state.board[path[0]] || (n && !adjacent(path[n - 1], i)))) return null;
  const removed = new Set(path);
  const board = [...state.board];
  const falls = [];
  for (let col = 0; col < COLS; col++) {
    const survivors = [];
    for (let row = ROWS - 1; row >= 0; row--) {
      const i = row * COLS + col;
      if (!removed.has(i)) survivors.push({ value: board[i], row });
    }
    for (let row = ROWS - 1; row >= 0; row--) {
      const source = survivors[ROWS - 1 - row];
      const i = row * COLS + col;
      board[i] = source ? source.value : color();
      falls[i] = source ? row - source.row : row + 1;
    }
  }
  const shuffled = ensureMove(board);
  return { state: { ...state, board, cleared: Math.min(TARGET, state.cleared + path.length), moves: state.moves + 1, best: Math.max(state.best, path.length) }, falls, shuffled };
}
