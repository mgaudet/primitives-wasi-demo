import * as monaco from 'monaco-editor'
// The Rational demo is kept in its own file and imported here as verbatim text
// (see the `?raw` rule in webpack.config.js).
import rationalSource from './examples/rational-demo.js?raw'

self.MonacoEnvironment = {
    getWorkerUrl: function(moduleId, label) {
        if (label === "javascript") {
            return "js/ts.worker.js";
        }
        return "js/editor.worker.js";
    },
};

function setOutput(stderr, stdout) {
    document.getElementById("error").textContent = stderr;
    document.getElementById("output").textContent = stdout;
}

let worker = null;
let workerLastSource = null;
let workerLastPrefs = null;

let workerIsRunning = false;
let workerKillTimeout = null;

let editor = null;

// Map the feature checkboxes to SpiderMonkey prefs (passed to js.wasm as
// --setpref name=value). The default checkbox states match the prototype's
// default pref values, so an unchanged UI passes prefs equal to the defaults.
function featurePrefs() {
    let slotsObjects = document.getElementById("feat-slots-objects").checked;
    let requireBoth = document.getElementById("feat-require-both").checked;
    let requireScope = document.getElementById("feat-require-scope").checked;
    return [
        "experimental.user_primitives_slots_allow_objects=" + slotsObjects,
        "experimental.user_primitives_operators_require_both=" + requireBoth,
        "experimental.user_primitives_operators_require_scope=" + requireScope,
    ];
}

function executeCode() {
    let source = editor.getValue();
    let prefs = featurePrefs();
    let prefsKey = prefs.join("\n");
    if (workerIsRunning ||
        (source === workerLastSource && prefsKey === workerLastPrefs)) {
        return;
    }
    if (worker === null) {
        worker = new Worker(new URL('./worker.js', import.meta.url));
        worker.onmessage = function(e) {
            if (e.data.status) {
                setOutput("", e.data.status);
            } else {
                clearTimeout(workerKillTimeout);
                workerIsRunning = false;
                setOutput(e.data.stderr, e.data.stdout);
            }
        };
    }

    // The branch selector is currently hidden; default to the first branch.
    let branch = self.branches[0];
    // Resolve against the page so a relative URL (e.g. a local "js.wasm")
    // works regardless of where the worker script lives.
    let wasm_url = new URL(branch.url, location.href).href;

    worker.postMessage({source, wasm_url, prefs});
    workerLastSource = source;
    workerLastPrefs = prefsKey;
    workerIsRunning = true;

    workerKillTimeout = setTimeout(function() {
        if (!workerIsRunning) {
            return;
        }
        setOutput("", "Timed out");
        worker.terminate();
        workerIsRunning = false;
        worker = null;
        executeCode();
    }, 5000);
}

function shareCode() {
    let url = window.location.href.split('?')[0];
    url += "?source=" + encodeURIComponent(editor.getValue());
    url += "&slotsObjects=" + document.getElementById("feat-slots-objects").checked;
    url += "&requireBoth=" + document.getElementById("feat-require-both").checked;
    url += "&requireScope=" + document.getElementById("feat-require-scope").checked;
    navigator.clipboard.writeText(url);
}

