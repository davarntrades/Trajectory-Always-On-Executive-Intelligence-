import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const extensions = new Set([".ts", ".tsx"]);
const prohibited = /\b(Thinking|Processing|Reasoning|Analysing|Analyzing|Computing|Generating|Assistant|AI response|Chat|Conversation|Loading|Message)\b/gi;
const compatibilityPaths = [
  /src\/app\/\(auth\)\//,
  /src\/app\/auth\/(callback|confirm)\//,
  /src\/app\/api\//,
  /src\/components\/dashboard\/loop-panels\.tsx$/,
  /src\/lib\/types\.ts$/,
  /src\/lib\/workspace\/repository\.ts$/,
  /src\/lib\/providers\//,
  /src\/lib\/state\//,
  /src\/lib\/store\//,
  /src\/lib\/connectors\//,
  /src\/lib\/background\//,
  /src\/lib\/workers\//,
  /src\/lib\/config\.ts$/,
  /src\/content\/trajectory-language\.ts$/,
];

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : extensions.has(extname(entry.name)) ? [path] : [];
  }))).flat();
}

function isRenderedLiteral(line, term) {
  const index = line.toLowerCase().indexOf(term.toLowerCase());
  if (index < 0) return false;
  const before = line.slice(0, index);
  const after = line.slice(index + term.length);
  const inside = (quote) => (before.match(new RegExp(`\\${quote}`, "g"))?.length ?? 0) % 2 === 1 && after.includes(quote);
  const jsxText = before.lastIndexOf(">") > before.lastIndexOf("<") && after.indexOf("<") >= 0 && !before.endsWith("{");
  return inside("'") || inside('"') || inside("`") || jsxText;
}

const unresolved = [];
const exceptions = [];
for (const file of await files(sourceRoot)) {
  const path = relative(root, file).replaceAll("\\", "/");
  const source = await readFile(file, "utf8");
  const sourceLines = source.split("\n");
  for (const match of source.matchAll(prohibited)) {
    const line = source.slice(0, match.index).split("\n").length;
    const lineText = sourceLines[line - 1] ?? "";
    const record = `${path}:${line}:${match[0]}`;
    const developerOnly = /^\s*(\/\/|\*|\/\*)/.test(lineText);
    const compatibility = compatibilityPaths.some((pattern) => pattern.test(path));
    const identifierOnly = !isRenderedLiteral(lineText, match[0]);
    if (developerOnly || compatibility || identifierOnly) exceptions.push(record);
    else unresolved.push(record);
  }
}

console.log(`Language audit exceptions (${exceptions.length})`);
for (const item of exceptions) console.log(`EXCEPTION ${item}`);
if (unresolved.length) {
  console.error(`Unresolved product-language matches (${unresolved.length})`);
  for (const item of unresolved) console.error(`UNRESOLVED ${item}`);
  process.exitCode = 1;
} else {
  console.log("No unresolved prohibited product-language matches.");
}
