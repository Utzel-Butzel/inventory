ALTER TABLE label_spool_commands ADD COLUMN action varchar(16) NOT NULL DEFAULT 'cancel' CHECK(action IN ('cancel','pause','resume','restart','repair'));
