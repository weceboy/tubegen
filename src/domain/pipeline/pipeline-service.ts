import { ProjectStatus } from "@prisma/client";
import { PipelineStateError } from "../../api/errors.js";

const transitions: Record<ProjectStatus, readonly ProjectStatus[]> = {
  DRAFT: ["RESEARCHING", "ARCHIVED"],
  RESEARCHING: ["SCRIPTING", "FAILED"],
  SCRIPTING: ["PRODUCING", "FAILED"],
  PRODUCING: ["REVIEW", "FAILED"],
  REVIEW: ["RENDERING", "PRODUCING", "FAILED"],
  RENDERING: ["READY", "FAILED"],
  READY: ["PUBLISHING", "REVIEW", "ARCHIVED"],
  PUBLISHING: ["PUBLISHED", "FAILED"],
  PUBLISHED: ["ARCHIVED"],
  FAILED: ["RESEARCHING", "SCRIPTING", "PRODUCING", "RENDERING", "PUBLISHING", "ARCHIVED"],
  ARCHIVED: [],
};

export class PipelineService {
  canTransition(from: ProjectStatus, to: ProjectStatus): boolean {
    return transitions[from].includes(to);
  }

  assertTransition(from: ProjectStatus, to: ProjectStatus): void {
    if (!this.canTransition(from, to)) {
      throw new PipelineStateError(`Invalid project transition: ${from} -> ${to}.`);
    }
  }
}

export const pipelineService = new PipelineService();
