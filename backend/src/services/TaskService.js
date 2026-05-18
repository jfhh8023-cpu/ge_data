const { v4: uuidv4 } = require('uuid');
const { sequelize, CollectionTask } = require('../models');

async function createPreferredTask(payload, options = {}) {
  const run = async (transaction) => {
    const {
      title,
      time_dimension = 'week',
      start_date,
      end_date,
      week_number,
      year
    } = payload;

    if (!title || !start_date || !end_date || !year) {
      const err = new Error('必填字段缺失');
      err.status = 400;
      throw err;
    }

    await CollectionTask.update(
      { is_preferred: false, status: 'closed', updated_at: new Date() },
      { where: { is_preferred: true }, transaction }
    );

    return CollectionTask.create({
      id: uuidv4(),
      title,
      time_dimension,
      start_date,
      end_date,
      week_number,
      year,
      status: 'active',
      is_preferred: true
    }, { transaction });
  };

  if (options.transaction) return run(options.transaction);
  return sequelize.transaction(run);
}

module.exports = { createPreferredTask };
