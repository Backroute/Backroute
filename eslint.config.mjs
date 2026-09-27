import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Every text, email and call goes out through lib/channels/out, which keeps sandbox carriers from sending anything
  // and retries when a provider is down. The raw senders are only for that file.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/channels/out.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@/lib/channels/twilio", importNames: ["sendSms", "startCall"], message: "Send through lib/channels/out (textTo, callTo)." },
            { name: "@/lib/channels/email", importNames: ["sendEmail"], message: "Send through lib/channels/out (emailTo)." },
          ],
          patterns: [
            { group: ["**/channels/twilio"], importNames: ["sendSms", "startCall"], message: "Send through lib/channels/out (textTo, callTo)." },
            { group: ["**/channels/email", "./email"], importNames: ["sendEmail"], message: "Send through lib/channels/out (emailTo)." },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
