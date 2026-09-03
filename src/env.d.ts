/// <reference types="astro/client" />

import type { AuthenticatedUser } from './lib/auth';

declare global {
  namespace App {
    interface Locals {
      user: AuthenticatedUser | null;
    }
  }
}