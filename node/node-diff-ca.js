import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';

function indexByFingerprint(pems) {
  const map = new Map();

  for (const pem of pems) {
    const cert = new X509Certificate(pem);
    map.set(cert.fingerprint256, cert);
  }

  return map;
}

const bundled = indexByFingerprint(tls.getCACertificates('bundled'));
const system  = indexByFingerprint(tls.getCACertificates('system'));

const onlyBundled = [];
const onlySystem = [];
const inBoth = [];

for (const [fp, cert] of bundled) {
  if (!system.has(fp)) onlyBundled.push(cert);
  else inBoth.push(cert);
}

for (const [fp, cert] of system) {
  if (!bundled.has(fp)) onlySystem.push(cert);
}

console.log("Summary: bundled=" + bundled.size + " system=" + system.size + " | onlyBundled=" + onlyBundled.length + " onlySystem=" + onlySystem.length + " inBoth=" + inBoth.length);

console.log("\n=== In bundled but NOT in system ===");
for (const c of onlyBundled) {
  console.log(c.subject.replace(/\n/g, ' '));
}

console.log("\n=== In system but NOT in bundled ===");
for (const c of onlySystem) {
  console.log(c.subject.replace(/\n/g, ' '));
}

console.log("\n=== In both NSS and system ===");
for (const c of inBoth) {
  console.log(c.subject.replace(/\n/g, ' '));
}