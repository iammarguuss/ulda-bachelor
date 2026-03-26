import js from "@eslint/js";
import globals from "globals";
import jsdoc from "eslint-plugin-jsdoc";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "assets/**",
      "landing/assets/**"
    ]
  },
  {
    files: ["packages/**/*.js", "applications/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2024
      }
    },
    rules: {
      ...js.configs.recommended.rules,
      eqeqeq: ["error", "always"],
      "no-console": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_"
        }
      ],
      "no-var": "error"
    }
  },
  {
    files: [
      "packages/ulda-sign/ulda-sign.js",
      "packages/ulda-front/ulda-front.js",
      "applications/ulda-crud/src/server.js",
      "applications/example-password-keeper/src/server.js",
      "applications/max_speed_test_server/src/server.js"
    ],
    plugins: {
      jsdoc
    },
    settings: {
      jsdoc: {
        mode: "jsdoc"
      }
    },
    rules: {
      "jsdoc/check-param-names": "error",
      "jsdoc/check-property-names": "error",
      "jsdoc/check-tag-names": "error",
      "jsdoc/check-types": "error"
    }
  }
];
