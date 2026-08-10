import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeJob = {
  id: "job-1",
  status: "RUNNING",
  attempts: 1,
  maxAttempts: 3,
};

const prismaMock = {
  job: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
  },
};

vi.mock("../src/db/prisma.js", () => ({ prisma: prismaMock }));

import { jobService } from "../src/services/job-service.js";

describe("JobService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requeues a failed attempt while attempts remain", async () => {
    prismaMock.job.findUnique.mockResolvedValue(fakeJob);
    prismaMock.job.update.mockResolvedValue({ ...fakeJob, status: "QUEUED" });

    const result = await jobService.retryJob("job-1", "provider timeout");

    expect(result.status).toBe("QUEUED");
    expect(prismaMock.job.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "job-1" },
      data: expect.objectContaining({ status: "QUEUED", errorMessage: "provider timeout" }),
    }));
  });

  it("cancels only queued or running jobs", async () => {
    prismaMock.job.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.job.findUnique.mockResolvedValue({ ...fakeJob, status: "CANCELLED" });

    const result = await jobService.cancelJob("job-1");

    expect(result?.status).toBe("CANCELLED");
    expect(prismaMock.job.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "job-1", status: { in: ["QUEUED", "RUNNING"] } },
    }));
  });
});
