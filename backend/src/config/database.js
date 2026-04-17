require('dotenv').config();
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASS,
  {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10),
    dialect: 'mysql',
    logging: false,
    define: {
      timestamps: false,
      underscored: true,
      freezeTableName: true
    },
    pool: { max: 10, min: 2, acquire: 30000, idle: 10000 }
  }
);

module.exports = sequelize;
