const path = require('path');
const webpack = require('webpack');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
const CopyPlugin = require("copy-webpack-plugin");

// The built site is emitted into docs/ so GitHub Pages can serve it directly
// via "Deploy from a branch" (main, /docs) -- no GitHub Actions needed.
module.exports = {
  mode: "production",
  optimization: {
    minimize: false,
  },
  entry: {
      "main": "./index.js",
  },
  output: {
    path: __dirname + '/docs/js',
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.css$/i,
        use: ["style-loader", "css-loader"],
      },
      {
        test: /\.ttf$/,
        use: ['file-loader'],
      },
      {
        // Import a file's verbatim text with `import src from './x.js?raw'`.
        // Used for the large bundled example sources (e.g. the Decimal demo).
        resourceQuery: /raw/,
        type: 'asset/source',
      },
    ],
  },
  plugins: [
    new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
    }),
    new MonacoWebpackPlugin(),
    new CopyPlugin({
      patterns: [
        { from: "./index.html", to: __dirname + "/docs" },
        { from: "./data.json", to: __dirname + "/docs" },
        // Disable Jekyll so Pages serves the built files verbatim.
        { from: "./.nojekyll", to: __dirname + "/docs", noErrorOnMissing: true },
        // Local user-defined-primitives build; copied in by build_local.sh.
        { from: "./js.wasm", to: __dirname + "/docs", noErrorOnMissing: true },
      ],
    }),
  ],
};
