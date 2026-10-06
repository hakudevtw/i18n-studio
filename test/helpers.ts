import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseConfig, type Config } from "../src/config.js";

/** Checked-in catalog (en, es, ko): multi-line values, array keys, `_0` keys, empty values. */
export const FIXTURE_DIR = join(import.meta.dirname, "fixtures/messages");
/** Rows of the fixture with an empty value in some language. */
export const FIXTURE_MISSING = 3;

export const tempDir = () => mkdtempSync(join(tmpdir(), "i18n-studio-"));

export const tempConfig = (overrides: Partial<Config> = {}): Config => {
  const root = tempDir();
  return baseConfig(
    {
      i18nDir: join(root, "messages"),
      statusDir: join(root, "messages-status"),
      reportDir: join(root, "report"),
    },
    overrides
  );
};

/** Temp copy of (some of) the fixture catalog. */
export const copyFixture = (
  langs = ["en", "ko", "es"],
  overrides: Partial<Config> = {}
) => {
  const config = tempConfig(overrides);
  for (const lang of langs) {
    cpSync(join(FIXTURE_DIR, lang), join(config.i18nDir, lang), {
      recursive: true,
    });
  }
  return config;
};

/** Tiny synthetic catalog: namespaces `a` and `b`, locales `ko` and `es`. */
export const syntheticConfig = (overrides: Partial<Config> = {}) => {
  const config = tempConfig(overrides);
  const write = (lang: string, ns: string, data: unknown) => {
    mkdirSync(join(config.i18nDir, lang), { recursive: true });
    writeFileSync(
      join(config.i18nDir, lang, `${ns}.json`),
      JSON.stringify(data, null, 2)
    );
  };
  write("en", "a", {
    title: "Hello",
    faqs: [{ q: "Question one" }],
    same1: "Same text",
    same2: "Same text",
  });
  write("en", "b", { title: "Goodbye", note: "Line one\nLine two" });
  write("ko", "a", {
    title: "안녕",
    faqs: [{ q: "질문 하나" }],
    same1: "같은",
    same2: "같은",
  });
  write("ko", "b", { title: "잘가", note: "한 줄\n두 줄" });
  write("es", "a", {
    title: "Hola",
    faqs: [{ q: "Pregunta uno" }],
    same1: "Igual",
    same2: "Igual",
  });
  write("es", "b", { title: "Adiós", note: "Línea uno\nLínea dos" });
  return config;
};

export const readText = (config: Config, lang: string, ns: string) =>
  readFileSync(join(config.i18nDir, lang, `${ns}.json`), "utf8");

export const readJson = (config: Config, lang: string, ns: string) =>
  JSON.parse(readText(config, lang, ns));

// Preact carries XML namespace URIs (SVG/MathML); they are identifiers, never fetched.
const XML_NAMESPACE = /http:\/\/www\.w3\.org\/[\w/]+/g;
export const EXTERNAL_URL = /https?:\/\//;
export const withoutXmlNamespaces = (s: string) => s.replace(XML_NAMESPACE, "");
