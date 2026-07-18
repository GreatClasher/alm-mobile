-- Migration 001: Create packet_queue table
-- This is the durable local store for BLE audio packets awaiting WebSocket relay.
-- UNIQUE(session_id, sequence_no) prevents duplicate ingestion from BLE retransmissions.

CREATE TABLE IF NOT EXISTS packet_queue (
  local_id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  sequence_no INTEGER NOT NULL,
  payload_type TEXT NOT NULL,
  payload TEXT NOT NULL,         -- base64-encoded Uint8Array bytes
  checksum TEXT NOT NULL,        -- CRC32 as 8-char hex string
  timestamp INTEGER NOT NULL,    -- Unix milliseconds from watch
  status TEXT NOT NULL DEFAULT 'PENDING',
  received_at INTEGER NOT NULL,  -- Unix milliseconds when received by phone
  delivered_at INTEGER,          -- Unix milliseconds when ACK'd by backend, NULL until then
  UNIQUE(session_id, sequence_no)
);

CREATE INDEX IF NOT EXISTS idx_packet_queue_status
  ON packet_queue(status);

CREATE INDEX IF NOT EXISTS idx_packet_queue_session_seq
  ON packet_queue(session_id, sequence_no);