const examples = [
    {
        name: "Vec3",
        source: `// User-defined primitives -- a SpiderMonkey prototype (compiled to WASI).
// Read https://www.mgaudet.ca/technical/2025/2/24/user-defined-primitives-a-sketch for some
// motivation.
//
// 'Primitive' works like 'Proxy', but returns a factory that builds
// identity-less primitive values with named slots and overloaded operators.


let Vec3 = new Primitive({
  constructor(p, x, y, z) {
    Primitive.setSlot(p, "x", x);
    Primitive.setSlot(p, "y", y);
    Primitive.setSlot(p, "z", z);
  },
  add(a, b) { return Vec3(a.x + b.x, a.y + b.y, a.z + b.z); },
  sub(a, b) { return Vec3(a.x - b.x, a.y - b.y, a.z - b.z); },
  // '*' scales by a number or does a component-wise product with another Vec3.
  // Dispatch is left-associative: a Vec3 on the left calls 'mul'.
  mul(a, b) {
    return typeof b === "number"
      ? Vec3(a.x * b, a.y * b, a.z * b)
      : Vec3(a.x * b.x, a.y * b.y, a.z * b.z);
  },
  // 'rmul' is the reverse trap (like Python's __rmul__): a Vec3 on the *right*
  // of '*' calls it, so a scalar may sit on either side (2 * v).
  rmul(a, b) { return Vec3(b.x * a, b.y * a, b.z * a); },
});

let a = Vec3(1, 2, 3);
let b = Vec3(1, 2, 3);

print("typeof a    =", typeof a);    // "primitive" -- not an object
print("a === b     =", a === b);     // true -- identity-less, compared slot-wise
print("a.x,a.y,a.z =", a.x, a.y, a.z);

let s = a + Vec3(4, 5, 6);           // operator overloading via the 'add' trap
print("a + (4,5,6) =", s.x, s.y, s.z);

// Scalar scaling works on either side, via the 'mul' and 'rmul' traps:
print("a * 2       =", (a * 2).x, (a * 2).y, (a * 2).z);   // 2 4 6  (mul)
print("10 * a      =", (10 * a).x, (10 * a).y, (10 * a).z); // 10 20 30 (rmul)

// Program with free functions, like an int:
function distance(v1, v2) {
  let d = v2 - v1;
  return Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
}
print("distance    =", distance(Vec3(1, 2, 3), Vec3(100, 100, 0)));
`,
    },
    {
        name: "Records",
        source: `// The Records proposal (https://github.com/tc39/proposal-record-tuple),
// re-implemented as a *library* on top of user-defined primitives -- no \`#{}\`
// syntax. \`Recordify(obj)\` returns an identity-less record primitive.
//
// The trick that makes \`==\` work: a user primitive's equality is "same factory
// + slot-wise equal". So every record with the *same set of keys* must share a
// single factory. A global registry canonicalizes (sorted key set) -> factory.


// Issue: This is leaky because the registry can never drop anything.
var RecordRegistry = new Map();

function recordFactoryFor(names) {
  // \`names\` is the sorted key list; its JSON is the registry key.
  let key = JSON.stringify(names);
  let factory = RecordRegistry.get(key);
  if (factory) return factory;
  factory = new Primitive({
    constructor(p, ...values) {
      for (let i = 0; i < names.length; i++) {
        Primitive.setSlot(p, names[i], values[i]);
      }
    },
  });
  RecordRegistry.set(key, factory);
  return factory;
}

function Recordify(obj) {
  // Records are key-order-independent, so canonicalize by sorting keys.
  let names = Object.keys(obj).sort();
  let factory = recordFactoryFor(names);
  let values = names.map(n => {
    let v = obj[n];
    // Records are deep: recursively recordify nested plain objects. Values that
    // are already primitives (incl. record primitives) pass straight through.
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      return Recordify(v);
    }
    return v;
  });
  return factory(...values);
}

let r = Recordify({ x: 10, y: 10 });
print("r.x =", r.x, "/ r.y =", r.y);           // r.x = 10 / r.y = 10
assertEq(r.x, 10);
assertEq(r.y, 10);
print("typeof r =", typeof r);                 // primitive
assertEq(typeof r, "primitive");

// Two independently-built copies compare equal (== and ===), no .equals().
print("copies == :", Recordify({ x: 10, y: 10 }) == Recordify({ x: 10, y: 10 }));   // true
print("copies ===:", Recordify({ x: 10, y: 10 }) === Recordify({ x: 10, y: 10 }));  // true
assertEq(Recordify({ x: 10, y: 10 }) == Recordify({ x: 10, y: 10 }), true);
assertEq(Recordify({ x: 10, y: 10 }) === Recordify({ x: 10, y: 10 }), true);

// Key order is irrelevant -- both canonicalize to the same factory.
print("key order ===:", Recordify({ x: 1, y: 2 }) === Recordify({ y: 2, x: 1 }));   // true
assertEq(Recordify({ x: 1, y: 2 }) === Recordify({ y: 2, x: 1 }), true);

// Deep: nested objects are recordified, and equality recurses slot-wise.
print("nested ===:", Recordify({ a: Recordify({ n: 1 }) }) === Recordify({ a: { n: 1 } })); // true
assertEq(Recordify({ a: Recordify({ n: 1 }) }) === Recordify({ a: { n: 1 } }), true);
assertEq(Recordify({ a: { n: 1 } }) === Recordify({ a: { n: 2 } }), false);


const ship1 = Recordify({ x: 1, y: 2 }); // a record
const ship2 = { x: -1, y: 3 };           // an ordinary object

function move(start, deltaX, deltaY) {
  // Always return a record after moving.
  return Recordify({ x: start.x + deltaX, y: start.y + deltaY });
}

const ship1Moved = move(ship1, 1, 0);  // record {x:2, y:2}
const ship2Moved = move(ship2, 3, -1); // record {x:2, y:2}

// Same coordinates after moving -> the two records are ===, even though their
// inputs were a record and a plain object respectively.
print("ship1Moved === ship2Moved:", ship1Moved === ship2Moved); // true
assertEq(ship1Moved === ship2Moved, true);
`,
    },
    {
        name: "Records & Tuples",
        source: `// Built-in Records & Tuples via 'Primitive.of'. The engine canonicalizes the
// backing factory per structural shape in a per-Zone *weak* table, so equal
// values are === with no userland registry -- and, unlike the "Records" example
// (a library whose registry can never drop anything), nothing leaks.
//
//   Primitive.of({a, b})  -> a record primitive (named slots)
//   Primitive.of([x, y])  -> a tuple  primitive (indexed slots + length)

// --- Records ---
let r = Primitive.of({ x: 10, y: 20 });
print("typeof r          =", typeof r);          // "primitive"
print("r.x, r.y          =", r.x, r.y);          // 10 20
assertEq(typeof r, "primitive");

// Identity-less: two independently-built records are === (key order ignored).
print("equal records === =", Primitive.of({ x: 1, y: 2 }) === Primitive.of({ y: 2, x: 1 }));
assertEq(Primitive.of({ x: 1, y: 2 }) === Primitive.of({ y: 2, x: 1 }), true);

// Deep: nested plain objects become nested records; equality recurses.
print("nested ===        =", Primitive.of({ a: { n: 1 } }) === Primitive.of({ a: { n: 1 } }));
assertEq(Primitive.of({ a: { n: 1 } }) === Primitive.of({ a: { n: 2 } }), false);

// --- Tuples ---
let t = Primitive.of([10, 20, 30]);
print("t[0], t.length    =", t[0], t.length);    // 10 3
assertEq(t.length, 3);
print("equal tuples ===  =", Primitive.of([1, [2, 3]]) === Primitive.of([1, [2, 3]]));
assertEq(Primitive.of([1, [2, 3]]) === Primitive.of([1, [2, 3]]), true);

// A tuple and a record with the same slot names are different kinds.
print("tuple === record  =", Primitive.of([1, 2]) === Primitive.of({ 0: 1, 1: 2 })); // false
assertEq(Primitive.of([1, 2]) === Primitive.of({ 0: 1, 1: 2 }), false);

// --- Value semantics as Map/Set keys ---
let m = new Map();
m.set(Primitive.of({ x: 1, y: 2 }), "hit");
print("map by value      =", m.get(Primitive.of({ y: 2, x: 1 })));   // "hit"
assertEq(m.get(Primitive.of({ y: 2, x: 1 })), "hit");

let s = new Set([Primitive.of([1, 2]), Primitive.of([1, 2])]);
print("set dedups        =", s.size);            // 1
assertEq(s.size, 1);

print("Records & Tuples passed.");
`,
    },
    {
        name: "Features tour",
        source: `// A tour of user-defined-primitive features beyond plain arithmetic:
// value-keyed Map/Set, instanceof, a toString trap, and the bitwise and
// relational operators. Arithmetic/bitwise operators dispatch left-associatively
// (a primitive on the left calls the forward trap, on the right the reverse 'r'
// trap), so a plain number can sit on either side. Relational operators are
// same-factory-only.

let Vec3 = new Primitive({
  constructor(p, x, y, z) {
    Primitive.setSlot(p, "x", x);
    Primitive.setSlot(p, "y", y);
    Primitive.setSlot(p, "z", z);
  },
  add(a, b) { return Vec3(a.x + b.x, a.y + b.y, a.z + b.z); },
  // A single 'lessThan' trap backs <, <=, >, >= (compare by magnitude here).
  lessThan(a, b) {
    let ma = a.x * a.x + a.y * a.y + a.z * a.z;
    let mb = b.x * b.x + b.y * b.y + b.z * b.z;
    return ma < mb;
  },
  // 'toString' backs ToString (String(), template literals, concatenation).
  toString(v) { return "Vec3(" + v.x + ", " + v.y + ", " + v.z + ")"; },
});

{
  with operators from Vec3;

  let a = Vec3(1, 2, 3);
  let b = Vec3(1, 2, 3);   // distinct construction, equal slots

  // --- Value semantics in Map/Set (keyed by value, not identity) ---
  let m = new Map();
  m.set(a, "hit");
  print("m.get(b)      =", m.get(b));       // "hit" -- b is a different cell but equal
  assertEq(m.get(b), "hit");
  let s = new Set([Vec3(0,0,0), Vec3(0,0,0)]);
  print("set dedups    =", s.size);          // 1
  assertEq(s.size, 1);

  // --- instanceof disambiguates factories ---
  let Vec2 = new Primitive({
    constructor(p, x, y) { Primitive.setSlot(p, "x", x); Primitive.setSlot(p, "y", y); },
  });
  print("a  instanceof Vec3 =", a instanceof Vec3);            // true
  print("a  instanceof Vec2 =", a instanceof Vec2);            // false
  assertEq(a instanceof Vec3, true);
  assertEq(Vec2(1,2) instanceof Vec3, false);

  // --- toString trap ---
  print("String(a)     =", String(a));       // "Vec3(1, 2, 3)"
  print("template       =", \`v=\${a}\`);        // "v=Vec3(1, 2, 3)"
  assertEq(String(a), "Vec3(1, 2, 3)");

  // --- relational operators, all from the one lessThan trap ---
  let big = Vec3(10, 10, 10);
  print("a < big       =", a < big);          // true
  print("big >= a      =", big >= a);         // true
  assertEq(a < big, true);
  assertEq(big > a, true);
  assertEq(a <= Vec3(1, 2, 3), true);
}

{
  let a = Vec3(1, 2, 3);
  let b = Vec3(1, 2, 3);   // distinct construction, equal slots

  try {
    a+b;
  } catch (e) {
    print(e)
  }

}
// --- bitwise operators (per-operator traps), with plain numbers on either side ---
// 'bits()' lets a trap accept either a Flags or a raw number operand; the 'r'
// traps handle the case where the number is on the left (e.g. 1 | READ).
let Flags = new Primitive({
  constructor(p, bits) { Primitive.setSlot(p, "bits", bits | 0); },
  bitOr(a, b)  { return Flags(a.bits | bits(b)); },
  bitAnd(a, b) { return Flags(a.bits & bits(b)); },
  bitXor(a, b) { return Flags(a.bits ^ bits(b)); },
  shiftLeft(a, b)  { return Flags(a.bits << bits(b)); },
  rbitOr(a, b)  { return Flags(bits(a) | b.bits); },
  rbitAnd(a, b) { return Flags(bits(a) & b.bits); },
  rshiftLeft(a, b) { return Flags(bits(a) << b.bits); },
  toString(f) { return "0b" + (f.bits >>> 0).toString(2); },
});

{
  with operators from Flags; 

  function bits(v) { return typeof v === "number" ? v : v.bits; }
  let READ = Flags(1), WRITE = Flags(2), EXEC = Flags(4);
  let rwx = READ | WRITE | EXEC;
  print("rwx           =", rwx);              // 0b111
  print("rwx & WRITE   =", rwx & WRITE);      // 0b10
  print("READ | 4      =", READ | 4);         // 0b101  (number on the right, 'bitOr')
  print("1 << EXEC     =", 1 << EXEC);        // 0b10000 (number on the left, 'rshiftLeft')
  assertEq((rwx & WRITE) === WRITE, true);
  assertEq((READ | 4) === Flags(5), true);
  assertEq((1 << EXEC) === Flags(16), true);

  print("Features tour passed.");
}`,
    },
    {
        name: "Rational",
        source: rationalSource,
    },
    {
        name: "Scoped operators",
        source: `// Lexically-scoped operator overloading (TC39 operator-overloading proposal
// syntax). Turn ON the "operators require lexical scope" checkbox above to see
// it: an overloaded operator then only works where its factory has been
// enabled with a \`with operators from <factory>;\` statement in scope.
//
// With the checkbox OFF, operators always dispatch and \`with operators from\`
// is a harmless no-op -- toggle it to feel the difference.

let Vec = new Primitive({
  constructor(p, x, y) { Primitive.setSlot(p, "x", x); Primitive.setSlot(p, "y", y); },
  add(a, b) { return Vec(a.x + b.x, a.y + b.y); },
  toString(v) { return "Vec(" + v.x + ", " + v.y + ")"; },
});

function tryOp(label, f) {
  try { print(label, "=>", String(f())); }
  catch (e) { print(label, "=> " + e.constructor.name + ":", e.message); }
}

// Not enabled at the top level: with the checkbox ON this throws a TypeError.
tryOp("top-level Vec+Vec", () => Vec(1, 2) + Vec(3, 4));

{
  // Enable operator overloading for Vec for the rest of this block (and any
  // nested blocks / closures defined here). The factory expression is
  // evaluated here, so a freshly-built factory works too.
  with operators from Vec;

  print("in-scope  Vec+Vec =>", String(Vec(1, 2) + Vec(3, 4)));   // Vec(4, 6)

  // A closure defined in the scope keeps the enablement when called later.
  var laterAdd = () => Vec(10, 20) + Vec(1, 1);
}

// Outside the block again: with the checkbox ON this throws.
tryOp("after-block Vec+Vec", () => Vec(1, 2) + Vec(3, 4));

// ...but the closure carries its definition-site enablement.
print("closure laterAdd  =>", String(laterAdd()));               // Vec(11, 21)
`,
    },
];

