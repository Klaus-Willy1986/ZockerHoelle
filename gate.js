// Einfacher Passwortschutz (Türsteher) für die ganze Seite.
// GATE_HASH leer = kein Passwort. Passwort setzen: node tools/passwort.mjs "dein Passwort"
// Hinweis: Das hält Neugierige fern, ist aber kein Banktresor (Quelltext ist technisch abrufbar).
(function () {
  var GATE_HASH = '';
  var SALT = 'zockerhoelle-v1';
  if (!GATE_HASH) return;
  var KEY = 'zh.gate';
  try { if (localStorage.getItem(KEY) === GATE_HASH) return; } catch (e) {}
  var st = document.createElement('style');
  st.textContent = 'html.zh-locked body>*:not(#zh-gate){display:none!important}' +
    '#zh-gate{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#10131c;color:#fff;font-family:system-ui,sans-serif;padding:1rem;z-index:99999}' +
    '#zh-gate form{max-width:22rem;width:100%;text-align:center}' +
    '#zh-gate h1{font-size:1.8rem;margin:0 0 1rem}' +
    '#zh-gate input,#zh-gate button{font-size:1.4rem;min-height:56px;width:100%;box-sizing:border-box;border-radius:12px;border:2px solid #fff;padding:.5rem 1rem;margin:.4rem 0}' +
    '#zh-gate button{background:#ffd23f;color:#000;font-weight:700;border-color:#ffd23f;cursor:pointer}' +
    '#zh-gate p{color:#ffb4b4;min-height:1.5em;font-size:1.2rem}';
  document.head.appendChild(st);
  document.documentElement.classList.add('zh-locked');
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function build() {
    var d = document.createElement('div'); d.id = 'zh-gate';
    d.innerHTML = '<form><h1>🎲 Bitte Passwort eingeben</h1><input type="password" id="zh-pw" autocomplete="current-password" aria-label="Passwort"><button type="submit">Weiter</button><p id="zh-msg" role="alert"></p></form>';
    document.body.appendChild(d);
    var pw = d.querySelector('#zh-pw'); pw.focus();
    d.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = pw.value.trim();
      crypto.subtle.digest('SHA-256', new TextEncoder().encode(SALT + v.toLowerCase())).then(function (b) {
        if (hex(b) === GATE_HASH) {
          try { localStorage.setItem(KEY, GATE_HASH); } catch (x) {}
          document.documentElement.classList.remove('zh-locked'); d.remove();
        } else { d.querySelector('#zh-msg').textContent = 'Das stimmt leider nicht. Bitte nochmal versuchen.'; pw.select(); }
      });
    });
  }
  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
