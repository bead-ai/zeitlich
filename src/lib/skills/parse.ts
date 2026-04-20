import type { SkillMetadata } from "./types";

/**
 * Parse a SKILL.md file into its frontmatter fields and markdown body.
 *
 * Handles the limited YAML subset used by the agentskills.io spec:
 * flat key-value pairs plus one-level nested `metadata` map.
 * No external YAML dependency required.
 */
export function parseSkillFile(raw: string): {
  frontmatter: SkillMetadata;
  body: string;
} {
  const trimmed = raw.replace(/^\uFEFF/, ""); // strip BOM
  const match = trimmed.match(
    /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/
  );

  if (!match) {
    throw new Error(
      "SKILL.md must start with YAML frontmatter delimited by ---"
    );
  }

  const [, yamlBlock, body] = match as [string, string, string];
  const frontmatter = parseSimpleYaml(yamlBlock);

  if (!frontmatter.name || typeof frontmatter.name !== "string") {
    throw new Error("SKILL.md frontmatter must include a 'name' field");
  }
  if (!frontmatter.description || typeof frontmatter.description !== "string") {
    throw new Error("SKILL.md frontmatter must include a 'description' field");
  }

  const result: SkillMetadata = {
    name: frontmatter.name,
    description: frontmatter.description,
  };

  if (frontmatter.license) result.license = String(frontmatter.license);
  if (frontmatter.compatibility)
    result.compatibility = String(frontmatter.compatibility);
  if (frontmatter["allowed-tools"]) {
    result.allowedTools = String(frontmatter["allowed-tools"])
      .split(/\s+/)
      .filter(Boolean);
  }
  if (
    frontmatter.metadata &&
    typeof frontmatter.metadata === "object" &&
    !Array.isArray(frontmatter.metadata)
  ) {
    result.metadata = frontmatter.metadata as Record<string, string>;
  }

  return { frontmatter: result, body: body.trim() };
}

type YamlValue = string | Record<string, string>;

/**
 * Minimal YAML parser for the agentskills.io frontmatter subset.
 * Supports: scalar key-value pairs, one-level nested maps (metadata).
 * Does NOT support arrays, multi-line strings, anchors, etc.
 */
function parseSimpleYaml(yaml: string): Record<string, YamlValue> {
  const result: Record<string, YamlValue> = {};
  const lines = yaml.split(/\r?\n/);

  let currentMapKey: string | null = null;
  let currentMap: Record<string, string> | null = null;

  for (const line of lines) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;

    const nestedMatch = line.match(/^(\s{2,}|\t+)(\S+)\s*:\s*(.*)$/);
    if (nestedMatch && currentMapKey && currentMap) {
      const [, , key, rawVal] = nestedMatch as [string, string, string, string];
      currentMap[key] = unquote(rawVal.trim());
      continue;
    }

    // Flush any pending nested map
    if (currentMapKey && currentMap) {
      result[currentMapKey] = currentMap;
      currentMapKey = null;
      currentMap = null;
    }

    const topMatch = line.match(/^(\S+)\s*:\s*(.*)$/);
    if (!topMatch) continue;

    const [, key, rawVal] = topMatch as [string, string, string];
    const val = rawVal.trim();

    if (val === "" || val === "|" || val === ">") {
      currentMapKey = key;
      currentMap = {};
    } else {
      result[key] = unquote(val);
    }
  }

  if (currentMapKey && currentMap) {
    result[currentMapKey] = currentMap;
  }

  return result;
}

function unquote(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}
