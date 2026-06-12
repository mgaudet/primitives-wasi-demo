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

const initSource = `// User-defined primitives -- a SpiderMonkey prototype (compiled to WASI).
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
`;

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
