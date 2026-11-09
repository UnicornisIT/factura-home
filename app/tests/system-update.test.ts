import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  __resetReleaseCacheForTests,
  fetchLatestRelease,
  isUpdateRunning,
  readCurrentVersion,
  readUpdateStatus,
  startUpdate,
  type UpdateOperationStatus,
} from "../api/lib/system-update";

afterEach(() => {
  __resetReleaseCacheForTests();
  vi.unstubAllGlobals();
});

function stubFetch(response: { ok: boolean; status: number; body?: unknown }) {
  const calls: RequestInit[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(init ?? {});
      return {
        ok: response.ok,
        status: response.status,
        json: async () => response.body,
      };
    })
  );
  return calls;
}

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "glina-update-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("current version", () => {
  it("reads VERSION from the repository root", async () => {
    const version = await readCurrentVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("fetchLatestRelease", () => {
  it("parses the latest release and sends the token for private repositories", async () => {
    const calls = stubFetch({
      ok: true,
      status: 200,
      body: {
        tag_name: "v1.2.3",
        name: "Release 1.2.3",
        published_at: "2026-11-01T10:00:00Z",
        body: "## Изменения\n- новое",
        html_url: "https://github.com/o/r/releases/tag/v1.2.3",
      },
    });
    const release = await fetchLatestRelease("owner/repo", "secret-token");
    expect(release).toEqual({
      tag: "v1.2.3",
      name: "Release 1.2.3",
      publishedAt: "2026-11-01T10:00:00Z",
      notes: "## Изменения\n- новое",
      url: "https://github.com/o/r/releases/tag/v1.2.3",
    });
    const headers = calls[0].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret-token");
    expect(headers.Accept).toBe("application/vnd.github+json");
  });

  it("omits Authorization without a token", async () => {
    const calls = stubFetch({
      ok: true,
      status: 200,
      body: { tag_name: "v0.1.0" },
    });
    const release = await fetchLatestRelease("owner/repo", "");
    expect(release?.tag).toBe("v0.1.0");
    expect(release?.name).toBeNull();
    const headers = calls[0].headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("returns null when the repository has no releases", async () => {
    stubFetch({ ok: false, status: 404 });
    expect(await fetchLatestRelease("owner/repo", "")).toBeNull();
  });

  it("fails closed on GitHub API errors and release without a tag", async () => {
    stubFetch({ ok: false, status: 500 });
    await expect(fetchLatestRelease("owner/repo", "")).rejects.toMatchObject({
      code: "BAD_GATEWAY",
    });
    __resetReleaseCacheForTests();
    stubFetch({ ok: true, status: 200, body: { name: "без тега" } });
    await expect(fetchLatestRelease("owner/repo", "")).rejects.toMatchObject({
      code: "BAD_GATEWAY",
    });
  });

  it("caches the release for repeated calls", async () => {
    stubFetch({ ok: true, status: 200, body: { tag_name: "v9.9.9" } });
    await fetchLatestRelease("owner/repo", "");
    stubFetch({ ok: true, status: 200, body: { tag_name: "v0.0.1" } });
    const cached = await fetchLatestRelease("owner/repo", "");
    expect(cached?.tag).toBe("v9.9.9");
  });
});

describe("readUpdateStatus", () => {
  it("returns null when the status file is absent or malformed", async () => {
    await withTempDir(async dir => {
      expect(await readUpdateStatus(join(dir, "missing.json"))).toBeNull();
      const broken = join(dir, "broken.json");
      await writeFile(broken, "{ не json");
      expect(await readUpdateStatus(broken)).toBeNull();
      const wrongState = join(dir, "wrong.json");
      await writeFile(wrongState, JSON.stringify({ state: "paused" }));
      expect(await readUpdateStatus(wrongState)).toBeNull();
    });
  });

  it("parses a valid status file and normalises unknown fields", async () => {
    await withTempDir(async dir => {
      const path = join(dir, "status.json");
      await writeFile(
        path,
        JSON.stringify({
          state: "success",
          tag: "v1.0.0",
          operationId: "op-1",
          startedAt: "2026-11-09T10:00:00Z",
          finishedAt: "2026-11-09T10:05:00Z",
          message: 42,
        })
      );
      expect(await readUpdateStatus(path)).toEqual({
        state: "success",
        tag: "v1.0.0",
        operationId: "op-1",
        startedAt: "2026-11-09T10:00:00Z",
        finishedAt: "2026-11-09T10:05:00Z",
        message: null,
      });
    });
  });
});

describe("isUpdateRunning", () => {
  const status = (
    state: UpdateOperationStatus["state"],
    startedAt: string | null
  ): UpdateOperationStatus => ({
    state,
    tag: null,
    operationId: null,
    startedAt,
    finishedAt: null,
    message: null,
  });

  it("treats a fresh running status as active and an old one as stale", () => {
    expect(isUpdateRunning(null)).toBe(false);
    expect(isUpdateRunning(status("success", new Date().toISOString()))).toBe(
      false
    );
    expect(isUpdateRunning(status("running", new Date().toISOString()))).toBe(
      true
    );
    const stale = new Date(Date.now() - 31 * 60_000).toISOString();
    expect(isUpdateRunning(status("running", stale))).toBe(false);
    expect(isUpdateRunning(status("running", "не дата"))).toBe(true);
  });
});

describe("startUpdate guards", () => {
  it("refuses when the feature is disabled", async () => {
    await expect(startUpdate({ enabled: false })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("refuses when the script is missing or the path is relative", async () => {
    await withTempDir(async dir => {
      await expect(
        startUpdate({
          enabled: true,
          scriptPath: join(dir, "missing.sh"),
          statusPath: join(dir, "status.json"),
          launch: () => {
            throw new Error("не должно вызываться");
          },
        })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      await expect(
        startUpdate({
          enabled: true,
          scriptPath: "relative/script.sh",
          statusPath: join(dir, "status.json"),
        })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });
  });

  it("refuses concurrent updates while one is running", async () => {
    await withTempDir(async dir => {
      const script = join(dir, "update.sh");
      await writeFile(script, "#!/bin/sh\n");
      // На Linux access(X_OK) требует настоящий бит исполняемости.
      await chmod(script, 0o755);
      const statusPath = join(dir, "status.json");
      await writeFile(
        statusPath,
        JSON.stringify({
          state: "running",
          tag: null,
          operationId: "op-1",
          startedAt: new Date().toISOString(),
          finishedAt: null,
          message: null,
        })
      );
      await expect(
        startUpdate({
          enabled: true,
          scriptPath: script,
          statusPath,
          launch: () => {
            throw new Error("не должно вызываться");
          },
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  it("launches the fixed script path when allowed", async () => {
    await withTempDir(async dir => {
      const script = join(dir, "update.sh");
      await writeFile(script, "#!/bin/sh\n");
      await chmod(script, 0o755);
      const launched: string[] = [];
      const result = await startUpdate({
        enabled: true,
        scriptPath: script,
        statusPath: join(dir, "status.json"),
        launch: path => launched.push(path),
      });
      expect(result).toEqual({ started: true });
      expect(launched).toEqual([script]);
    });
  });
});
