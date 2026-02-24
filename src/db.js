const path = require('path');
const fs = require('fs');
const { Sequelize } = require('sequelize');
require('dotenv').config();

const dialect = process.env.DB_DIALECT || 'mysql';
const isSqlite = dialect === 'sqlite';

const ensureSqliteDir = () => {
  if (!isSqlite) return;
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return path.join(dataDir, 'arcade_arena.sqlite');
};

const sequelize = new Sequelize(
  process.env.DB_NAME || (isSqlite ? 'arcade_arena' : 'arcade_arena'),
  process.env.DB_USER || (isSqlite ? undefined : 'root'),
  process.env.DB_PASSWORD || (isSqlite ? undefined : ''),
  {
    host: isSqlite ? undefined : process.env.DB_HOST || 'localhost',
    port: isSqlite ? undefined : process.env.DB_PORT || 3306,
    dialect,
    storage: ensureSqliteDir(),
    logging: false,
    define: {
      underscored: true,
    },
  }
);

const Score   = require('./models/Score')(sequelize);
const LogoTap = require('./models/LogoTap')(sequelize);

const connect = async () => {
  await sequelize.authenticate();
};

module.exports = {
  sequelize,
  Score,
  LogoTap,
  connect,
};
