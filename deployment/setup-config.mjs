import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const input = () => readFileSync(0, "utf8");
const readEnv = (file) => parseEnv(readFileSync(file, "utf8"));

function mysqlUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "mysql:" ||
    !url.hostname ||
    !url.username ||
    !/^[A-Za-z0-9_]+$/.test(url.pathname.slice(1)) ||
    url.hash ||
    url.search
  )
    throw new Error("DATABASE_URL");
  return url;
}

function dotenvLine(key, value) {
  for (const quote of ["", '"', "'", String.fromCharCode(96)]) {
    const line = key + "=" + quote + value + quote + "\n";
    const parsed = parseEnv(line);
    if (Object.keys(parsed).length === 1 && parsed[key] === value) return line;
  }
  throw new Error("dotenv");
}

try {
  const [operation, ...args] = process.argv.slice(2);
  switch (operation) {
    case "get":
      process.stdout.write(readEnv(args[0])[args[1]] ?? "");
      break;
    case "random":
      process.stdout.write(randomBytes(48).toString("hex"));
      break;
    case "test-id":
      process.stdout.write(String(randomInt(1, 2 ** 47)));
      break;
    case "mysql-url": {
      const [user, host, port, db] = args;
      const url = mysqlUrl(
        "mysql://" + user + "@" + host + ":" + port + "/" + db,
      );
      url.password = encodeURIComponent(input());
      process.stdout.write(url.href);
      break;
    }
    case "mysql-change-user": {
      const url = mysqlUrl(readEnv(args[1]).DATABASE_URL);
      url.username = args[0];
      url.password = encodeURIComponent(input());
      process.stdout.write(url.href);
      break;
    }
    case "mysql-options": {
      const url = mysqlUrl(input());
      const options = {
        host: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || "3306",
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        protocol: "TCP",
      };
      process.stdout.write("[client]\n");
      for (const [key, value] of Object.entries(options))
        process.stdout.write(key + "=" + JSON.stringify(value) + "\n");
      break;
    }
    case "mysql-db":
      process.stdout.write(mysqlUrl(input()).pathname.slice(1));
      break;
    case "mysql-summary": {
      const url = mysqlUrl(input());
      process.stdout.write(
        " (" +
          url.username +
          "@" +
          url.hostname +
          ":" +
          (url.port || "3306") +
          ")\n",
      );
      break;
    }
    case "dotenv": {
      const old = args[0] ? readEnv(args[0]) : {};
      const entries = { ...old, ...parseEnv(input()) };
      if (entries.DB_DIALECT === "sqlite") delete entries.DATABASE_URL;
      else delete entries.SQLITE_PATH;
      for (const [key, value] of Object.entries(entries))
        process.stdout.write(dotenvLine(key, value));
      break;
    }
    case "origin": {
      const url = new URL(args[0]);
      if (url.protocol !== "https:" || url.origin !== args[0])
        throw new Error("origin");
      break;
    }
    case "release":
      process.stdout.write(JSON.parse(input()).tag_name);
      break;
    case "telegram": {
      const data = JSON.parse(input());
      if (
        !data.ok ||
        !data.result.is_bot ||
        data.result.username.toLowerCase() !== args[0].toLowerCase()
      )
        throw new Error("getMe");
      break;
    }
    case "test-login": {
      const id = Number(args[0]);
      const auth_date = Math.floor(Date.now() / 1000);
      const key = createHash("sha256").update(input()).digest();
      const hash = createHmac("sha256", key)
        .update("auth_date=" + auth_date + "\nid=" + id)
        .digest("hex");
      process.stdout.write(JSON.stringify({ json: { id, auth_date, hash } }));
      break;
    }
    case "ping":
      if (JSON.parse(input()).result.data.json.version !== args[0])
        throw new Error("version");
      break;
    default:
      throw new Error("operation");
  }
} catch {
  process.stderr.write(
    "Ошибка проверки конфигурации (" + process.argv[2] + ").\n",
  );
  process.exitCode = 1;
}
