import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  BundleArticleRepository: vi.fn(),
  createDrizzleArticleRepository: vi.fn(),
}));

vi.mock("@/src/shared/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/src/modules/content/repositories/bundle-article-repository", () => ({ BundleArticleRepository: mocks.BundleArticleRepository }));
vi.mock("@/src/modules/content/repositories/drizzle-article-repository", () => ({ createDrizzleArticleRepository: mocks.createDrizzleArticleRepository }));

import { createRuntimeArticleRepository } from "@/src/modules/content/repositories/runtime-article-repository";

const databaseResult = {
  articles: [],
  totalCount: 201,
  topics: [],
  nextCursor: null,
  hasMore: false,
  savedFilterAvailable: false,
};

describe("createRuntimeArticleRepository", () => {
  afterEach(() => {
    delete process.env.DATABASE_URL;
    vi.clearAllMocks();
  });

  it("does not replace a configured database result with the 105-item bundle", async () => {
    process.env.DATABASE_URL = "postgres://test";
    const databaseRepository = { list: vi.fn().mockResolvedValue(databaseResult) };
    const bundleRepository = { list: vi.fn().mockResolvedValue({ ...databaseResult, totalCount: 105 }) };
    mocks.getDatabase.mockReturnValue({});
    mocks.createDrizzleArticleRepository.mockReturnValue(databaseRepository);
    mocks.BundleArticleRepository.mockImplementation(function BundleArticleRepositoryMock() {
      return bundleRepository;
    });

    const result = await createRuntimeArticleRepository().list({ cursor: "runtime-regression", pageSize: 24 });

    expect(result.totalCount).toBe(201);
    expect(databaseRepository.list).toHaveBeenCalledTimes(1);
    expect(bundleRepository.list).not.toHaveBeenCalled();
  });

  it("keeps the last database result during a transient database failure", async () => {
    process.env.DATABASE_URL = "postgres://test";
    const databaseRepository = { list: vi.fn().mockResolvedValueOnce(databaseResult).mockRejectedValueOnce(new Error("temporary database failure")) };
    const bundleRepository = { list: vi.fn().mockResolvedValue({ ...databaseResult, totalCount: 105 }) };
    mocks.getDatabase.mockReturnValue({});
    mocks.createDrizzleArticleRepository.mockReturnValue(databaseRepository);
    mocks.BundleArticleRepository.mockImplementation(function BundleArticleRepositoryMock() {
      return bundleRepository;
    });

    const repository = createRuntimeArticleRepository();
    await repository.list({ cursor: "transient-runtime-regression", pageSize: 24 });
    const result = await repository.list({ cursor: "transient-runtime-regression", pageSize: 24 });

    expect(result.totalCount).toBe(201);
    expect(databaseRepository.list).toHaveBeenCalledTimes(1);
    expect(bundleRepository.list).not.toHaveBeenCalled();
  });
});