const defaultExample = "Features tour";
const initSource = examples.find(e => e.name === defaultExample).source;

self.onload = async function() {
    let response = await fetch("data.json");
    let branches = await response.json();
    self.branches = branches;

    let examplesSelect = document.getElementById("examples");
    for (let example of examples) {
        let option = document.createElement("option");
        option.value = example.name;
        option.text = example.name;
        examplesSelect.appendChild(option);
    }
    examplesSelect.value = defaultExample;
    examplesSelect.onchange = function() {
        let example = examples.find(e => e.name === examplesSelect.value);
        if (example) {
            editor.setValue(example.source);
        }
    };

    let params = new URLSearchParams(window.location.search);
    let source = params.has("source") ? decodeURIComponent(params.get("source")) : initSource;

    // Restore feature toggles from a shared URL (default to the checkbox markup).
    if (params.has("slotsObjects")) {
        document.getElementById("feat-slots-objects").checked = params.get("slotsObjects") !== "false";
    }
    if (params.has("requireBoth")) {
        document.getElementById("feat-require-both").checked = params.get("requireBoth") === "true";
    }
    if (params.has("requireScope")) {
        document.getElementById("feat-require-scope").checked = params.get("requireScope") === "true";
    }
    for (let id of ["feat-slots-objects", "feat-require-both", "feat-require-scope"]) {
        document.getElementById(id).onchange = executeCode;
    }

    editor = monaco.editor.create(document.getElementById("editor"), {
        value: source,
        language: "javascript",
        minimap: {
            enabled: false
        },
        hideCursorInOverviewRuler: true,
        scrollbar: {vertical: "auto"},
        scrollBeyondLastLine: false,
        theme: "vs-dark",
    });

    // Move cursor to end and focus the editor.
    let numLines = editor.getModel().getLineCount();
    let col = editor.getModel().getLineMaxColumn(numLines);
    editor.setPosition({lineNumber: numLines, column: col});
    editor.focus();

    editor.onDidChangeModelContent(function(model) {
        executeCode();
    });
    executeCode();

    document.getElementById("share").onclick = shareCode;
};
