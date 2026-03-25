module.exports = {
  apps: [
    {
      name: "security-ops-dashboard",
      script: "./server/index.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
