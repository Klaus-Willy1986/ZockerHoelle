// Benutzung: node tools/passwort.mjs "mein passwort"   (Groß/Kleinschreibung egal)
// Trägt den Schutz in gate.js ein. Leeres Passwort ("") schaltet ihn aus.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const pw = (process.argv[2] ?? '').trim().toLowerCase();
const f = new URL('../gate.js', import.meta.url);
const h = pw ? createHash('sha256').update('zockerhoelle-v1' + pw).digest('hex') : '';
writeFileSync(f, readFileSync(f, 'utf8').replace(/var GATE_HASH = '[0-9a-f]*';/, `var GATE_HASH = '${h}';`));
console.log(pw ? 'Passwortschutz AN.' : 'Passwortschutz AUS.');
