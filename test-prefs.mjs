// Run js.wasm under node's WASI to validate the feature-pref toggles against
// the actual playground artifact. Usage: node test-prefs.mjs
import { WASI } from 'node:wasi';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const wasmBytes = readFileSync(new URL('./js.wasm', import.meta.url));
const wasmModule = await WebAssembly.compile(wasmBytes);

async function run(source, prefs) {
  const dir = mkdtempSync(join(tmpdir(), 'jswasi-'));
  writeFileSync(join(dir, 'input.js'), source);
  const prefArgs = [];
  for (const p of prefs) prefArgs.push('--setpref', p);
  const wasi = new WASI({
    version: 'preview1',
    args: ['js.wasm', ...prefArgs, '-f', '/input.js'],
    preopens: { '/': dir },
    returnOnExit: true,
  });
  const instance = await WebAssembly.instantiate(wasmModule, wasi.getImportObject());
  // stdout/stderr are inherited, so print() output and any assertEq failure
  // appear directly in the console. The exit code tells us pass/fail.
  const code = wasi.start(instance);
  return { code };
}

const cases = [
  {
    name: 'slots allow objects (default)',
    prefs: ['experimental.user_primitives_slots_allow_objects=true'],
    source: `let B = new Primitive({ constructor(p,v){ Primitive.setSlot(p,"v",v); } });
      assertEq(B({a:1}).v.a, 1); print("PASS slots-allow-objects-true");`,
  },
  {
    name: 'slots reject objects',
    prefs: ['experimental.user_primitives_slots_allow_objects=false'],
    source: `let B = new Primitive({ constructor(p,v){ Primitive.setSlot(p,"v",v); } });
      let threw=false; try { B({a:1}); } catch(e){ threw = e instanceof TypeError; }
      assertEq(threw, true); assertEq(B(42).v, 42); print("PASS slots-reject-objects");`,
  },
  {
    name: 'operators require both (default off)',
    prefs: ['experimental.user_primitives_operators_require_both=false'],
    source: `let V = new Primitive({ constructor(p,x){Primitive.setSlot(p,"x",x);},
        mul(a,b){return V(a.x*(typeof b==="number"?b:b.x));}, rmul(a,b){return V(b.x*a);} });
      assertEq((V(3)*4).x, 12); assertEq((4*V(3)).x, 12); print("PASS require-both-off");`,
  },
  {
    name: 'operators require both (on)',
    prefs: ['experimental.user_primitives_operators_require_both=true'],
    source: `let V = new Primitive({ constructor(p,x){Primitive.setSlot(p,"x",x);},
        mul(a,b){return V(a.x*(typeof b==="number"?b:b.x));}, rmul(a,b){return V(b.x*a);} });
      assertEq((V(3)*V(4)).x, 12);
      let threw=false; try { V(3)*4; } catch(e){ threw = e instanceof TypeError; }
      assertEq(threw, true); print("PASS require-both-on");`,
  },
  {
    name: 'operators require scope (off): always dispatch',
    prefs: ['experimental.user_primitives_operators_require_scope=false'],
    source: `let V = new Primitive({ constructor(p,x){Primitive.setSlot(p,"x",x);}, add(a,b){return V(a.x+b.x);} });
      assertEq((V(2)+V(3)).x, 5); print("PASS require-scope-off");`,
  },
  {
    name: 'operators require scope (on): gated by with-operators',
    prefs: ['experimental.user_primitives_operators_require_scope=true'],
    source: `let V = new Primitive({ constructor(p,x){Primitive.setSlot(p,"x",x);}, add(a,b){return V(a.x+b.x);} });
      let threw=false; try { V(2)+V(3); } catch(e){ threw = e instanceof TypeError; }
      assertEq(threw, true);
      { with operators from V; assertEq((V(2)+V(3)).x, 5); }
      let threw2=false; try { V(2)+V(3); } catch(e){ threw2 = e instanceof TypeError; }
      assertEq(threw2, true);
      print("PASS require-scope-on");`,
  },
  {
    name: 'operators require scope (on): let P = ...; with operators from P',
    prefs: ['experimental.user_primitives_operators_require_scope=true'],
    source: `{
        let P = new Primitive({ constructor(p,x){Primitive.setSlot(p,"x",x);}, add(a,b){return P(a.x+b.x);} });
        with operators from P;
        assertEq((P(4)+P(5)).x, 9);
      }
      print("PASS require-scope-let-ordering");`,
  },
];

let failures = 0;
for (const c of cases) {
  console.log(`\n=== ${c.name} ===  prefs=${c.prefs.join(',')}`);
  const { code } = await run(c.source, c.prefs);
  if (code !== 0) {
    console.log(`  FAIL (exit ${code})`);
    failures++;
  }
}
console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
