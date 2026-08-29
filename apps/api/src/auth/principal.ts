// Principal — the verified caller identity attached to req.principal by
// AuthGuard after JwtVerifier succeeds. The raw access token is retained
// only for downstream CALLER_CLIENT construction; never logged, persisted,
// or returned to the browser.

export interface Principal {
  userId: string;
  accessToken: string;
}
