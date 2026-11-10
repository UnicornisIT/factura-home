// Интеграционные тесты deployment/factura-update.sh на bash-фикстурах
// (git-репозиторий с тегами + заглушки curl/npm/systemctl/sqlite3).
// Выполняются только в Linux (CI); на Windows/без bash пропускаются.
import { spawn, spawnSync } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const scriptSource = join(repoRoot, "deployment", "factura-update.sh");
const hasBash =
  process.platform !== "win32" &&
  spawnSync("bash", ["-c", "exit 0"], { encoding: "utf8" }).status === 0;
const describeBash = hasBash ? describe : describe.skip;

const SECRET = "secret-test-token";

const gitIsolation = (dir: string) => ({
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_GLOBAL: join(dir, "empty-gitconfig"),
  GIT_CONFIG_SYSTEM: join(dir, "empty-gitconfig"),
});

function git(dir: string, args: string[]) {
  const result = spawnSync("git", args, {
    cwd: dir,
    env: { ...process.env, ...gitIsolation(dir) },
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

async function createFixture() {
  const dir = await mkdtemp(join(tmpdir(), "factura-update-it-"));
  const stubs = join(dir, "stubs");
  await mkdir(stubs, { recursive: true });
  const writeStub = async (name: string, lines: string[]) => {
    const path = join(stubs, name);
    await writeFile(path, ["#!/usr/bin/env bash", ...lines, ""].join("\n"));
    await chmod(path, 0o755);
  };
  await writeStub("npm", [
    'echo "npm $*" >> "$STUB_LOG"',
    'if [ -n "${STUB_NPM_FAIL:-}" ]; then exit 1; fi',
    // Сбой конкретного этапа один раз: повторный вызов (откат) проходит успешно.
    'if [ -n "${STUB_NPM_FAIL_STAGE:-}" ] && [[ "$*" == *"$STUB_NPM_FAIL_STAGE"* ]]; then',
    '  stage_counter="${STUB_COUNTER:?STUB_COUNTER required}.stage"',
    '  if [ ! -f "$stage_counter" ]; then touch "$stage_counter"; exit 1; fi',
    "fi",
    'if [ -n "${STUB_NPM_FAIL_ONCE:-}" ] && [ ! -f "${STUB_COUNTER}" ]; then',
    '  touch "${STUB_COUNTER}"; exit 1;',
    "fi",
    "exit 0",
  ]);
  await writeStub("curl", [
    'out=""; url=""',
    "while [ $# -gt 0 ]; do",
    '  case "$1" in',
    '    -o) out="$2"; shift 2;;',
    "    -H|-w|-A|-u|--config) shift 2;;",
    "    -*) shift;;",
    '    *) url="$1"; shift;;',
    "  esac",
    "done",
    'echo "curl $url" >> "$STUB_LOG"',
    'case "$url" in',
    "  *api.github.com*/tarball/*)",
    '    [ -z "${STUB_TARBALL_FAIL:-}" ] || exit 22',
    '    tar -czf "$out" -C "$STUB_TARBALL_ROOT" pkg',
    "    ;;",
    "  *api.github.com*)",
    '    if [ -n "$out" ]; then',
    '      printf \'{"tag_name":"%s"}\' "${STUB_GITHUB_TAG:-v0.0.2}" > "$out";',
    "    fi",
    "    printf '%s' \"${STUB_GITHUB_CODE:-200}\"",
    "    ;;",
    "  *)",
    '    [ "${STUB_HEALTH_OK:-1}" = "1" ] || exit 7',
    "    ;;",
    "esac",
    "exit 0",
  ]);
  await writeStub("systemctl", [
    'echo "systemctl $*" >> "$STUB_LOG"',
    'if [ -n "${STUB_SYSTEMCTL_FAIL:-}" ] && [ "$1" = "$STUB_SYSTEMCTL_FAIL" ]; then',
    "  exit 1",
    "fi",
    "exit 0",
  ]);
  await writeStub("systemd-analyze", [
    'if [ -n "${STUB_VERIFY_FAIL:-}" ]; then echo "bad unit" >&2; exit 1; fi',
    "exit 0",
  ]);
  await writeStub("visudo", ["exit 0"]);
  // Заглушка systemd-run синхронно запускает «transient unit»: тот же скрипт
  // с переменными из --setenv. Это воспроизводит реальную гонку — дочерний
  // процесс берёт flock, пока родитель ещё жив (ждёт возврата systemd-run).
  await writeStub("systemd-run", [
    'echo "systemd-run $*" >> "$STUB_LOG"',
    'if [ -n "${STUB_SYSTEMD_RUN_FAIL:-}" ]; then exit 1; fi',
    'script="${@: -1}"',
    "envs=()",
    'for a in "$@"; do case "$a" in --setenv=*) envs+=("${a#--setenv=}");; esac; done',
    'env "${envs[@]}" FACTURA_UPDATE_FORCE_DETACH= bash "$script"',
  ]);
  await writeStub("sqlite3", [
    'echo "sqlite3 $*" >> "$STUB_LOG"',
    'if [ -n "${STUB_SQLITE_FAIL:-}" ]; then exit 1; fi',
    'case "${2:-}" in',
    "  .backup*)",
    '    arg="${2#.backup }"',
    '    dest="${arg//\\\'/}"',
    '    [ -n "$dest" ] && printf "" > "$dest"',
    "    ;;",
    "  *)",
    '    echo "ok"',
    "    ;;",
    "esac",
    "exit 0",
  ]);
  // Обёртка git: перехватывает fetch по флагу, остальное — настоящий git.
  await writeStub("git", [
    'if [ -n "${STUB_GIT_FETCH_FAIL:-}" ]; then',
    '  for a in "$@"; do',
    '    if [ "$a" = "fetch" ]; then',
    '      echo "fatal: unable to access repository: could not resolve host" >&2',
    "      exit 128",
    "    fi",
    "  done",
    "fi",
    'exec /usr/bin/git "$@"',
  ]);
  await writeStub("sudo", ['exec "$@"']);

  // «Удалённый» репозиторий с именем, совпадающим с SERVER_UPDATE_REPOSITORY.
  // -b main: HEAD удалённого репозитория должен существовать — скрипт
  // проверяет доступ через `git ls-remote --exit origin HEAD`.
  const remoteDir = join(dir, "remotes", "UnicornisIT", "factura-home.git");
  await mkdir(remoteDir, { recursive: true });
  git(dir, ["init", "--bare", "-b", "main", remoteDir]);
  const workDir = join(dir, "work");
  await mkdir(workDir, { recursive: true });
  git(dir, ["init", "-b", "main", workDir]);
  await mkdir(join(workDir, "app"), { recursive: true });
  await mkdir(join(workDir, "admin"), { recursive: true });
  await writeFile(join(workDir, "README.md"), "# fixture v0.0.1\n");
  await writeFile(join(workDir, "app", "package.json"), '{"name":"app"}\n');
  await writeFile(join(workDir, "admin", "package.json"), '{"name":"admin"}\n');
  git(workDir, ["add", "-A"]);
  git(workDir, ["commit", "-m", "v0.0.1"]);
  git(workDir, ["tag", "v0.0.1"]);
  // v0.0.2 меняет контент и содержит deployment-файлы, как настоящий релиз.
  await writeFile(join(workDir, "README.md"), "# fixture v0.0.2\n");
  await mkdir(join(workDir, "deployment"), { recursive: true });
  for (const name of [
    "factura-update.sh",
    "factura.service",
    "sudoers-factura-update",
  ])
    await cp(
      join(repoRoot, "deployment", name),
      join(workDir, "deployment", name)
    );
  git(workDir, ["add", "-A"]);
  git(workDir, ["commit", "-m", "v0.0.2"]);
  git(workDir, ["tag", "v0.0.2"]);
  git(workDir, ["remote", "add", "origin", remoteDir]);
  git(workDir, ["push", "origin", "main", "--tags"]);

  // «Архив релиза» GitHub: deployment-файлы скрипт берёт отсюда (доверенный
  // root-источник), а не из рабочего дерева. Маркер в шаблоне юнита доказывает,
  // что установлен именно архивный вариант.
  const tarballRoot = join(dir, "tarroot");
  await mkdir(join(tarballRoot, "pkg"), { recursive: true });
  await cp(
    join(workDir, "deployment"),
    join(tarballRoot, "pkg", "deployment"),
    {
      recursive: true,
    }
  );
  const tarUnit = join(tarballRoot, "pkg", "deployment", "factura.service");
  await writeFile(
    tarUnit,
    `# tarball-source\n${await readFile(tarUnit, "utf8")}`
  );

  // Установленный проект: detached HEAD на старом теге v0.0.1.
  const appDir = join(dir, "opt", "factura");
  git(dir, ["clone", remoteDir, appDir]);
  git(appDir, ["checkout", "v0.0.1"]);
  // Пользовательские изображения вне рабочего дерева (как /var/lib/factura/uploads).
  const uploadsDir = join(dir, "uploads");
  await mkdir(uploadsDir, { recursive: true });
  await writeFile(join(uploadsDir, "photo-1.webp"), "fake-image-data");
  const envFile = join(appDir, "app", ".env");
  await writeFile(
    envFile,
    [
      "DB_DIALECT=sqlite",
      `SQLITE_PATH=${join(dir, "db.sqlite")}`,
      `UPLOAD_DIR=${uploadsDir}`,
      `GITHUB_TOKEN=${SECRET}`,
      "SERVER_UPDATE_REPOSITORY=UnicornisIT/factura-home",
      "HOST=127.0.0.1",
      "PORT=3999",
      // .env не должен исполняться как shell: значение — данные.
      `MALICIOUS="$(touch ${join(dir, "pwned")})"`,
      "",
    ].join("\n")
  );
  await writeFile(join(dir, "db.sqlite"), "");

  const sbin = join(dir, "sbin");
  await mkdir(sbin, { recursive: true });
  const updateScript = join(sbin, "factura-update.sh");
  await cp(scriptSource, updateScript);
  await chmod(updateScript, 0o755);
  const etcDir = join(dir, "etc");
  await mkdir(etcDir, { recursive: true });
  const unitFile = join(etcDir, "factura.service");
  await writeFile(unitFile, "[Unit]\nDescription=old\n");

  const baseEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...gitIsolation(dir),
    PATH: `${stubs}:${process.env.PATH}`,
    HOME: dir,
    FACTURA_ALLOW_NONROOT: "1",
    FACTURA_APP_DIR: appDir,
    SERVER_UPDATE_STATUS_PATH: join(dir, "status.json"),
    FACTURA_UPDATE_LOG: join(dir, "update.log"),
    FACTURA_BACKUP_DIR: join(dir, "backups"),
    FACTURA_LOCK_FILE: join(dir, "lock"),
    SERVER_UPDATE_SCRIPT: updateScript,
    FACTURA_UNIT_FILE: unitFile,
    FACTURA_SUDOERS_FILE: join(etcDir, "sudoers-factura-update"),
    FACTURA_HEALTHCHECK_TRIES: "2",
    STUB_LOG: join(dir, "stub.log"),
    STUB_TARBALL_ROOT: tarballRoot,
  };
  return {
    dir,
    appDir,
    unitFile,
    updateScript,
    baseEnv,
    run: (overrides: Record<string, string> = {}) =>
      spawnSync("bash", [updateScript], {
        env: { ...baseEnv, ...overrides },
        encoding: "utf8",
        timeout: 120000,
      }),
    readStatus: async () =>
      JSON.parse(await readFile(join(dir, "status.json"), "utf8")),
    readLog: async () => readFile(join(dir, "update.log"), "utf8"),
    readStubLog: async () => {
      try {
        return await readFile(join(dir, "stub.log"), "utf8");
      } catch {
        return "";
      }
    },
    head: () => git(appDir, ["describe", "--tags", "--exact-match"]),
  };
}

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function withFixture(run: (fx: Fixture) => Promise<void>) {
  const fx = await createFixture();
  try {
    await run(fx);
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
}

describeBash("factura-update.sh", () => {
  it("обновляет до последнего релиза, пишет этапы и не раскрывает токен", async () => {
    await withFixture(async fx => {
      const result = fx.run();
      expect(result.status).toBe(0);
      const status = await fx.readStatus();
      expect(status.state).toBe("success");
      expect(status.tag).toBe("v0.0.2");
      expect(status.stage).toBe("завершено");
      expect(status.message).toContain("updated from v0.0.1");
      expect(status.operationId).toBeTruthy();
      expect(status.finishedAt).toBeTruthy();
      expect(fx.head()).toBe("v0.0.2");
      const log = await fx.readLog();
      for (const stage of [
        "проверка окружения",
        "проверка доступа к GitHub",
        "загрузка информации о релизе",
        "создание резервных копий",
        "получение исходного кода",
        "установка зависимостей",
        "сборка приложения и админ-панели",
        "миграция базы данных",
        "установка deployment-файлов",
        "перезапуск сервиса",
        "проверка работоспособности",
      ])
        expect(log, stage).toContain(`этап: ${stage}`);
      const stubLog = await fx.readStubLog();
      expect(stubLog).toContain("npm ci");
      expect(stubLog).toContain("npm run build");
      expect(stubLog).toContain("npm run db:migrate");
      expect(stubLog).toContain("systemctl restart factura");
      // SQLite: Backup API (.backup) и проверка целостности копии.
      expect(stubLog).toContain(".backup");
      expect(stubLog).toContain("integrity_check");
      // Резервная копия: мета, образы (hardlink-копия uploads), .env, скрипт.
      const backups = await readdir(join(fx.dir, "backups"));
      expect(backups.length).toBe(1);
      const dest = join(fx.dir, "backups", backups[0]!);
      const meta = await readFile(join(dest, "backup-meta.txt"), "utf8");
      expect(meta).toContain("currentRef=v0.0.1");
      expect(meta).toContain("targetTag=v0.0.2");
      expect(
        await readFile(join(dest, "uploads", "photo-1.webp"), "utf8")
      ).toBe("fake-image-data");
      await expect(readFile(join(dest, "db.sqlite"), "utf8")).resolves.toBe("");
      expect(await readFile(join(dest, "env.backup"), "utf8")).toContain(
        "DB_DIALECT=sqlite"
      );
      expect(
        await readFile(join(dest, "factura-update.sh.backup"), "utf8")
      ).toContain("Обновление Factura Shop");
      // Исходные данные не тронуты.
      expect(
        await readFile(join(fx.dir, "uploads", "photo-1.webp"), "utf8")
      ).toBe("fake-image-data");
      await expect(readFile(join(fx.dir, "db.sqlite"), "utf8")).resolves.toBe(
        ""
      );
      // Юнит переустановлен из архива релиза (маркер tarball-source) с
      // подстановкой шаблона; ReadWritePaths не даёт сервису писать в
      // каталоги root-скрипта и юнитов.
      const unit = await readFile(fx.unitFile, "utf8");
      expect(unit).toContain("tarball-source");
      expect(unit).not.toContain("@APP_DIR@");
      expect(unit).toContain(fx.appDir);
      const rwPaths =
        unit.split("\n").find(line => line.startsWith("ReadWritePaths=")) ?? "";
      expect(rwPaths.length).toBeGreaterThan("ReadWritePaths=".length);
      expect(rwPaths).not.toContain("/usr/local");
      expect(rwPaths).not.toContain("/etc/systemd");
      // app/.env разбирается как данные: shell-подстановка не исполняется.
      await expect(
        readFile(join(fx.dir, "pwned"), "utf8")
      ).rejects.toBeTruthy();
      // Секреты не попадают ни в журнал, ни в статус, ни в лог заглушек.
      expect(log).not.toContain(SECRET);
      expect(JSON.stringify(status)).not.toContain(SECRET);
      expect(stubLog).not.toContain(SECRET);
    });
  }, 120000);

  it("сбой загрузки архива релиза: обновление отклоняется до изменений", async () => {
    await withFixture(async fx => {
      const result = fx.run({ STUB_TARBALL_FAIL: "1" });
      expect(result.status).not.toBe(0);
      const status = await fx.readStatus();
      expect(status.state).toBe("failed");
      expect(status.message).toContain("архив релиза");
      expect(fx.head()).toBe("v0.0.1");
    });
  }, 120000);

  it("при уже установленной последней версии завершается без изменений", async () => {
    await withFixture(async fx => {
      const result = fx.run({ STUB_GITHUB_TAG: "v0.0.1" });
      expect(result.status).toBe(0);
      const status = await fx.readStatus();
      expect(status.state).toBe("success");
      expect(status.message).toContain("already up to date");
      expect(fx.head()).toBe("v0.0.1");
    });
  }, 120000);

  it("ошибка GitHub API 401: статус failed с причиной, код не тронут", async () => {
    await withFixture(async fx => {
      const result = fx.run({ STUB_GITHUB_CODE: "401" });
      expect(result.status).not.toBe(0);
      const status = await fx.readStatus();
      expect(status.state).toBe("failed");
      expect(status.message).toContain("401");
      expect(status.message).toContain("GITHUB_TOKEN");
      expect(fx.head()).toBe("v0.0.1");
      expect(await fx.readLog()).not.toContain(SECRET);
      expect(JSON.stringify(status)).not.toContain(SECRET);
    });
  }, 120000);

  it("ошибка GitHub API 500: статус failed с кодом ответа", async () => {
    await withFixture(async fx => {
      const result = fx.run({ STUB_GITHUB_CODE: "500" });
      expect(result.status).not.toBe(0);
      const status = await fx.readStatus();
      expect(status.state).toBe("failed");
      expect(status.message).toContain("500");
      expect(fx.head()).toBe("v0.0.1");
    });
  }, 120000);

  it("недопустимое имя релиза отклоняется", async () => {
    await withFixture(async fx => {
      const result = fx.run({ STUB_GITHUB_TAG: "not-a-version" });
      expect(result.status).not.toBe(0);
      const status = await fx.readStatus();
      expect(status.state).toBe("failed");
      expect(status.message).toContain("Недопустимое имя релиза");
      expect(fx.head()).toBe("v0.0.1");
    });
  }, 120000);

  it("неверный путь установки: диагностический статус создаётся до проверок", async () => {
    await withFixture(async fx => {
      const result = fx.run({
        FACTURA_APP_DIR: join(fx.dir, "несуществующий"),
      });
      expect(result.status).not.toBe(0);
      const status = await fx.readStatus();
      expect(status.state).toBe("failed");
      expect(status.message).toContain("app/.env");
      const log = await fx.readLog();
      expect(log).toContain("ОШИБКА");
    });
  }, 120000);

  it("локальные изменения блокируют обновление и не уничтожаются", async () => {
    await withFixture(async fx => {
      const readme = join(fx.appDir, "README.md");
      await writeFile(readme, "# локальная правка\n");
      const result = fx.run();
      expect(result.status).not.toBe(0);
      const status = await fx.readStatus();
      expect(status.state).toBe("failed");
      expect(status.message).toContain("незакоммиченные");
      expect(status.message).toContain("README.md");
      // Файл не тронут, версия прежняя.
      expect(await readFile(readme, "utf8")).toContain("локальная правка");
      expect(fx.head()).toBe("v0.0.1");
    });
  }, 120000);

  it("origin не соответствует SERVER_UPDATE_REPOSITORY: обновление отклоняется", async () => {
    await withFixture(async fx => {
      git(fx.appDir, ["remote", "set-url", "origin", "/tmp/evil/repo.git"]);
      const result = fx.run();
      expect(result.status).not.toBe(0);
      const status = await fx.readStatus();
      expect(status.state).toBe("failed");
      expect(status.message).toContain("не соответствует");
      expect(fx.head()).toBe("v0.0.1");
    });
  }, 120000);

  it("недоступный origin (сбой ls-remote): понятная ошибка до изменений", async () => {
    await withFixture(async fx => {
      git(fx.appDir, [
        "remote",
        "set-url",
        "origin",
        join(fx.dir, "gone", "UnicornisIT", "factura-home.git"),
      ]);
      const result = fx.run();
      expect(result.status).not.toBe(0);
      const status = await fx.readStatus();
      expect(status.state).toBe("failed");
      expect(status.message).toContain("Нет доступа к GitHub");
      expect(fx.head()).toBe("v0.0.1");
    });
  }, 120000);

  it("сбой npm ci: откат кода на предыдущий тег, БД не откатывается", async () => {
    await withFixture(async fx => {
      const result = fx.run({
        STUB_NPM_FAIL_ONCE: "1",
        STUB_COUNTER: join(fx.dir, "npm-counter"),
      });
      expect(result.status).not.toBe(0);
      const status = await fx.readStatus();
      expect(status.state).toBe("failed");
      expect(status.message).toContain("npm ci");
      expect(status.message).toContain("откачен на v0.0.1");
      expect(status.message).toContain("БД не откатывалась");
      expect(fx.head()).toBe("v0.0.1");
    });
  }, 120000);

  it("сбой healthcheck после перезапуска: откат кода и статус failed", async () => {
    await withFixture(async fx => {
      const result = fx.run({ STUB_HEALTH_OK: "0" });
      expect(result.status).not.toBe(0);
      const status = await fx.readStatus();
      expect(status.state).toBe("failed");
      expect(status.message).toContain("healthcheck");
      expect(status.message).toContain("откачен на v0.0.1");
      expect(fx.head()).toBe("v0.0.1");
    });
  }, 120000);

  it("повторный запуск при удерживаемой блокировке отклоняется", async () => {
    await withFixture(async fx => {
      const holder = spawn("bash", [
        "-c",
        `exec 9>"${join(fx.dir, "lock")}"; flock -n 9; sleep 10`,
      ]);
      await new Promise(resolve => setTimeout(resolve, 300));
      try {
        const result = fx.run();
        expect(result.status).not.toBe(0);
        expect(await fx.readLog()).toContain("уже выполняется");
        // Статус второй процесс не перезаписал.
        expect(fx.head()).toBe("v0.0.1");
      } finally {
        holder.kill();
      }
    });
  }, 120000);

  it("передача в transient unit: ребёнок стартует при живом родителе без гонки блокировок", async () => {
    await withFixture(async fx => {
      // Заглушка systemd-run синхронно выполняет скрипт-ребёнка, пока родитель
      // ждёт возврата systemd-run — старая гонка flock здесь была бы неизбежна.
      const result = fx.run({ FACTURA_UPDATE_FORCE_DETACH: "1" });
      expect(result.status).toBe(0);
      const stubLog = await fx.readStubLog();
      expect(stubLog).toContain("systemd-run");
      expect(stubLog).toContain("--unit=factura-update");
      const status = await fx.readStatus();
      expect(status.state).toBe("success");
      expect(status.tag).toBe("v0.0.2");
      expect(fx.head()).toBe("v0.0.2");
      expect(await fx.readLog()).toContain("запуск в transient unit");
    });
  }, 120000);

  it("сбой systemd-run: обновление продолжается в cgroup сервиса", async () => {
    await withFixture(async fx => {
      const result = fx.run({
        FACTURA_UPDATE_FORCE_DETACH: "1",
        STUB_SYSTEMD_RUN_FAIL: "1",
      });
      expect(result.status).toBe(0);
      const status = await fx.readStatus();
      expect(status.state).toBe("success");
      expect(status.tag).toBe("v0.0.2");
      expect(fx.head()).toBe("v0.0.2");
      expect(await fx.readLog()).toContain(
        "предупреждение: systemd-run не сработал"
      );
    });
  }, 120000);

  it("git fetch с ошибкой: диагноз в статусе, код не тронут", async () => {
    await withFixture(async fx => {
      const result = fx.run({ STUB_GIT_FETCH_FAIL: "1" });
      expect(result.status).not.toBe(0);
      const status = await fx.readStatus();
      expect(status.state).toBe("failed");
      expect(status.message).toContain("git fetch не удался");
      // Диагностика git попала в сообщение и не содержит секретов.
      expect(status.message).toContain("could not resolve host");
      expect(JSON.stringify(status)).not.toContain(SECRET);
      expect(fx.head()).toBe("v0.0.1");
    });
  }, 120000);

  it("ошибка резервного копирования БД: обновление отменяется до изменения кода", async () => {
    await withFixture(async fx => {
      const result = fx.run({ STUB_SQLITE_FAIL: "1" });
      expect(result.status).not.toBe(0);
      const status = await fx.readStatus();
      expect(status.state).toBe("failed");
      expect(status.message).toContain("резервную копию БД");
      expect(fx.head()).toBe("v0.0.1");
      expect(await fx.readStubLog()).not.toContain("npm ci");
    });
  }, 120000);

  it("ошибка сборки: откат на предыдущий тег с подтверждением работоспособности", async () => {
    await withFixture(async fx => {
      const result = fx.run({
        STUB_NPM_FAIL_STAGE: "run build",
        STUB_COUNTER: join(fx.dir, "npm-counter"),
      });
      expect(result.status).not.toBe(0);
      const status = await fx.readStatus();
      expect(status.state).toBe("failed");
      expect(status.message).toContain("сборка не удалась");
      expect(status.message).toContain("откачен на v0.0.1");
      expect(status.message).toContain("работоспособен");
      expect(status.message).toContain("БД не откатывалась");
      expect(fx.head()).toBe("v0.0.1");
    });
  }, 120000);

  it("ошибка миграции: откат кода, БД не откатывается", async () => {
    await withFixture(async fx => {
      const result = fx.run({
        STUB_NPM_FAIL_STAGE: "db:migrate",
        STUB_COUNTER: join(fx.dir, "npm-counter"),
      });
      expect(result.status).not.toBe(0);
      const status = await fx.readStatus();
      expect(status.state).toBe("failed");
      expect(status.message).toContain("миграции не применились");
      expect(status.message).toContain("откачен на v0.0.1");
      expect(fx.head()).toBe("v0.0.1");
    });
  }, 120000);

  it("unit-файл не проходит systemd-analyze verify: юнит не заменён, выполнен откат", async () => {
    await withFixture(async fx => {
      const result = fx.run({ STUB_VERIFY_FAIL: "1" });
      expect(result.status).not.toBe(0);
      const status = await fx.readStatus();
      expect(status.state).toBe("failed");
      expect(status.message).toContain("файлов деплоя");
      expect(status.message).toContain("откачен на v0.0.1");
      // Повреждённая конфигурация systemd не установлена.
      expect(await readFile(fx.unitFile, "utf8")).toContain("Description=old");
      expect(fx.head()).toBe("v0.0.1");
    });
  }, 120000);

  it("перезапуск сервиса не удался: откат без ложного «восстановлено»", async () => {
    await withFixture(async fx => {
      const result = fx.run({ STUB_SYSTEMCTL_FAIL: "restart" });
      expect(result.status).not.toBe(0);
      const status = await fx.readStatus();
      expect(status.state).toBe("failed");
      expect(status.message).toContain("перезапуск сервиса не удался");
      expect(status.message).toContain("откачен на v0.0.1");
      expect(status.message).toContain("требуется ручное вмешательство");
      expect(fx.head()).toBe("v0.0.1");
    });
  }, 120000);

  it("откат не удался: статус сообщает о необходимости ручного вмешательства", async () => {
    await withFixture(async fx => {
      // npm падает всегда: и обновление, и попытка отката (npm ci) не удаются.
      const result = fx.run({ STUB_NPM_FAIL: "1" });
      expect(result.status).not.toBe(0);
      const status = await fx.readStatus();
      expect(status.state).toBe("failed");
      expect(status.message).toContain("rollback failed");
      expect(status.message).not.toContain("работоспособен");
      expect(fx.head()).toBe("v0.0.1");
      expect(await fx.readLog()).toContain("ОТКАТ НЕ УДАЛСЯ");
    });
  }, 120000);

  it("GitHub API 404: понятный диагноз, код не тронут", async () => {
    await withFixture(async fx => {
      const result = fx.run({ STUB_GITHUB_CODE: "404" });
      expect(result.status).not.toBe(0);
      const status = await fx.readStatus();
      expect(status.state).toBe("failed");
      expect(status.message).toContain("404");
      expect(fx.head()).toBe("v0.0.1");
    });
  }, 120000);

  it("GitHub API 429: понятный диагноз про лимит запросов", async () => {
    await withFixture(async fx => {
      const result = fx.run({ STUB_GITHUB_CODE: "429" });
      expect(result.status).not.toBe(0);
      const status = await fx.readStatus();
      expect(status.state).toBe("failed");
      expect(status.message).toContain("429");
      expect(status.message).toContain("лимит");
      expect(fx.head()).toBe("v0.0.1");
    });
  }, 120000);

  it("GitHub API недоступен (сетевая ошибка): понятный диагноз", async () => {
    await withFixture(async fx => {
      const result = fx.run({ STUB_GITHUB_CODE: "000" });
      expect(result.status).not.toBe(0);
      const status = await fx.readStatus();
      expect(status.state).toBe("failed");
      expect(status.message).toContain("недоступен");
      expect(fx.head()).toBe("v0.0.1");
    });
  }, 120000);
});

describe("deployment-шаблоны: границы привилегий", () => {
  it("sudoers не пробрасывает окружение вызывающего в root-скрипт", async () => {
    const content = await readFile(
      join(repoRoot, "deployment", "sudoers-factura-update"),
      "utf8"
    );
    // Проверяются только активные директивы: комментарии могут упоминать что угодно.
    const active = content
      .split("\n")
      .filter(line => line.trim() && !line.trim().startsWith("#"))
      .join("\n");
    expect(active).not.toContain("env_keep");
    expect(active).not.toContain("Defaults");
    expect(active).toContain("NOPASSWD: @UPDATE_SCRIPT@");
  });

  it("сервис не получает запись в каталоги root-скрипта и юнитов", async () => {
    const setup = await readFile(
      join(repoRoot, "deployment", "setup.sh"),
      "utf8"
    );
    const rwPaths = setup.match(/@RW_PATHS@\|([^|]*)\|/);
    expect(rwPaths).toBeTruthy();
    expect(rwPaths![1]).not.toContain("/usr/local/sbin");
    expect(rwPaths![1]).not.toContain("/etc/systemd");
    expect(rwPaths![1]).toContain("$DATA_DIR");
  });

  it("скрипт обновления не исполняет app/.env как shell", async () => {
    const script = await readFile(scriptSource, "utf8");
    expect(script).not.toMatch(/^\s*\.\s"\$APP_DIR\/app\/\.env"/m);
    expect(script).toContain("read_env");
    // deployment-файлы устанавливаются из архива тега, а не из рабочего дерева.
    expect(script).toContain("tarball/$TARGET_TAG");
    expect(script).not.toContain('"$APP_DIR/deployment/factura-update.sh"');
  });
});
