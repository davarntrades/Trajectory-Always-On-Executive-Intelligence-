import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = new URL("../", import.meta.url);
const sourceRoot = new URL("../src/", import.meta.url);
const extensions = new Set([".ts", ".tsx"]);
const prohibited = /\b(Thinking|Processing|Reasoning|Analysing|Analyzing|Computing|Generating|Assistant|AI response|Chat|Conversation|Loading|Message)\b/gi;
const compatibilityPaths = [
  /src\/lib\/types\.ts$/,
  /src\/lib\/workspace\/repository\.ts$/,
  /src\/lib\/providers\//,
  /src\/app\/api\//,
  /src\/lib\/store\//,
  /src\/lib\/state\//,
  /src\/content\/trajectory-language\.ts$/,
];

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : extensions.has(extname(entry.name)) ? [path] : [];
  }));
  return nested.flat();
}

const unresolved = [];
const exceptions = [];
for (const file of await files(sourceRoot)) {
  const path = relative(root.pathname, file).replaceAll("\\", "/");
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(prohibited)) {
    const line = source.slice(0, match.index).split("\n").length;
    const record = `${path}:${line}:${match[0]}`;
    const internal = compatibilityPaths.some((pattern) => pattern.test(path));
    const lineText = source.split("\n")[line - 1] ?? "";
    const developerOnly = /^\s*(\/\/|\*|\/\*)/.test(lineText);
    if (internal || developerOnly) exceptions.push(record);
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
