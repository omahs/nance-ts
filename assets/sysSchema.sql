CREATE TABLE IF NOT EXISTS config (
  space VARCHAR(255) NOT NULL,
  cid CHAR(59),
  config JSON,
  PRIMARY KEY(space)
);
