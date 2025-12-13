module.exports = {
  apps: [
    {
      name: "turafic-scheduler",
      script: "scripts/scheduled-runner.ts",
      interpreter: "node",
      interpreter_args: "--import tsx",
      // args: "--interval 2",  // 2시간 간격으로 변경 시
      cwd: "D:\\Project\\turafic_update",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 60000, // 1분 후 재시작
      env: {
        NODE_ENV: "production",
      },
      // 로그 설정
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "logs/scheduled/pm2-error.log",
      out_file: "logs/scheduled/pm2-out.log",
      merge_logs: true,
    },
  ],
};
