// Rebindable keys (client/js/keys.js): swapping, reserved keys, alternates, saving.
const store = {};
globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
const K = await import('../client/js/keys.js');
let fails = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? 'ok ' : 'NOT OK'} - ${msg}`); if (!cond) fails++; };
console.log('KEYS');
ok(K.is('interact', 'KeyE') && K.is('forward', 'KeyW'), 'defaults: E interacts, W walks forward');
ok(K.is('forward', 'ArrowUp') && K.held({ ArrowUp: true }, 'forward'), 'the arrow keys also move');
ok(K.held({ ControlLeft: true }, 'crouch'), 'Ctrl also crouches');
const swapped = K.rebind('interact', 'KeyF');
ok(K.binds.interact === 'KeyF' && K.binds.torch === 'KeyE' && swapped === 'torch', 'binding a used key swaps the two actions');
ok(JSON.parse(store['lastbell.binds']).interact === 'KeyF', 'bindings are saved');
ok(K.rebind('torch', 'Escape') === null && K.binds.torch === 'KeyE', 'Esc cannot be bound (it pauses)');
ok(K.rebind('drop', 'Digit2') === null, 'the slot keys 1 to 4 cannot be bound');
K.rebind('sprint', 'ArrowUp');
ok(!K.is('forward', 'ArrowUp') && K.is('sprint', 'ArrowUp'), 'an alternate key stops working for its action once it is bound to another');
ok(K.keyName('ShiftLeft') === 'Shift' && K.keyName('KeyQ') === 'Q' && K.keyName('Space') === 'Space' && K.keyName('ArrowLeft') === '←', 'key names read like the keyboard');
K.resetBinds();
ok(K.binds.interact === 'KeyE' && K.binds.sprint === 'ShiftLeft' && K.is('forward', 'ArrowUp'), 'reset puts every key back');
store['lastbell.binds'] = JSON.stringify({ torch: 'Escape', drop: 'KeyH' });
K.loadBinds();
ok(K.binds.torch === 'KeyF' && K.binds.drop === 'KeyH', 'a saved reserved key is ignored on load; others are kept');
if (fails) { console.log(`\n${fails} KEY TEST(S) FAILED`); process.exit(1); }
console.log('\nALL KEY TESTS PASSED');
