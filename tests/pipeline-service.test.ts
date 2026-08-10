import { describe, expect, it } from "vitest";
import { ProjectStatus } from "@prisma/client";
import { PipelineStateError } from "../src/api/errors.js";
import { PipelineService } from "../src/domain/pipeline/pipeline-service.js";

describe("PipelineService", () => {
  const service = new PipelineService();

  it("allows the canonical forward path", () => {
    expect(service.canTransition(ProjectStatus.DRAFT, ProjectStatus.RESEARCHING)).toBe(true);
    expect(service.canTransition(ProjectStatus.RESEARCHING, ProjectStatus.SCRIPTING)).toBe(true);
    expect(service.canTransition(ProjectStatus.SCRIPTING, ProjectStatus.PRODUCING)).toBe(true);
    expect(service.canTransition(ProjectStatus.PRODUCING, ProjectStatus.REVIEW)).toBe(true);
    expect(service.canTransition(ProjectStatus.REVIEW, ProjectStatus.RENDERING)).toBe(true);
    expect(service.canTransition(ProjectStatus.RENDERING, ProjectStatus.READY)).toBe(true);
    expect(service.canTransition(ProjectStatus.READY, ProjectStatus.PUBLISHING)).toBe(true);
    expect(service.canTransition(ProjectStatus.PUBLISHING, ProjectStatus.PUBLISHED)).toBe(true);
  });

  it("rejects arbitrary status changes", () => {
    expect(() => service.assertTransition(ProjectStatus.DRAFT, ProjectStatus.PUBLISHED)).toThrow(PipelineStateError);
    expect(() => service.assertTransition(ProjectStatus.ARCHIVED, ProjectStatus.DRAFT)).toThrow(PipelineStateError);
  });
});
