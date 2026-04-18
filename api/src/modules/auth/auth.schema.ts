import { z } from 'zod';

export const credentialsSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(8).max(200),
});

export const authResponseSchema = z.object({
  token: z.string(),
  user: z.object({
    id: z.uuid(),
    email: z.email(),
  }),
});

export const meResponseSchema = z.object({
  id: z.uuid(),
  email: z.email(),
});

export type Credentials = z.infer<typeof credentialsSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
