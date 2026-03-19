import type { SkillProvider } from "./types";
import type { ToolHandlerResponse } from "../tool-router";
import type { ReadSkillReferenceArgs } from "./reference-tool";

/**
 * Creates a ReadSkillReference handler that loads reference content on demand
 * via the provider. Runs directly in the workflow — no activity needed.
 */
export function createReadSkillReferenceHandler(
  provider: SkillProvider
): (args: ReadSkillReferenceArgs) => Promise<ToolHandlerResponse<null>> {
  return async (args: ReadSkillReferenceArgs): Promise<ToolHandlerResponse<null>> => {
    if (!provider.getReference) {
      return {
        toolResponse: JSON.stringify({
          error: "This skill provider does not support reference loading",
        }),
        data: null,
      };
    }

    try {
      const content = await provider.getReference(args.skill_name, args.reference_name);
      return { toolResponse: content, data: null };
    } catch (error) {
      return {
        toolResponse: JSON.stringify({
          error: `Reference "${args.reference_name}" not found in skill "${args.skill_name}": ${error instanceof Error ? error.message : String(error)}`,
        }),
        data: null,
      };
    }
  };
}
