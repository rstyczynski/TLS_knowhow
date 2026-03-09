import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';

const host = 'github.com';
const port = 443;

function getRootCert(leaf) {
  let c = leaf;
  while (c && c.issuerCertificate && c.issuerCertificate !== c) {
    c = c.issuerCertificate;
  }
  return c;
}

const bundled = new Map();
const system = new Map();
for (const pem of tls.getCACertificates('bundled')) {
  const cert = new X509Certificate(pem);
  bundled.set(cert.fingerprint256, cert);
}
for (const pem of tls.getCACertificates('system')) {
  const cert = new X509Certificate(pem);
  system.set(cert.fingerprint256, cert);
}

const socket = tls.connect(port, host, { servername: host }, () => {
  const peer = socket.getPeerCertificate(true);
  if (!peer) {
    console.error('No peer certificate');
    socket.destroy();
    process.exit(1);
  }
  const root = getRootCert(peer);
  const fp256 = root.fingerprint256;
  const subject = root.subject;
  const subjectStr = typeof subject === 'string'
    ? subject.replace(/\n/g, ' ')
    : (subject && subject.CN ? [subject.CN, subject.O, subject.C].filter(Boolean).join(' | ') : String(subject));

  console.log('Host:', host);
  console.log('Leaf subject:', peer.subject);
  console.log('');
  console.log('Root CA subject:', subjectStr);
  console.log('Root fingerprint (SHA-256):', fp256 || '(not available)');
  console.log('');
  console.log('In Node bundled store:', fp256 && bundled.has(fp256) ? 'yes' : 'no');
  console.log('In system store:      ', fp256 && system.has(fp256) ? 'yes' : 'no');
  socket.destroy();
});

socket.on('error', (err) => {
  console.error(err);
  process.exit(1);
});
