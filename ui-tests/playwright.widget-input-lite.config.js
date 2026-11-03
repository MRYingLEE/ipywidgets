module.exports = {
  testDir: './tests',
  timeout: 240000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:18964',
    launchOptions: {
      ...(process.env.WIDGET_INPUT_CHROME
        ? { executablePath: process.env.WIDGET_INPUT_CHROME }
        : {}),
      ...(process.env.WIDGET_INPUT_NO_SANDBOX
        ? { args: ['--no-sandbox'] }
        : {}),
    },
  },
};
