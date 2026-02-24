require('dotenv').config();
const { sequelize, connect } = require('../db');

const ensureDeviceIdColumn = async () => {
  const qi = sequelize.getQueryInterface();
  const table = 'scores';
  const desc = await qi.describeTable(table).catch(() => ({}));
  if (!desc.device_id) {
    console.log('Adding scores.device_id column...');
    await qi.addColumn(table, 'device_id', {
      type: 'STRING(64)',
      allowNull: false,
      defaultValue: 'legacy-device',
    });
  }
  // ensure unique index on device_id + mode
  const indexes = await qi.showIndex(table);
  const hasIndex = indexes.some((idx) => idx.name === 'scores_device_id_mode');
  if (!hasIndex) {
    console.log('Creating unique index scores_device_id_mode...');
    await qi.addIndex(table, ['device_id', 'mode'], {
      unique: true,
      name: 'scores_device_id_mode',
    });
  }
  // ensure unique index on player_name
  const hasNameIndex = indexes.some((idx) => idx.name === 'scores_player_name_unique');
  if (!hasNameIndex) {
    console.log('Creating unique index scores_player_name_unique...');
    await qi.addIndex(table, ['player_name'], {
      unique: true,
      name: 'scores_player_name_unique',
    });
  }
};

(async () => {
  try {
    await connect();
    await ensureDeviceIdColumn();
    await sequelize.sync({ alter: true });
    console.log('Database synced');
    process.exit(0);
  } catch (err) {
    console.error('Sync failed', err);
    process.exit(1);
  }
})();
