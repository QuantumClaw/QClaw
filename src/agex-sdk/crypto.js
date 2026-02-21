import * as ed from '@noble/ed25519'
import { sha3_256 } from '@noble/hashes/sha3'
import { base64url } from 'jose'
import { v4 as uuidv4 } from 'uuid'

export function generateKeypair () {
  const privateKey = ed.utils.randomPrivateKey()
  const publicKey  = ed.getPublicKeySync(privateKey)
  return {
    privateKey: base64url.encode(privateKey),
    publicKey:  base64url.encode(publicKey),
    jwk: { kty: 'OKP', crv: 'Ed25519', x: base64url.encode(publicKey) }
  }
}

export function canonicalJson (obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj)
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']'
  return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}'
}

export function sha3Hash (data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  return Buffer.from(sha3_256(bytes)).toString('hex')
}

export function generateId () { return uuidv4() }
