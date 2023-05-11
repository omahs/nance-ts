CREATE TABLE IF NOT EXISTS config (
  space VARCHAR(255) NOT NULL,
  spaceOwners JSON,
  cid CHAR(59),
  config JSON,
  calendar VARCHAR(16384),
  lastUpdated DATETIME,
  PRIMARY KEY(space)
);

CREATE TABLE IF NOT EXISTS contracts (
  symbol VARCHAR(255) NOT NULL,
  contractType VARCHAR(255),
  contractAddress CHAR(42),
  contractAbi JSON,
  PRIMARY KEY(symbol)
);