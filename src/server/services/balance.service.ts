import { withTransaction } from "../db/pool";

export type BalanceSummary = {
  total: number;
  held: number;
  available: number;
};

export class BalanceServiceError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 400, code = "BALANCE_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export async function getUserBalance(userId: string): Promise<BalanceSummary> {
  return withTransaction(async (client) => {
    const userResult = await client.query<{ balance: string }>(
      "SELECT balance FROM users WHERE id = $1 FOR UPDATE",
      [userId]
    );

    if (userResult.rowCount !== 1) {
      throw new BalanceServiceError("User not found.", 404, "USER_NOT_FOUND");
    }

    const holdResult = await client.query<{ held: string }>(
      "SELECT COALESCE(SUM(amount), 0)::BIGINT AS held FROM balance_holds WHERE user_id = $1 AND status = 'active'",
      [userId]
    );

    const total = Number(userResult.rows[0].balance);
    const held = Number(holdResult.rows[0]?.held ?? 0);

    return {
      total,
      held,
      available: total - held
    };
  });
}
