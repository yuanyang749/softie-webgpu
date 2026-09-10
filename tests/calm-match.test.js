import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, validSave, adjacent, findMove, extendPath, clearPath, TARGET } from '../src/games/calm-match/model.js';

test('fresh boards have thirty valid pieces and a legal three-piece move', () => {
  for (let i = 0; i < 100; i++) {
    const state = newGame();
    assert.ok(validSave(state));
    assert.equal(findMove(state.board).length, 3);
  }
});
test('paths allow diagonals and undo, but not skips, repeats or mixed colors', () => {
  const board = Array(30).fill(0); board[2] = 1;
  assert.equal(adjacent(4, 5), false);
  assert.deepEqual(extendPath(board, [0], 6), [0, 6]);
  assert.deepEqual(extendPath(board, [0, 6], 0), [0]);
  assert.deepEqual(extendPath(board, [0, 1, 6], 0), [0, 1, 6]);
  assert.deepEqual(extendPath(board, [0, 1], 2), [0, 1]);
  assert.deepEqual(extendPath(board, [0], 29), [0]);
});
test('removal preserves column order, updates progress and rejects illegal paths', () => {
  const state = newGame(); state.board[0] = state.board[5] = state.board[10] = 0;
  const survivors = [state.board[15], state.board[20], state.board[25]];
  assert.equal(clearPath(state, [0, 5]), null);
  assert.equal(clearPath(state, [0, 5, 0]), null);
  const result = clearPath(state, [0, 5, 10]);
  assert.deepEqual([result.state.board[15], result.state.board[20], result.state.board[25]], survivors);
  assert.equal(result.state.cleared, 3);
  assert.equal(result.state.moves, 1);
  assert.ok(findMove(result.state.board).length);
  assert.equal(state.cleared, 0);
});
test('completion caps at goal and saved data is validated', () => {
  const state = newGame(); state.cleared = TARGET - 1;
  const result = clearPath(state, findMove(state.board));
  assert.equal(result.state.cleared, TARGET);
  assert.equal(clearPath(result.state, findMove(result.state.board)), null);
  assert.equal(validSave({ ...state, board: ['<script>'] }), false);
  assert.equal(validSave({ ...state, cleared: -1 }), false);
  assert.equal(validSave(null), false);
});
