"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { execFileSync } = require("node:child_process");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const root = path.resolve(__dirname, "..");
const runtimeUrl = pathToFileURL(path.join(root, "locales/runtime.mjs"));
const runtime = import(runtimeUrl.href);
const domains = ["core", "settings", "git-tools", "actions", "extra"];
const catalogs = domains.map((name) => ({
  name,
  data: JSON.parse(
    fs.readFileSync(path.join(root, "locales", name + ".json"), "utf8"),
  ),
}));
const placeholders = (text) =>
  [
    ...new Set(
      [...text.matchAll(/\{([a-zA-Z_][a-zA-Z\d_]*)\}/g)].map((item) => item[1]),
    ),
  ].sort();

test("all eight languages have canonical metadata and safe regional normalization", async () => {
  const { LANGUAGES, normalizeLanguage, getLocale } = await runtime;
  assert.deepEqual(
    LANGUAGES.map((item) => item.code),
    ["en", "it", "es", "fr", "de", "pt-BR", "ja", "zh-CN"],
  );
  assert.equal(new Set(LANGUAGES.map((item) => item.locale)).size, 8);
  for (const item of LANGUAGES) {
    assert.equal(normalizeLanguage(item.code), item.code);
    assert.equal(getLocale(item.code), item.locale);
    assert.equal(Intl.getCanonicalLocales(item.locale)[0], item.locale);
    assert.ok(item.nativeName.trim());
  }
  for (const [input, expected] of [
    [" EN_gb ", "en"],
    ["it-IT", "it"],
    ["ES_mx", "es"],
    ["fr-CA", "fr"],
    ["de-AT", "de"],
    ["pt_br", "pt-BR"],
    ["pt", "pt-BR"],
    ["JA_jp", "ja"],
    ["zh-Hans-CN", "zh-CN"],
    ["zh", "zh-CN"],
    ["pt-PT", "en"],
    ["zh-TW", "en"],
    ["constructor", "en"],
    ["__proto__", "en"],
    ["", "en"],
    [null, "en"],
    [42, "en"],
    [{ code: "it" }, "en"],
  ])
    assert.equal(normalizeLanguage(input), expected, String(input));
});

test("every domain key has all seven translations and identical named placeholders", async () => {
  const { LANGUAGES, translate } = await runtime;
  for (const { name, data } of catalogs) {
    const keys = new Set(
      Object.values(data).flatMap((dictionary) => Object.keys(dictionary)),
    );
    assert.ok(
      keys.size > 0,
      `${name}: an empty catalog is not language coverage`,
    );
    assert.deepEqual(
      Object.keys(data).sort(),
      LANGUAGES.map((item) => item.code).sort(),
      name,
    );
    for (const key of keys) {
      assert.ok(key.trim(), `${name}: empty source key`);
      assert.equal(
        translate("it", key),
        key,
        `${name}: Italian preserves its source key`,
      );
      for (const { code } of LANGUAGES.filter((item) => item.code !== "it")) {
        assert.ok(
          Object.hasOwn(data[code], key),
          `${name}/${code}: missing ${key}`,
        );
        const template = data[code][key];
        assert.equal(typeof template, "string", `${name}/${code}: ${key}`);
        assert.ok(template.trim(), `${name}/${code}: blank ${key}`);
        assert.deepEqual(
          placeholders(template),
          placeholders(key),
          `${name}/${code}: placeholder mismatch for ${key}`,
        );
      }
    }
  }
});

