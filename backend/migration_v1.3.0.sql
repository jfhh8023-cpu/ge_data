-- DevTracker v1.3.0 migration
SET NAMES utf8mb4;
USE devtracker;

ALTER TABLE fill_links
  ADD COLUMN draft_data JSON NULL COMMENT 'draft records (json)';

ALTER TABLE fill_links
  ADD COLUMN draft_saved_at DATETIME NULL COMMENT 'draft saved time';
