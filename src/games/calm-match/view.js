import { COLS, ROWS, TARGET, SAVE_KEY, newGame, validSave, ensureMove, findMove, extendPath, clearPath } from './model.js';
import { sound } from '../../sound.js';

const names = ['草莓', '薄荷', '葡萄', '奶油'];
const marks = ['●', '◆', '✦', '♥'];
// Reuse Softie's authored silhouette, with lightweight CSS shading for 30 pieces.
export function jelly(color) {
  return `<span class="mini-jelly jelly-${color}" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M24 5c-5.9 0-6.3 7.2-10.3 9.8C7.6 18.7 5 24.2 5 30.3 5 38.8 12.6 43 24 43s19-4.2 19-12.7c0-6.1-2.6-11.6-8.7-15.5C30.3 12.2 29.9 5 24 5Z" fill="currentColor"/><ellipse cx="16" cy="19" rx="3" ry="5" fill="white" opacity=".55" transform="rotate(30 16 19)"/><circle cx="17.2" cy="28" r="2" fill="#332a30"/><circle cx="30.8" cy="28" r="2" fill="#332a30"/><path d="M21.2 32q2.8 3 5.6 0" fill="none" stroke="#332a30" stroke-width="1.6" stroke-linecap="round"/></svg><i>${marks[color]}</i></span>`;
}