test("static translation calls resolve in the shipped catalog across every language", async () => {
  const { LANGUAGES } = await runtime;
  const missing = [];
  const files = fs
    .readdirSync(path.join(root, "src"))
    .filter((name) => /\.tsx?$/.test(name));
  files.push("../electron/main.cjs");
  let calls = 0;
  for (const name of files) {
    const filename = path.join(root, "src", name);
    const source = ts.createSourceFile(
      filename,
      fs.readFileSync(filename, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        ["t", "tr"].includes(node.expression.text)
      ) {
        const keyNode = node.arguments[0];
        if (
          keyNode &&
          (ts.isStringLiteral(keyNode) ||
            ts.isNoSubstitutionTemplateLiteral(keyNode))
        ) {
          calls++;
          for (const { code } of LANGUAGES.filter(
            (item) => item.code !== "it",
          )) {
            if (
              !catalogs.some(({ data }) =>
                Object.hasOwn(data[code], keyNode.text),
              )
            ) {
              const line =
                source.getLineAndCharacterOfPosition(keyNode.getStart()).line +
                1;
              missing.push(`${name}:${line} ${code} ${keyNode.text}`);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.ok(
    calls > 100,
    "Coverage must inspect the actual translated UI, not only fixtures.",
  );
  assert.equal(
    missing.length,
    0,
    `Missing ${missing.length} translations:\n${missing.slice(0, 20).join("\n")}`,
  );
});

test("shared source keys have consistent translations across domain catalogs", () => {
  const seen = new Map();
  for (const { name, data } of catalogs) {
    for (const [code, dictionary] of Object.entries(data)) {
      for (const [key, value] of Object.entries(dictionary)) {
        const id = `${code}\0${key}`;
        if (seen.has(id)) {
          assert.equal(
            value,
            seen.get(id).value,
            `${code}: inconsistent ${key} in ${seen.get(id).name}/${name}`,
          );
        } else seen.set(id, { name, value });
      }
    }
  }
});

test("interpolation preserves repository text as text and ignores inherited or unsupported parameters", async () => {
  const { translate, createTranslator } = await runtime;
  const payload =
    '<img src=x onerror="alert(1)"> ~/répo/{other} gemini-3.5-flash';
  for (const code of ["en", "it", "es", "fr", "de", "pt-BR", "ja", "zh-CN"]) {
    const text = translate(code, "Apri {name}", {
      name: payload,
      other: "must not replace inserted content",
    });
    assert.ok(text.includes(payload));
    const html = renderToStaticMarkup(React.createElement("span", null, text));
    assert.doesNotMatch(html, /<img\b/);
    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
    assert.equal(
      createTranslator(code)("Apri {name}", { name: payload }),
      text,
    );
  }
  assert.equal(
    translate("en", "unknown {zero} {missing}", { zero: 0 }),
    "unknown 0 {missing}",
  );
  assert.equal(
    translate("en", "unknown {name}", Object.create({ name: "inherited" })),
    "unknown {name}",
  );
  assert.equal(
    translate("en", "unknown {name}", {
      name: {
        toString() {
          throw Error("must not execute");
        },
      },
    }),
    "unknown {name}",
  );
  for (const key of ["constructor", "__proto__", "toString"])
    assert.equal(translate("fr", key), key);
  assert.equal(
    translate("unknown", "Apri {name}", { name: "repo" }),
    "Open repo",
  );
  assert.equal(translate("de", "missing source key"), "missing source key");
});

test("numbers, absolute dates and nearby dates match the selected Intl locale", async () => {
  const { LANGUAGES, formatNumber, formatDate, formatRelativeDate } =
    await runtime;
  const date = new Date("2026-10-02T12:34:56Z");
  const options = {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  };
  for (const { code, locale } of LANGUAGES) {
    assert.equal(
      formatNumber(code, 1234567.89),
      new Intl.NumberFormat(locale).format(1234567.89),
    );
    assert.equal(
      formatNumber(code, 0, { style: "percent" }),
      new Intl.NumberFormat(locale, { style: "percent" }).format(0),
    );
    assert.equal(
      formatDate(code, date, options),
      new Intl.DateTimeFormat(locale, options).format(date),
    );
    for (const offset of [-1, 0, 1]) {
      const nearby = new Date(date);
      nearby.setDate(nearby.getDate() + offset);
      assert.equal(
        formatRelativeDate(code, nearby, date),
        new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
          offset,
          "day",
        ),
      );
    }
    const older = new Date(date);
    older.setDate(older.getDate() - 10);
    assert.equal(
      formatRelativeDate(code, older, date),
      formatDate(code, older),
    );
  }
  assert.equal(formatDate("en", "unparsed Git date"), "unparsed Git date");
  assert.equal(formatDate("en", new Date(NaN)), "—");
});

test("relative dates use local calendar days across daylight-saving transitions", async () => {
  const script = `import {formatRelativeDate} from ${JSON.stringify(runtimeUrl.href)};
    const before = new Date(2026, 2, 28, 12);
    const after = new Date(2026, 2, 29, 12);
    if (after - before !== 23 * 60 * 60 * 1000) throw new Error('DST fixture');
    process.stdout.write(formatRelativeDate('en', after, before));`;
  const output = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      env: { ...process.env, TZ: "Europe/Rome" },
      encoding: "utf8",
    },
  );
  assert.equal(output, "tomorrow");
});
