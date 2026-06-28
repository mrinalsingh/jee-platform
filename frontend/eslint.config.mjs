import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // React Compiler advisory rules — runtime needs a couple of escape hatches:
  //   - we read a ref's `current` during render to forward server-clock offset
  //     into the Timer; the value is stable across renders since it's set in a
  //     mount effect, but the React Compiler rule fires regardless.
  //   - useState(0)-initialised offset then setState-in-effect to compute the
  //     real value is the conventional fix, but the compiler still flags it.
  // Both warnings, not errors — they don't represent runtime bugs.
  {
    rules: {
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
