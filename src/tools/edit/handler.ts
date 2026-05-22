import type { ActivityToolHandler } from "../../lib/tool-router";
import type { SandboxContext } from "../../lib/tool-router/with-sandbox";
import type { FileEditArgs, FileMultiEditArgs } from "./tool";

interface EditResult {
  path: string;
  success: boolean;
  replacements: number;
  hunks?: EditHunk[];
}

export interface EditHunk {
  editIndex: number;
  oldStartLine: number;
  oldEndLine: number;
  newStartLine: number;
  newEndLine: number;
  oldLines: string[];
  newLines: string[];
}

type TextEdit = FileMultiEditArgs["edits"][number];

interface EditPlanSuccess {
  ok: true;
  content: string;
  replacements: number;
  hunks: EditHunk[];
}

interface EditPlanFailure {
  ok: false;
  message: string;
  editIndex?: number;
}

type EditPlanResult = EditPlanSuccess | EditPlanFailure;

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  return text.replace(/\r\n/g, "\n").split("\n");
}

function lineNumberAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  return line;
}

function lineEnd(startLine: number, lines: string[]): number {
  return lines.length === 0 ? startLine : startLine + lines.length - 1;
}

function indicesOf(content: string, needle: string): number[] {
  const indices: number[] = [];
  let cursor = 0;
  while (cursor <= content.length) {
    const index = content.indexOf(needle, cursor);
    if (index === -1) break;
    indices.push(index);
    cursor = index + needle.length;
  }
  return indices;
}

function makeHunk(
  editIndex: number,
  beforeContent: string,
  replacementIndex: number,
  oldString: string,
  newString: string
): EditHunk {
  const oldStartLine = lineNumberAt(beforeContent, replacementIndex);
  const oldLines = splitLines(oldString);
  const newLines = splitLines(newString);
  return {
    editIndex,
    oldStartLine,
    oldEndLine: lineEnd(oldStartLine, oldLines),
    newStartLine: oldStartLine,
    newEndLine: lineEnd(oldStartLine, newLines),
    oldLines,
    newLines,
  };
}

function applyOneEdit(
  content: string,
  edit: TextEdit,
  editIndex: number
): EditPlanResult {
  const { old_string, new_string, replace_all = false } = edit;

  if (old_string.length === 0) {
    return {
      ok: false,
      editIndex,
      message: `Error: old_string for edit ${editIndex} must not be empty.`,
    };
  }

  if (old_string === new_string) {
    return {
      ok: false,
      editIndex,
      message: `Error: old_string and new_string must be different for edit ${editIndex}.`,
    };
  }

  const matches = indicesOf(content, old_string);

  if (matches.length === 0) {
    return {
      ok: false,
      editIndex,
      message: `Error: Could not find old_string for edit ${editIndex}. Make sure it matches exactly (whitespace-sensitive).`,
    };
  }

  if (!replace_all && matches.length > 1) {
    return {
      ok: false,
      editIndex,
      message: `Error: old_string for edit ${editIndex} appears ${matches.length} times. Provide more context to make it unique, or use replace_all: true for that edit.`,
    };
  }

  if (replace_all) {
    const hunks = matches.map((index) =>
      makeHunk(editIndex, content, index, old_string, new_string)
    );
    return {
      ok: true,
      content: content.split(old_string).join(new_string),
      replacements: matches.length,
      hunks,
    };
  }

  const index = matches[0];
  if (index === undefined) {
    return {
      ok: false,
      editIndex,
      message: `Error: Could not find old_string for edit ${editIndex}.`,
    };
  }
  return {
    ok: true,
    content:
      content.slice(0, index) +
      new_string +
      content.slice(index + old_string.length),
    replacements: 1,
    hunks: [makeHunk(editIndex, content, index, old_string, new_string)],
  };
}

export function applyEditPlan(
  content: string,
  edits: readonly TextEdit[]
): EditPlanResult {
  if (edits.length === 0) {
    return {
      ok: false,
      message: "Error: edits must contain at least one edit.",
    };
  }

  let current = content;
  let replacements = 0;
  const hunks: EditHunk[] = [];

  for (const [index, edit] of edits.entries()) {
    const result = applyOneEdit(current, edit, index);
    if (!result.ok) return result;
    current = result.content;
    replacements += result.replacements;
    hunks.push(...result.hunks);
  }

  return { ok: true, content: current, replacements, hunks };
}

function editFailureResult(
  filePath: string,
  message: string
): {
  toolResponse: string;
  data: EditResult;
} {
  return {
    toolResponse: message,
    data: { path: filePath, success: false, replacements: 0 },
  };
}

/**
 * Edit tool handler — performs string replacements in sandbox files.
 *
 * Wrap with {@link withSandbox} at activity registration time to inject the
 * sandbox automatically.
 */
export const editHandler: ActivityToolHandler<
  FileEditArgs,
  EditResult,
  SandboxContext
> = async (args, { sandbox }) => {
  const { fs } = sandbox;
  const { file_path, old_string, new_string, replace_all = false } = args;

  try {
    const exists = await fs.exists(file_path);
    if (!exists) {
      return editFailureResult(
        file_path,
        `Error: File "${file_path}" does not exist.`
      );
    }

    const content = await fs.readFile(file_path);
    const result = applyEditPlan(content, [
      { old_string, new_string, replace_all },
    ]);

    if (!result.ok) {
      return editFailureResult(file_path, result.message);
    }

    await fs.writeFile(file_path, result.content);

    const summary = replace_all
      ? `Replaced ${result.replacements} occurrence(s)`
      : `Replaced 1 occurrence`;

    return {
      toolResponse: `${summary} in ${file_path}`,
      data: {
        path: file_path,
        success: true,
        replacements: result.replacements,
        hunks: result.hunks,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      toolResponse: `Error editing file "${file_path}": ${message}`,
      data: { path: file_path, success: false, replacements: 0 },
    };
  }
};

export const multiEditHandler: ActivityToolHandler<
  FileMultiEditArgs,
  EditResult,
  SandboxContext
> = async (args, { sandbox }) => {
  const { fs } = sandbox;
  const { file_path, edits } = args;

  try {
    const exists = await fs.exists(file_path);
    if (!exists) {
      return editFailureResult(
        file_path,
        `Error: File "${file_path}" does not exist.`
      );
    }

    const content = await fs.readFile(file_path);
    const result = applyEditPlan(content, edits);

    if (!result.ok) {
      const suffix = result.editIndex === undefined ? "" : ` in ${file_path}`;
      return editFailureResult(file_path, `${result.message}${suffix}`);
    }

    await fs.writeFile(file_path, result.content);

    return {
      toolResponse: `Applied ${edits.length} edit(s), ${result.replacements} replacement(s) in ${file_path}`,
      data: {
        path: file_path,
        success: true,
        replacements: result.replacements,
        hunks: result.hunks,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      toolResponse: `Error editing file "${file_path}": ${message}`,
      data: { path: file_path, success: false, replacements: 0 },
    };
  }
};
