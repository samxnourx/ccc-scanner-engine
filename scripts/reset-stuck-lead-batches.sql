UPDATE lead_scan_batches
SET status = CASE
  WHEN scanned_count > 0 THEN 'review_needed'
  ELSE 'imported'
END
WHERE status = 'scanning';
