import * as monaco from 'monaco-editor'

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

let workerIsRunning = false;
let workerKillTimeout = null;

let editor = null;

function executeCode() {
    let source = editor.getValue();
    if (workerIsRunning || source === workerLastSource) {
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

    let select = document.getElementById("branch");
    let branch = self.branches.find(el => el.branch === select.value);
    // Resolve against the page so a relative URL (e.g. a local "js.wasm")
    // works regardless of where the worker script lives.
    let wasm_url = new URL(branch.url, location.href).href;

    worker.postMessage({source, wasm_url});
    workerLastSource = source;
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
    url += "?branch=" + document.getElementById("branch").value;
    url += "&source=" + encodeURIComponent(editor.getValue());
    navigator.clipboard.writeText(url);
}

function showBuildInfo(name) {
    let build = self.branches.find(el => el.branch === name);
    let info = document.getElementById("build_info");
    info.innerText = `build: ${build.buildid} (rev ${build.rev.substr(0, 6)})`;
}

function changeBranch() {
    showBuildInfo(this.value);
    if (worker) {
        worker.terminate();
    }
    workerIsRunning = false;
    worker = null;
    workerLastSource = null;
    executeCode();
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
  mul(a, b) { return Vec3(a.x * b.x, a.y * b.y, a.z * b.z); },
});

let a = Vec3(1, 2, 3);
let b = Vec3(1, 2, 3);

print("typeof a    =", typeof a);    // "primitive" -- not an object
print("a === b     =", a === b);     // true -- identity-less, compared slot-wise
print("a.x,a.y,a.z =", a.x, a.y, a.z);

let s = a + Vec3(4, 5, 6);           // operator overloading via the 'add' trap
print("a + (4,5,6) =", s.x, s.y, s.z);

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
];

const initSource = examples[0].source;

self.onload = async function() {
    let response = await fetch("data.json");
    let branches = await response.json();
    let select = document.getElementById("branch");
    for (let branch of branches) {
        var option = document.createElement("option");
        option.value = branch.branch;
        option.text = branch.branch;
        select.appendChild(option);
    }

    self.branches = branches;

    let examplesSelect = document.getElementById("examples");
    for (let example of examples) {
        let option = document.createElement("option");
        option.value = example.name;
        option.text = example.name;
        examplesSelect.appendChild(option);
    }
    examplesSelect.onchange = function() {
        let example = examples.find(e => e.name === examplesSelect.value);
        if (example) {
            editor.setValue(example.source);
        }
    };

    let params = new URLSearchParams(window.location.search);
    let source = params.has("source") ? decodeURIComponent(params.get("source")) : initSource;

    if (params.has("branch")) {
        let branch = params.get("branch");
        select.value = branch;
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

    showBuildInfo(select.value);
    select.onchange = changeBranch;

    document.getElementById("share").onclick = shareCode;
};
