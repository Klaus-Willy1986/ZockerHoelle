// Anonyme Nutzungszahlen (ohne Cookies, ohne Namen, ohne Spielinhalte) über GoatCounter.
// Gezählt werden nur: Seitenaufrufe sowie die Ereignisse "Raum eröffnet", "Spiel gestartet", "Spiel beendet".
// Abgeschaltet, solange config.js keinen Konto-Namen enthält, sowie im Testmodus, auf localhost
// und wenn der Browser "Do Not Track" meldet.
import { STATS_CODE } from './config.js';

const enabled = () => !!STATS_CODE
  && !/^(localhost|127\.|\[::1\])/.test(location.hostname)
  && !new URLSearchParams(location.search).has('mock')
  && navigator.doNotTrack !== '1';

let state = 'idle'; // idle | loading | ready
const queue = [];

function flush() {
  while (queue.length && window.goatcounter && window.goatcounter.count) window.goatcounter.count(queue.shift());
}

export function init() {
  if (!enabled() || state !== 'idle') return;
  state = 'loading';
  const s = document.createElement('script');
  s.async = true;
  s.dataset.goatcounter = `https://${STATS_CODE}.goatcounter.com/count`;
  s.src = 'https://gc.zgo.at/count.js';
  s.onload = () => { state = 'ready'; flush(); };
  s.onerror = () => { queue.length = 0; };
  document.head.appendChild(s);
}

// name z. B. "gestartet/pasch"
export function track(name) {
  if (!enabled()) return;
  init();
  queue.push({ path: `ereignis/${name}`, title: name, event: true });
  if (state === 'ready') flush();
}

export const statsEnabled = () => !!STATS_CODE;
