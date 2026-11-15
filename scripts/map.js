// Writes the school floor plan to docs/school-map.svg (open it in any browser, or print it).
//   npm run map               without the hidden room (safe to show other people)
//   npm run map -- --secret   also marks the hidden room
// Nothing in docs/ or scripts/ is served by the game server, so players cannot download it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { floorPlanSVG } from './floorplan.js';
mkdirSync('docs', { recursive: true });
const secret = process.argv.includes('--secret');
writeFileSync('docs/school-map.svg', floorPlanSVG({ cell: 22, legend: true, secret }));
console.log('wrote docs/school-map.svg' + (secret ? ' (with the hidden room)' : ''));