export function mountGame(root) {
  let state = newGame();
  let restored = false;
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (validSave(saved)) { state = saved; ensureMove(state.board); restored = true; }
  } catch { /* Corrupt or unavailable storage starts a fresh board. */ }
  let path = [], pointer = null, busy = false, disposed = false, focus = 0;
  let jellyBoard = null, finger = null;
  const timers = new Set();
  const events = new AbortController();
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (!disposed) fn(); }, ms); timers.add(id); };
  const listen = (el, type, fn) => el.addEventListener(type, fn, { signal: events.signal });
  const save = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* Play still works without storage. */ } };
  root.innerHTML = `
    <header class="game-header"><a href="/" class="game-brand">softie<span> / 消消气</span></a><a href="/" class="game-back">返回软乎乎 ↗</a></header>
    <div class="game-layout">
      <section class="game-story"><p class="game-eyebrow">SOFTIE PLAYROOM · 01</p><h1>今天的气，<br>消掉就好。</h1><p class="game-intro">把同色的小情绪连起来，<br>给自己一个准点下班的理由。</p><div class="game-companion">${jelly(0)}</div><p class="companion-quote">“不着急，我陪你慢慢消。”</p></section>
      <section class="game-center" aria-label="消消气棋盘">
        <div class="game-board-heading"><span>消消气 <small>CALM MATCH</small></span><span class="game-mode">不限时 · 连 3 消除</span></div>
        <div class="match-board-wrap"><div class="match-board" role="group" aria-label="五列六行棋盘；拖动连接同色，或方向键移动、空格选择、回车消除"></div><svg class="match-thread" viewBox="0 0 500 600" preserveAspectRatio="none" aria-hidden="true"><polyline /></svg></div>
        <p class="game-message" role="status" aria-live="polite"></p>
        <p class="game-help">同色连起来 · 斜着也可以 · 松手噗叽消除</p>
      </section>
      <aside class="game-sidebar"><p class="game-eyebrow">下班倒计气</p><div class="game-rage"><strong></strong><span>怨气值</span></div><progress max="90" value="90" aria-label="剩余怨气"></progress><p class="game-goal">消除 90 只软乎乎，清空今日怨气。</p><dl class="game-stats"><div><dt>已消除</dt><dd class="stat-cleared"></dd></div><div><dt>最长连线</dt><dd class="stat-best"></dd></div><div><dt>消除次数</dt><dd class="stat-moves"></dd></div></dl><div class="game-tools"><button class="game-hint">给点提示</button><button class="game-sound"></button><button class="game-restart">重新开始</button></div><p class="game-save-note">进度自动保存，随时回来。</p></aside>
    </div>
    <dialog class="game-win"><div>${jelly(0)}</div><p class="game-eyebrow">OFF DUTY. ON CLOUD NINE.</p><h2>怨气清空，下班！</h2><p class="win-detail"></p><button class="game-again">再消一局</button><a href="/">回去揉揉软乎乎 ↗</a></dialog>
    <dialog class="game-confirm"><h2>重新开始这一局？</h2><p>当前消除进度会重置。</p><button class="confirm-reset">重新开始</button><button class="cancel-reset">继续玩</button></dialog>`;
  const $ = s => root.querySelector(s);
  const board = $('.match-board'), line = $('.match-thread polyline'), win = $('.game-win');
  const message = text => { $('.game-message').textContent = text; };
  import('./jelly-board.js').then(async ({ createJellyBoard }) => {
    if (disposed) return;
    const scene = await createJellyBoard(board, state.board);
    if (disposed) { scene.dispose(); return; }
    jellyBoard = scene;
    scene.sync(state.board);
    scene.select(path, finger);
  }).catch(error => {
    if (!disposed) message('果冻画质暂未启动，已保留轻量棋盘，可继续玩。');
    console.warn('[calm-match] jelly renderer:', error);
  });
  function render(falls = []) {
    board.innerHTML = state.board.map((c, i) => `<button class="match-cell" data-cell="${i}" data-color="${c}" tabindex="${i === focus ? 0 : -1}" aria-label="第${Math.floor(i / COLS) + 1}行第${i % COLS + 1}列，${names[c]}" aria-pressed="false" style="--fall:${falls[i] || 0}">${jelly(c)}</button>`).join('');
    jellyBoard?.sync(state.board, falls);
    if (!jellyBoard && falls.length && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      board.querySelectorAll('.match-cell').forEach((cell, i) => {
        if (falls[i]) cell.animate([{ transform: `translateY(-${Math.min(falls[i], ROWS) * 100}%)`, opacity: 0 }, { transform: 'translateY(5%)', opacity: 1, offset: .8 }, { transform: 'translateY(0)' }], { duration: 380, easing: 'ease-out' });
      });
    }
    $('.game-rage strong').textContent = `${Math.ceil((TARGET - state.cleared) / TARGET * 100)}%`;
    $('progress').value = TARGET - state.cleared;
    $('.stat-cleared').textContent = state.cleared;
    $('.stat-best').textContent = state.best;
    $('.stat-moves').textContent = state.moves;
    $('.game-sound').textContent = sound.enabled ? '音效：开' : '音效：关';
    if (state.cleared === TARGET) {
      $('.win-detail').textContent = `用了 ${state.moves} 次消除，最长连起 ${state.best} 只。今天辛苦啦。`;
      if (!win.open) win.showModal();
    }
  }
  function highlight() {
    jellyBoard?.select(path, finger);
    line.classList.remove('hint-path');
    root.classList.toggle('game-linking', path.length >= 3);
    board.querySelectorAll('.match-cell').forEach((cell, i) => { cell.classList.toggle('selected', path.includes(i)); cell.setAttribute('aria-pressed', String(path.includes(i))); cell.classList.remove('hinted'); });
    line.setAttribute('points', path.map(i => `${i % COLS * 100 + 50},${Math.floor(i / COLS) * 100 + 50}`).join(' '));
    if (path.length) message(path.length < 3 ? `连起 ${path.length} 只，再找一只同色的。` : `连起 ${path.length} 只 · 松手消消气！`);
  }
  function select(index) {
    const next = extendPath(state.board, path, index);
    if (next !== path) { path = next; highlight(); sound.playStretch(Math.min(path.length / 15, 1)); }
  }
  function cancel() {
    const id = pointer;
    pointer = null;
    if (id !== null && board.hasPointerCapture(id)) board.releasePointerCapture(id);
    path = []; highlight();
  }
  function commit() {
    const result = clearPath(state, path);
    if (!result) { cancel(); message('连起至少 3 只同色软乎乎，试试看。'); return; }
    const count = path.length;
    busy = true;
    const keyboard = board.contains(document.activeElement);
    if (jellyBoard) jellyBoard.pop(path);
    else for (const i of path) board.children[i].classList.add('popping');
    line.setAttribute('points', '');
    state = result.state; save();
    sound.playSquish();
    later(() => {
      path = []; root.classList.remove('game-linking'); render(result.falls);
      if (keyboard && !win.open) board.children[focus].focus({ preventScroll: true });
      message(result.shuffled ? '帮你重新拌了拌，又有同色伙伴啦。' : `噗叽！消掉 ${count} 点怨气。`);
      later(() => { busy = false; }, jellyBoard ? 800 : 380);
    }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : jellyBoard ? 640 : 180);
  }
  function cellAt(x, y) {
    const cell = document.elementFromPoint(x, y)?.closest('[data-cell]');
    return cell && board.contains(cell) ? Number(cell.dataset.cell) : -1;
  }
  listen(board, 'pointerdown', e => {
    if (busy || pointer !== null || state.cleared === TARGET || e.button !== 0) return;
    const i = cellAt(e.clientX, e.clientY);
    if (i < 0) return;
    e.preventDefault(); sound.resume(); path = []; pointer = e.pointerId;
    finger = { x: e.clientX, y: e.clientY };
    board.setPointerCapture(pointer); select(i);
  });
  listen(board, 'pointermove', e => {
    if (e.pointerId !== pointer) return;
    e.preventDefault();
    finger = { x: e.clientX, y: e.clientY };
    jellyBoard?.select(path, finger);
    for (const point of e.getCoalescedEvents?.() || [e]) select(cellAt(point.clientX, point.clientY));
    select(cellAt(e.clientX, e.clientY));
  });
  listen(board, 'pointerup', e => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    if (board.hasPointerCapture(e.pointerId)) board.releasePointerCapture(e.pointerId);
    commit();
  });
  for (const type of ['pointercancel', 'lostpointercapture']) listen(board, type, e => { if (e.pointerId === pointer) cancel(); });
  listen(window, 'blur', () => { if (pointer !== null || path.length) cancel(); });
  listen(document, 'visibilitychange', () => { if (document.hidden && (pointer !== null || path.length)) cancel(); });
  listen(board, 'keydown', e => {
    if (busy || pointer !== null || state.cleared === TARGET) return;
    const deltas = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLS, ArrowDown: COLS };
    if (e.key in deltas) { e.preventDefault(); focus = Math.max(0, Math.min(29, focus + deltas[e.key])); board.querySelectorAll('button').forEach((b, i) => b.tabIndex = i === focus ? 0 : -1); board.children[focus].focus(); }
    else if (e.code === 'Space') { e.preventDefault(); sound.resume(); select(focus); }
    else if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') cancel();
  });
  listen($('.game-hint'), 'click', () => {
    if (busy || pointer !== null) return;
    cancel();
    const hint = findMove(state.board);
    hint.forEach(i => board.children[i].classList.add('hinted'));
    line.classList.add('hint-path');
    line.setAttribute('points', hint.map(i => `${i % COLS * 100 + 50},${Math.floor(i / COLS) * 100 + 50}`).join(' '));
    message('沿金色虚线，连起光圈中的 3 只软乎乎。');
  });
  listen($('.game-sound'), 'click', () => { sound.toggle(); $('.game-sound').textContent = sound.enabled ? '音效：开' : '音效：关'; });
  function reset() { if (busy) return; cancel(); state = newGame(); save(); win.close(); $('.game-confirm').close(); render(); message('新的一局，慢慢来。'); }
  listen($('.game-restart'), 'click', () => { if (!busy) { cancel(); $('.game-confirm').showModal(); } });
  listen($('.cancel-reset'), 'click', () => $('.game-confirm').close());
  listen($('.confirm-reset'), 'click', reset);
  listen($('.game-again'), 'click', reset);
  listen(win, 'cancel', e => e.preventDefault());
  render(); save(); message(restored ? '接着上次的进度，慢慢消。' : '从任意一只开始，连起 3 只同色伙伴。');
  return () => { disposed = true; cancel(); save(); timers.forEach(clearTimeout); events.abort(); jellyBoard?.dispose(); root.replaceChildren(); };
}
