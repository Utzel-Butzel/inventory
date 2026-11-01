ALTER TABLE media ADD COLUMN preview_media_id uuid REFERENCES media(id) ON DELETE SET NULL;
ALTER TABLE media ADD COLUMN poster_media_id uuid REFERENCES media(id) ON DELETE SET NULL;
ALTER TABLE media ADD CONSTRAINT media_video_preview_not_self CHECK (preview_media_id IS DISTINCT FROM id);
ALTER TABLE media ADD CONSTRAINT media_video_poster_not_self CHECK (poster_media_id IS DISTINCT FROM id);
CREATE INDEX media_preview_media_id_idx ON media(preview_media_id) WHERE preview_media_id IS NOT NULL;
CREATE INDEX media_poster_media_id_idx ON media(poster_media_id) WHERE poster_media_id IS NOT NULL;
