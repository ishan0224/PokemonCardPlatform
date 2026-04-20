import { query } from "../db/pool";
import { STARTING_BALANCE_CENTS } from "../config/constants";

export type UserRole = "user" | "admin";

export type AppUser = {
  id: string;
  username: string;
  email: string;
  balance: number;
  role: UserRole;
};

export class UserServiceError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 400, code = "USER_SERVICE_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function sanitizeUsernameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "user";
  return local
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, 32) || "user";
}

function mapUserRow(row: {
  id: string;
  username: string;
  email: string;
  balance: string | number;
  role: string;
}): AppUser {
  if (row.role !== "user" && row.role !== "admin") {
    throw new UserServiceError("User role is invalid.", 500, "INVALID_USER_ROLE");
  }

  return {
    id: row.id,
    username: row.username,
    email: row.email,
    balance: Number(row.balance),
    role: row.role
  };
}

export async function getAppUserById(userId: string): Promise<AppUser | null> {
  const result = await query<{ id: string; username: string; email: string; balance: string; role: string }>(
    "SELECT id, username, email, balance, role FROM users WHERE id = $1",
    [userId]
  );

  if (result.rowCount !== 1) {
    return null;
  }

  return mapUserRow(result.rows[0]);
}

export async function upsertAppUserProfile(input: {
  id: string;
  email: string;
  username?: string;
}): Promise<AppUser> {
  const requestedUsername = input.username?.trim();
  const normalizedUsername = requestedUsername ? requestedUsername.slice(0, 32) : null;
  const fallbackUsername = sanitizeUsernameFromEmail(input.email);

  try {
    const result = await query<{ id: string; username: string; email: string; balance: string; role: string }>(
      `INSERT INTO users (id, username, email, balance)
       VALUES ($1, COALESCE($2, $3), $4, $5)
       ON CONFLICT (id)
       DO UPDATE
       SET username = CASE WHEN $2 IS NULL THEN users.username ELSE EXCLUDED.username END,
           email = EXCLUDED.email
       RETURNING id, username, email, balance, role`,
      [input.id, normalizedUsername, fallbackUsername, input.email, STARTING_BALANCE_CENTS]
    );

    return mapUserRow(result.rows[0]);
  } catch (error) {
    const maybePgError = error as { code?: string; constraint?: string };

    if (maybePgError.code === "23505") {
      if (maybePgError.constraint?.includes("username")) {
        throw new UserServiceError("Username already exists.", 409, "USERNAME_TAKEN");
      }

      if (maybePgError.constraint?.includes("email")) {
        throw new UserServiceError("Email already exists.", 409, "EMAIL_TAKEN");
      }
    }

    throw error;
  }
}
