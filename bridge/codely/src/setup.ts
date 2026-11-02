/** Legacy Qantara setup is intentionally disabled in this Codely-only fork. */
export async function runSetup(_argv: string[]): Promise<void> {
  throw new Error("Legacy setup disabled; use the repository scripts/install.py");
}
