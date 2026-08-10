import { hash } from "bcryptjs";

const password = process.argv[2];
if (!password) {
  process.stderr.write("Usage: npm run auth:hash -- <password>\n");
  process.exit(1);
}
process.stdout.write(`${await hash(password, 12)}\n`);
