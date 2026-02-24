const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Score = sequelize.define(
    'Score',
    {
      deviceId: {
        type: DataTypes.STRING(64),
        allowNull: false,
        defaultValue: 'legacy-device',
      },
      playerName: {
        type: DataTypes.STRING(32),
        allowNull: false,
        unique: true,
      },
      score: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: {
          min: 0,
        },
      },
      mode: {
        type: DataTypes.ENUM('solo', 'versus'),
        allowNull: false,
        defaultValue: 'solo',
      },
      contact: {
        type: DataTypes.STRING(128),
        allowNull: true,
        defaultValue: null,
      },
    },
    {
      tableName: 'scores',
      indexes: [
        { fields: ['mode', 'score'] },
        { unique: true, fields: ['device_id', 'mode'] },
        { fields: ['created_at'] },
      ],
    }
  );

  return Score;
};
