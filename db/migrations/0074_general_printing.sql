ALTER TABLE label_printers
  ADD COLUMN kind varchar(16) NOT NULL DEFAULT 'ptouch' CHECK (kind IN ('ptouch','system')),
  ADD COLUMN location varchar(120) NOT NULL DEFAULT '',
  ADD COLUMN max_width_mm double precision NOT NULL DEFAULT 1000 CHECK (max_width_mm > 0 AND max_width_mm <= 1000),
  ADD COLUMN max_height_mm double precision NOT NULL DEFAULT 1000 CHECK (max_height_mm > 0 AND max_height_mm <= 1000);
ALTER TABLE label_print_jobs
  ADD COLUMN format varchar(16) NOT NULL DEFAULT 'ptouch' CHECK (format IN ('ptouch','pdf')),
  ADD COLUMN page_width_mm double precision,
  ADD COLUMN page_height_mm double precision;
