import { addInitialAdmins } from "../api/queries/admin-allowlist";

async function main() {
  const ids = process.argv.slice(2);
  if (ids.some(id => !/^[1-9]\d*$/.test(id)))
    throw new Error("Usage: npm run db:bootstrap-admins -- [TELEGRAM_ID ...]");

  const { added, preserved } = await addInitialAdmins(ids.map(Number));
  process.stdout.write(
    `Владелец проверен. Добавлено администраторов: ${added}.\n`
  );
  if (preserved.length)
    process.stdout.write(
      `Существующие записи сохранены: ${preserved.join(", ")}.\n`
    );
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    process.stderr.write(String(error) + "\n");
    process.exit(1);
  });
