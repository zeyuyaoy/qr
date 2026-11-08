import { setupEnv } from "./env";

/** Import this FIRST in an integration test file: it configures the environment and returns the helper. */
export const T = setupEnv();
