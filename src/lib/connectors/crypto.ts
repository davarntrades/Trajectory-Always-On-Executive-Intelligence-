import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "@/lib/config";

function key() {
  if (!config.connectorEncryptionKey) throw new Error("CONNECTOR_ENCRYPTION_KEY is required");
  return createHash("sha256").update(config.connectorEncryptionKey).digest();
}

export function encryptCredentials(value: Record<string, unknown>) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    encryptedCredentials: encrypted.toString("base64"),
    credentialIv: iv.toString("base64"),
    credentialTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptCredentials(input: { encryptedCredentials: string; credentialIv: string; credentialTag: string }) {
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(input.credentialIv, "base64"));
  decipher.setAuthTag(Buffer.from(input.credentialTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(input.encryptedCredentials, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8")) as Record<string, unknown>;
}
