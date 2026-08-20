import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // The service-role key must never reach the browser bundle. The modules
    // below also `import 'server-only'`, which makes this a build error too —
    // this rule just fails faster and says why.
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/supabase/admin",
              message:
                "Service-role client is server-only. Fetch in a server component or server action and pass plain data down.",
            },
            {
              name: "@/lib/authz",
              message:
                "authz reads with the service-role client. Call it from a server component or server action.",
            },
          ],
          patterns: [
            {
              group: ["@/lib/labReviews/queries", "@/lib/labReviews/tabs", "@/lib/zendesk"],
              message:
                "Server-only data module. Fetch in a server component or server action and pass plain data down.",
            },
          ],
        },
      ],
    },
  },
  {
    // Server components and server actions are exactly where these belong.
    files: [
      "src/lib/**/*.ts",
      "src/app/**/page.tsx",
      "src/app/**/layout.tsx",
      "src/app/**/route.ts",
      "src/app/**/actions.ts",
      "src/app/**/search-actions.ts",
    ],
    rules: { "no-restricted-imports": "off" },
  },
]);

export default eslintConfig;
