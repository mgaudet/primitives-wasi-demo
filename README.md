Online SpiderMonkey WASI shell
==============================

Source code for https://mozilla-spidermonkey.github.io/sm-wasi-demo/

User-defined primitives fork
----------------------------
This fork hosts a prototype of **user-defined primitives** in SpiderMonkey (a
`Primitive` constructor that builds identity-less primitive values with named
slots and overloaded operators). The editor is seeded with a `Vec3` example.

To run it against a locally-built `js.wasm`:
1) Build the WASI JS shell from your Gecko checkout:
   `MOZCONFIG=mozconfig-wasi ./mach build` (see `mozconfig-wasi`).
2) From this directory: `npm install`, then `./build_local.sh`
   (copies `obj-wasi/dist/bin/js` to `js.wasm` and runs `npm run build`;
   set `GECKO=/path/to/checkout` if it isn't the default).
3) Preview locally: `cd docs && python3 -m http.server`, then open
   http://localhost:8000/.

Deployment (GitHub Pages, no Actions)
-------------------------------------
The site is built into `docs/`, which is committed. GitHub Pages serves it via
*Settings -> Pages -> Deploy from a branch -> `main`, folder `/docs`*. To
update the live site: rebuild (`./build_local.sh`), then commit `docs/` and
push. Updates are entirely manual (the scheduled GitHub Actions workflow was
removed). `js.wasm` is committed so a clone is self-contained.

Build Instructions
------------------
1) Run `npm install` to fetch dependencies.
2) Run `npm run build` to generate the site in `docs/`.
3) Serve files in `docs/` (for example: `cd docs; python3 -m http.server`).

`data.json` also keeps a `mozilla-central` entry pointing at a Mozilla CI
`js.wasm`. Upstream this list was refreshed by `update_data_json.py` via GitHub
Actions; here it is maintained by hand.
