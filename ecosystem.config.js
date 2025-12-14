module.exports = {
  apps: [
    // 상품 1: 신지모루 Qi2 3in1 맥세이프 무선 충전기
    {
      name: "turafic-sinzimoru",
      script: "scripts/scheduler-sinzimoru.ts",
      interpreter: "node",
      interpreter_args: "--import tsx",
      cwd: "D:\\Project\\turafic_update",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 60000,
      env: {
        NODE_ENV: "production",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "logs/sinzimoru/pm2-error.log",
      out_file: "logs/sinzimoru/pm2-out.log",
      merge_logs: true,
    },
    // 상품 2: 차이팟 (오늘 목표: 2000~2100회)
    {
      name: "turafic-chaipot",
      script: "scripts/scheduler-chaipot.ts",
      interpreter: "node",
      interpreter_args: "--import tsx",
      cwd: "D:\\Project\\turafic_update",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 60000,
      env: {
        NODE_ENV: "production",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "logs/chaipot/pm2-error.log",
      out_file: "logs/chaipot/pm2-out.log",
      merge_logs: true,
    },
    // 상품 3: 남자골덴바지 (오늘 목표: 2000~2100회)
    {
      name: "turafic-goldenbanji",
      script: "scripts/scheduler-goldenbanji.ts",
      interpreter: "node",
      interpreter_args: "--import tsx",
      cwd: "D:\\Project\\turafic_update",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 60000,
      env: {
        NODE_ENV: "production",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "logs/goldenbanji/pm2-error.log",
      out_file: "logs/goldenbanji/pm2-out.log",
      merge_logs: true,
    },
  ],
};
