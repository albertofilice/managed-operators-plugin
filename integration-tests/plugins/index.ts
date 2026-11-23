const wp = require('@cypress/webpack-preprocessor');

const config: Cypress.PluginConfig = (on, config) => {
  const options = {
    webpackOptions: {
      resolve: {
        extensions: ['.ts', '.tsx', '.js'],
      },
      module: {
        rules: [
          {
            test: /\.tsx?$/,
            loader: 'ts-loader',
            options: { happyPackMode: true, transpileOnly: true },
          },
        ],
      },
    },
  };
  on('file:preprocessor', wp(options));
  // `config` is the resolved Cypress config
  config.baseUrl = `${process.env.BRIDGE_BASE_ADDRESS || 'http://localhost:9000/'}`;
  config.env.BRIDGE_KUBEADMIN_PASSWORD = process.env.BRIDGE_KUBEADMIN_PASSWORD;
  config.env.BRIDGE_USERNAME = process.env.BRIDGE_USERNAME;
  config.env.BRIDGE_PASSWORD = process.env.BRIDGE_PASSWORD;
  config.env.BRIDGE_IDP = process.env.BRIDGE_IDP;
  return config;
};

module.exports = config;
