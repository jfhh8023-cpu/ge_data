module.exports = {
  apps: [{
    name: 'devtracker',
    script: 'src/app.js',
    cwd: '/opt/devtracker/backend',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    instances: 1,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 3000,
    watch: false,
    max_memory_restart: '200M',
    error_file: '/opt/devtracker/logs/error.log',
    out_file: '/opt/devtracker/logs/out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  }]
}
