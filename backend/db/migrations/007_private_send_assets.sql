-- Migration: 006_private_send_assets.sql
-- Allow USDG and registered RWA assets in private_send_jobs
ALTER TABLE private_send_jobs DROP CONSTRAINT IF EXISTS private_send_jobs_asset_symbol_check;
