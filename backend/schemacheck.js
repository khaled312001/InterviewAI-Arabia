// Every model in schema.prisma must have a table. A model whose table was
// never created fails as a warning on every request and a silently dead
// feature — which is what happened to provider_credentials.
const fs = require('fs');
const { execSync } = require('child_process');
const schema = fs.readFileSync('prisma/schema.prisma', 'utf8');
const wanted = [...schema.matchAll(/@@map\("([^"]+)"\)/g)].map((m) => m[1]);
console.log(JSON.stringify(wanted));
