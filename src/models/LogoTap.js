const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const LogoTap = sequelize.define(
    'LogoTap',
    {
      brand: {
        type: DataTypes.STRING(32),
        allowNull: false,
      },
      deviceId: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      taps: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: 'logo_taps',
      indexes: [
        { unique: true, fields: ['brand', 'device_id'] },
      ],
    }
  );

  return LogoTap;
};
