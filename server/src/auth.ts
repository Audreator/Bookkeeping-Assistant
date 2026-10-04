import bcrypt from 'bcryptjs'
import { jwtVerify, SignJWT } from 'jose'

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export async function signToken(
  secret: string,
  userId: number,
  sessionId: string,
): Promise<string> {
  return new SignJWT({ uid: userId, sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(new TextEncoder().encode(secret))
}

export interface TokenPayload {
  userId: number
  issuedAt: number | null
  sessionId: string | null
}

export async function verifyToken(secret: string, token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret))
    const uid = payload.uid
    if (typeof uid !== 'number') return null
    return {
      userId: uid,
      issuedAt: typeof payload.iat === 'number' ? payload.iat : null,
      sessionId: typeof payload.sid === 'string' ? payload.sid : null,
    }
  } catch {
    return null
  }
}
