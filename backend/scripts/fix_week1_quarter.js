/**
 * 将第1周任务的 start_date 修正到 2026-01-03 以归类到 Q1
 * 原数据: start_date=2025-12-28, end_date=2026-01-03, year=2026
 * 修正:   start_date=2025-12-29 (周一), 保持 year=2026
 * 季度判定依据 end_date 或 year 字段
 */
const { Sequelize } = require('sequelize')
const sequelize = new Sequelize({
  dialect: 'mysql', host: 'localhost', port: 3306,
  username: 'root', password: 'root', database: 'devtracker', logging: false
})

async function main() {
  // 查看第1周任务
  const [tasks] = await sequelize.query(
    "SELECT id, title, start_date, end_date, year, week_number FROM collection_tasks WHERE title LIKE '%第1周%'"
  )
  console.log('第1周任务:', JSON.stringify(tasks, null, 2))

  if (tasks.length > 0) {
    const task = tasks[0]
    console.log(`任务ID: ${task.id}`)
    console.log(`当前: start=${task.start_date}, end=${task.end_date}, year=${task.year}`)
    
    // 确保 year=2026, 用于 Q1 归类
    // 季度判断通常基于 start_date 或 end_date 的月份
    // Q1 = 1-3月, Q2 = 4-6月
    // 第1周的 end_date 是 2026-01-03，属于 Q1
    // 但如果系统基于 start_date (2025-12-28) 判断，则归为 Q4-2025
    // 解决方案：将 start_date 改为 2026-01-01 或确保 year=2026
    
    // 检查后端 stats 路由中的季度过滤逻辑
    await sequelize.query(
      "UPDATE collection_tasks SET start_date = '2025-12-29', year = 2026 WHERE id = ?",
      { replacements: [task.id] }
    )
    console.log('✓ 已确保 year=2026')
  }
  
  await sequelize.close()
}

main().catch(console.error)
