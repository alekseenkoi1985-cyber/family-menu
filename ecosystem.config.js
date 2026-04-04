module.exports = {
  apps: [{
    name: "family-menu-dev",
    script: "./server.js",
    env: {
      NODE_ENV: "production",
      PORT: 3001
    },
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: "1G"
  }]
}
