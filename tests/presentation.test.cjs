"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

// Compile the actual components in memory: no browser mock or generated files.
function component(name) {
  const filename = path.join(__dirname, "..", "src", name);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(compiled, filename);
  return loaded.exports;
}

const { default: CommitMarkdown, displayCommitText } =
  component("CommitText.tsx");
const { default: Graph } = component("Graph.tsx");
const markdown = (text) =>
  renderToStaticMarkup(
    React.createElement(CommitMarkdown, { text, onOpenLink() {} }),
  );

test("commit Markdown escapes repository HTML, excludes images and rejects unsafe link targets", () => {
  const rendered = markdown(
    '<script>alert(1)</script> <img src="https://example.invalid/pixel">\n\n' +
      "![tracking](https://example.invalid/image)\n" +
      "[script](javascript:alert(1)) [data](data:text/html,test) " +
      "[file](file:///tmp/secret) [plain](http://example.invalid) " +
      "[credentials](https://user:password@example.invalid) " +
      "[safe](https://example.invalid/docs?q=one&x=two)",
  );
  assert.doesNotMatch(
    rendered,
    /<script\b|<img\b|href="(?:javascript:|data:|file:|http:)/,
  );
  assert.match(rendered, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(rendered, /href="https:\/\/user:password/);
  for (const link of rendered.matchAll(/href="([^"]+)"/g)) {
    const url = new URL(link[1].replace(/&amp;/g, "&"));
    assert.equal(url.protocol, "https:");
    assert.equal(url.username, "");
    assert.equal(url.password, "");
  }
  assert.match(
    rendered,
    /href="https:\/\/example\.invalid\/docs\?q=one&amp;x=two"/,
  );
});

test("emoji aliases use own keys and leave prototype names and unknown aliases unchanged", () => {
  assert.equal(
    displayCommitText(
      ":sparkles: :constructor: :__proto__: :toString: :unknown_alias:",
    ),
    "✨ :constructor: :__proto__: :toString: :unknown_alias:",
  );
});

test(
  "malformed link delimiters stay responsive and very large bodies retain all original text",
  { timeout: 5000 },
  () => {
    const malformed = "[".repeat(199999);
    assert.match(markdown(malformed), new RegExp("<p>\\[+<\\/p>"));
    const original = "<script>" + "[".repeat(200001) + "\nfinal :sparkles:";
    const rendered = markdown(original);
    assert.match(rendered, /class="commit-message-raw"/);
    assert.match(rendered, /&lt;script&gt;/);
    assert.equal((rendered.match(/\[/g) || []).length, 200001);
    assert.match(rendered, /\nfinal :sparkles:<\/pre>/);
    assert.doesNotMatch(rendered, /<script\b/);
  },
);

test("variable graph row heights align nodes, merge parents, selected halo and clipping boundary", () => {
  const commits = [
    {
      hash: "merge",
      shortHash: "merge",
      subject: "merge",
      parents: ["left", "right"],
    },
    { hash: "left", shortHash: "left", subject: "left", parents: ["right"] },
    {
      hash: "right",
      shortHash: "right",
      subject: "right",
      parents: ["outside"],
    },
  ];
  const rendered = renderToStaticMarkup(
    React.createElement(Graph, {
      commits,
      selected: "left",
      onSelect() {},
      rowMetrics: [
        { top: 0, height: 52 },
        { top: 52, height: 94 },
        { top: 146, height: 70 },
      ],
    }),
  );
  assert.match(rendered, /height="216"/);
  assert.deepEqual(
    [...rendered.matchAll(/<circle[^>]* cy="([^"]+)"/g)].map((match) =>
      Number(match[1]),
    ),
    [26, 99, 99, 181],
  );
  assert.match(rendered, /d="M 17 26 V 99"/);
  assert.match(rendered, /d="M 17 26 C 17 51, 34 156, 34 181"/);
  assert.match(rendered, /d="M 34 181 v 35"/);
});
