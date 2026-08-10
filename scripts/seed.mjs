import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://inventory:inventory@localhost:5432/inventory";
const sql = postgres(databaseUrl, { max: 1 });

const samples = [
  {
    name: "Festool track saw TS 55",
    type: "tool",
    status: "available",
    sku: "TOOL-0042",
    quantity: 2,
    location: "Wood shop · Shelf A3",
    description: "Precision plunge-cut saw with guide rail and dust extraction adapter.",
    tags: ["woodworking", "power-tool", "230v"],
    value: 68900,
  },
  {
    name: "Prusa MK4S",
    type: "tool",
    status: "in-use",
    sku: "3DP-0011",
    quantity: 3,
    location: "Print lab · Bench 2",
    description: "Reliable FDM printer for prototypes and workshop parts.",
    tags: ["3d-printing", "fabrication"],
    value: 89900,
  },
  {
    name: "USM Haller sideboard",
    type: "furniture",
    status: "available",
    sku: "FURN-0027",
    quantity: 1,
    location: "Studio · East wall",
    description: "Modular steel storage unit with two drop-down doors.",
    tags: ["storage", "studio"],
    value: 145000,
  },
  {
    name: "Sony FX30 camera kit",
    type: "object",
    status: "maintenance",
    sku: "MEDIA-0008",
    quantity: 1,
    location: "Media room · Locker 4",
    description: "Cinema camera kit with cage, batteries, charger, and 18–105 mm lens.",
    tags: ["camera", "video", "kit"],
    value: 239900,
  },
];

try {
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM resources`;
  if (count === 0) {
    for (const sample of samples) {
      await sql`
        INSERT INTO resources (
          name, type, status, sku, quantity, location, description, tags,
          value_cents, created_by
        ) VALUES (
          ${sample.name}, ${sample.type}, ${sample.status}, ${sample.sku},
          ${sample.quantity}, ${sample.location}, ${sample.description},
          ${sample.tags}, ${sample.value}, 'seed'
        )
      `;
    }
    process.stdout.write(`Seeded ${samples.length} inventory items.\n`);
  } else {
    process.stdout.write("Seed skipped; inventory already contains items.\n");
  }
} finally {
  await sql.end();
}
