// Run locally when activating an approved profile. Never commit the output.
import { createHash, randomBytes } from 'node:crypto'

const token = randomBytes(32).toString('base64url')
process.stdout.write(`${JSON.stringify({ token, sha256: createHash('sha256').update(token).digest('hex') }, null, 2)}\n`)
