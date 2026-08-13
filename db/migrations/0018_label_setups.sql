CREATE TABLE IF NOT EXISTS "label_setups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(160) NOT NULL,
  "width_mm" double precision NOT NULL,
  "height_mm" double precision NOT NULL,
  "elements" jsonb NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "created_by" varchar(320),
  "updated_by" varchar(320),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "label_setups_width_mm_check"
    CHECK ("width_mm" > 0 AND "width_mm" <= 1000),
  CONSTRAINT "label_setups_height_mm_check"
    CHECK ("height_mm" > 0 AND "height_mm" <= 1000),
  CONSTRAINT "label_setups_elements_array"
    CHECK (jsonb_typeof("elements") = 'array'),
  CONSTRAINT "label_setups_revision_positive"
    CHECK ("revision" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "label_setups_name_unique"
  ON "label_setups" (lower("name"));
CREATE INDEX IF NOT EXISTS "label_setups_name_idx"
  ON "label_setups" ("name");

INSERT INTO "label_setups" (
  "id",
  "name",
  "width_mm",
  "height_mm",
  "elements",
  "created_by",
  "updated_by"
)
VALUES
  (
    '00000000-0000-4000-8000-000000000635',
    'Brother 62 mm · compact',
    62,
    35,
    '[
      {"type":"qr","x":2.9,"y":14.3,"width":40.3,"height":71.4,"visible":true},
      {"type":"image","x":2.9,"y":14.3,"width":40.3,"height":71.4,"visible":false,"fit":"cover"},
      {"type":"name","x":45.8,"y":9,"width":51.3,"height":18,"visible":true,"fontSizeMm":3.3,"align":"left"},
      {"type":"identifier","x":45.8,"y":30,"width":51.3,"height":10,"visible":true,"fontSizeMm":2.2,"align":"left"},
      {"type":"barcode","x":45.8,"y":44,"width":51.3,"height":17.1,"visible":true},
      {"type":"url","x":45.8,"y":65,"width":51.3,"height":22,"visible":true,"fontSizeMm":1.55,"align":"left"},
      {"type":"location","x":45.8,"y":89,"width":51.3,"height":8,"visible":false,"fontSizeMm":1.55,"align":"left"}
    ]'::jsonb,
    'system:migration',
    'system:migration'
  ),
  (
    '00000000-0000-4000-8000-000000000650',
    'Brother 62 mm · detailed',
    62,
    50,
    '[
      {"type":"qr","x":3.2,"y":20,"width":48.4,"height":60,"visible":true},
      {"type":"image","x":3.2,"y":20,"width":48.4,"height":60,"visible":false,"fit":"cover"},
      {"type":"name","x":54.8,"y":8,"width":42,"height":24,"visible":true,"fontSizeMm":3.8,"align":"left"},
      {"type":"identifier","x":54.8,"y":35,"width":42,"height":9,"visible":true,"fontSizeMm":2.5,"align":"left"},
      {"type":"barcode","x":54.8,"y":48,"width":42,"height":14,"visible":true},
      {"type":"url","x":54.8,"y":66,"width":42,"height":24,"visible":true,"fontSizeMm":1.75,"align":"left"},
      {"type":"location","x":54.8,"y":92,"width":42,"height":6,"visible":false,"fontSizeMm":1.75,"align":"left"}
    ]'::jsonb,
    'system:migration',
    'system:migration'
  ),
  (
    '00000000-0000-4000-8000-000000001152',
    'Brother large format',
    102,
    152,
    '[
      {"type":"qr","x":21.6,"y":28,"width":56.8,"height":38.2,"visible":true},
      {"type":"image","x":21.6,"y":28,"width":56.8,"height":38.2,"visible":false,"fit":"contain"},
      {"type":"name","x":9.8,"y":5.3,"width":80.4,"height":14,"visible":true,"fontSizeMm":8,"align":"center"},
      {"type":"identifier","x":9.8,"y":20,"width":80.4,"height":5,"visible":true,"fontSizeMm":4,"align":"center"},
      {"type":"barcode","x":11.8,"y":70,"width":76.4,"height":11.8,"visible":true},
      {"type":"url","x":9.8,"y":84,"width":80.4,"height":6,"visible":true,"fontSizeMm":2.8,"align":"center"},
      {"type":"location","x":9.8,"y":92,"width":80.4,"height":5,"visible":true,"fontSizeMm":3.5,"align":"center"}
    ]'::jsonb,
    'system:migration',
    'system:migration'
  )
ON CONFLICT DO NOTHING;
