import './style.css';
import './games/calm-match/style.css';
import { mountGame, jelly } from './games/calm-match/view.js';

const home = document.querySelector('.playground');
const game = document.createElement('main');
game.className = 'calm-game';
game.hidden = true;
document.body.append(game);
const entry = document.createElement('a');
entry.href = '/games/calm-match';
entry.className = 'calm-entry';
entry.innerHTML = '<span>消消气</span><small>玩一局，准点下班 ↗</small>';
document.querySelector('.settings-heading').after(entry);
const overlay = document.createElement('div');
overlay.className = 'calm-transition';
overlay.hidden = true;
overlay.innerHTML = `<div class="transition-jellies">${[0, 1, 2, 3].map(c => jelly(c)).join('')}</div><p>消消怨气，准点下班。</p>`;
document.body.append(overlay);
let homeModule;
let disposeGame = () => {};
let navigation = 0;
let timer;

function route() {
  navigation++;
  clearTimeout(timer);
  overlay.hidden = true;
  disposeGame();
  disposeGame = () => {};
  const isGame = location.pathname.replace(/\/$/, '') === '/games/calm-match';
  home.hidden = isGame;
  game.hidden = !isGame;
  document.body.classList.toggle('playing-calm', isGame);
  document.dispatchEvent(new Event('softie-route'));
  if (isGame) {
    document.querySelector('#loading').hidden = true;
    document.title = '消消气 · softie';
    disposeGame = mountGame(game);
  } else {
    document.title = 'softie · 软乎乎。';
    if (!homeModule) document.querySelector('#loading').hidden = false;
    homeModule ??= import('./main.js');
  }
}
document.addEventListener('click', event => {
  const link = event.target.closest('a');
  if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const url = new URL(link.href);
  if (url.origin !== location.origin || !['/', '/games/calm-match'].includes(url.pathname)) return;
  event.preventDefault();
  if (!overlay.hidden) return;
  const go = () => { history.pushState({}, '', url.pathname); route(); window.scrollTo(0, 0); };
  let saved = false;
  try { saved = !!localStorage.getItem('softie:calm-match:v1'); } catch { /* Storage is optional. */ }
  if (url.pathname === '/games/calm-match' && !saved && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const token = ++navigation;
    overlay.hidden = false;
    timer = setTimeout(() => { if (token === navigation) go(); }, 1200);
  } else go();
});
window.addEventListener('popstate', route);
route();
